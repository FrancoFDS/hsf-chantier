'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Intervention, Zone, Trade, Company } from '@/types/database'
import { computeProjectHealth, effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getTradeColor } from '@/constants/colors'
import ListScreen from '@/components/ListScreen'
import PlanningScreen from '@/components/PlanningScreen'
import BriefingsScreen from '@/components/BriefingsScreen'
import SettingsScreen from '@/components/SettingsScreen'
import NotesScreen from '@/components/NotesScreen'
import TaskDetail from '@/components/TaskDetail'
import CompanyScreen from '@/components/CompanyScreen'

async function loadData() {
  const [zones, trades, interventions, companies] = await Promise.all([
    supabase.from('zones').select('*').order('display_order'),
    supabase.from('trades').select('*').order('display_order'),
    supabase.from('interventions').select('*').order('start_date').limit(1000),
    supabase.from('companies').select('*').order('display_order').eq('active', true),
  ])
  return {
    zones:         (zones.data         ?? []) as Zone[],
    trades:        (trades.data        ?? []) as Trade[],
    interventions: (interventions.data ?? []) as Intervention[],
    companies:     (companies.data     ?? []) as Company[],
  }
}

type Screen = 'dashboard' | 'planning' | 'list' | 'notes' | 'briefings' | 'settings'
type CompanyScreen = 'mytasks' | 'planning' | 'notes'
type ExternalScreen = 'dashboard' | 'planning' | 'briefings' | 'notes'

interface AppNotification {
  id: string
  recipient_role: string
  recipient_company: string | null
  recipient_email: string | null
  intervention_id: string | null
  task_name: string | null
  message: string
  read: boolean
  created_at: string
}

export default function PlanifyApp() {
  const router = useRouter()
  const [screen, setScreen]       = useState<Screen>('dashboard')
  const [coScreen, setCoScreen]   = useState<CompanyScreen>('mytasks')
  const [extScreen, setExtScreen] = useState<ExternalScreen>('dashboard')
  const [extPerms, setExtPerms]   = useState<{ sante: boolean; taches: boolean; trades: boolean; zones: boolean }>({ sante: true, taches: true, trades: true, zones: true })
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [zones, setZones]                   = useState<Zone[]>([])
  const [trades, setTrades]                 = useState<Trade[]>([])
  const [interventions, setInterventions]   = useState<Intervention[]>([])
  const [companies, setCompanies]           = useState<Company[]>([])
  const [userRole, setUserRole]             = useState<'admin' | 'company' | 'external'>('admin')
  const [userCompany, setUserCompany]       = useState<string | null>(null)
  const [userId, setUserId]                 = useState<string | null>(null)
  const [authorName, setAuthorName]         = useState<string>('Admin')
  const [notifications, setNotifications]   = useState<AppNotification[]>([])
  const [showNotifs, setShowNotifs]         = useState(false)
  const [notesUnread, setNotesUnread]       = useState(0)

  useEffect(() => {
    Promise.all([
      loadData(),
      supabase.auth.getUser(),
    ]).then(([d, { data: { user } }]) => {
      setZones(d.zones); setTrades(d.trades)
      setInterventions(d.interventions); setCompanies(d.companies)
      const role = user?.user_metadata?.role ?? 'admin'
      const co   = user?.user_metadata?.company_name ?? null
      setUserRole(role); setUserCompany(co)
      setUserId(user?.id ?? null)
      setAuthorName(user?.user_metadata?.display_name ?? co ?? user?.email?.split('@')[0] ?? 'Admin')
      // Si externe, charger ses permissions depuis external_contacts (match par email)
      if (role === 'external' && user?.email) {
        supabase.from('external_contacts').select('permissions').eq('email', user.email).maybeSingle()
          .then(({ data }) => {
            const p = (data as { permissions?: typeof extPerms } | null)?.permissions
            if (p) setExtPerms({ sante: !!p.sante, taches: !!p.taches, trades: !!p.trades, zones: !!p.zones })
          })
      }
    })
    .catch(e => setError(String(e)))
    .finally(() => setLoading(false))
  }, [])

  // Fetch notifications once role is known
  useEffect(() => {
    if (loading) return
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const email = user?.email ?? ''
      const query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
      const q = userRole === 'company' && userCompany
        ? query.eq('recipient_role', 'company').eq('recipient_company', userCompany)
        : userRole === 'external' && email
          ? query.eq('recipient_role', 'external').eq('recipient_email', email)
          : query.eq('recipient_role', 'admin')
      const { data } = await q
      if (!cancelled && data) setNotifications(data as AppNotification[])
    })()
    return () => { cancelled = true }
  }, [loading, userRole, userCompany])

  // Realtime subscription with proper cleanup
  useEffect(() => {
    if (loading) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const email = user?.email ?? ''
      const filter = userRole === 'company' && userCompany
        ? `recipient_company=eq.${userCompany}`
        : userRole === 'external' && email
          ? `recipient_email=eq.${email}`
          : `recipient_role=eq.admin`
      channel = supabase.channel(`notifs-${userRole}-${userCompany ?? email ?? 'admin'}-${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter }, payload => {
          setNotifications(prev => [payload.new as AppNotification, ...prev])
        })
        .subscribe()
    })()
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [loading, userRole, userCompany])

  // Notes unread count (realtime)
  useEffect(() => {
    if (loading || !userId) return
    async function refreshUnread() {
      const { data, error } = await supabase.from('notes').select('id, read_by, author_name').is('deleted_at', null).is('parent_id', null)
      if (error) {
        if ((error as { code?: string }).code === '42703') {
          // v1 schema fallback
          const { data: d2 } = await supabase.from('notes').select('id, read_by, author_name').is('parent_id', null)
          if (d2) setNotesUnread(d2.filter(n => !(n.read_by ?? []).includes(userId) && n.author_name !== authorName).length)
        }
        return
      }
      setNotesUnread((data ?? []).filter(n => !(n.read_by ?? []).includes(userId) && n.author_name !== authorName).length)
    }
    refreshUnread()
    const ch = supabase.channel('notes-unread-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => refreshUnread())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loading, userId, authorName])

  const handleUpdate = useCallback((id: string, patch: Partial<Intervention>) => {
    setInterventions(prev => prev.map(iv => iv.id === id ? { ...iv, ...patch } : iv))
  }, [])

  const handleAdd = useCallback((iv: Intervention) => {
    setInterventions(prev => [...prev, iv])
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function handleMarkAllRead() {
    const unread = notifications.filter(n => !n.read).map(n => n.id)
    if (unread.length === 0) return
    await supabase.from('notifications').update({ read: true }).in('id', unread)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const unreadCount = notifications.filter(n => !n.read).length

  if (loading) return <Loader />
  if (error)   return <ErrorScreen message={error} />

  // ── Vue sous-traitant ──
  if (userRole === 'company' && userCompany) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ background: 'var(--hdr)', color: 'var(--hdr-text)', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, zIndex: 50 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: '.06em', opacity: .45 }}>PLANIFY</span>
            <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,.2)' }} />
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-.3px' }}>{userCompany}</span>
            <span style={{ fontSize: 11, opacity: .4, fontWeight: 500 }}>HSF Av. Marceau</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BellButton count={unreadCount} onClick={() => { setShowNotifs(true); handleMarkAllRead() }} />
            <button onClick={handleLogout} style={{
              background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
              borderRadius: 7, padding: '5px 10px', color: 'rgba(255,255,255,.7)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', letterSpacing: '.02em',
            }}>Déconnexion</button>
          </div>
        </header>
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {coScreen === 'mytasks' && (
            <CompanyScreen
              companyName={userCompany}
              interventions={interventions}
              zones={zones} trades={trades} companies={companies}
              authorName={authorName}
              onUpdate={handleUpdate}
            />
          )}
          {coScreen === 'planning' && (
            <PlanningScreen
              interventions={interventions} zones={zones} trades={trades} companies={companies}
              highlightCompany={userCompany}
              readOnly
              authorName={authorName}
              onUpdate={handleUpdate} onAdd={handleAdd}
            />
          )}
          {coScreen === 'notes' && (
            <NotesScreen
              interventions={interventions} zones={zones} trades={trades} companies={companies}
              authorName={authorName} userId={userId ?? undefined}
              userRole={userRole} userCompany={userCompany}
            />
          )}
        </main>
        {showNotifs && <NotifPanel notifications={notifications} onClose={() => setShowNotifs(false)} onNavigate={s => { setCoScreen(s === 'notes' ? 'notes' : s === 'planning' ? 'planning' : 'mytasks'); setShowNotifs(false) }} />}
        <nav style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', flexShrink: 0 }}>
          {([{ id: 'mytasks', label: 'Mes tâches', icon: '≡' }, { id: 'planning', label: 'Planning', icon: '▦' }, { id: 'notes', label: 'Notes', icon: '📝' }] as { id: CompanyScreen; label: string; icon: string }[]).map(item => {
            const active = coScreen === item.id
            return (
              <button key={item.id} onClick={() => setCoScreen(item.id)} style={{
                flex: 1, padding: '8px 0 10px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 3, border: 'none', cursor: 'pointer', background: 'transparent',
                color: active ? 'var(--primary)' : 'var(--xmuted)', fontWeight: active ? 600 : 400, fontSize: 10,
                borderTop: active ? '2px solid var(--primary)' : '2px solid transparent',
              }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
                {item.label}
              </button>
            )
          })}
        </nav>
      </div>
    )
  }

  // ── Vue externe (MOE, AMO, architecte…) ──
  if (userRole === 'external') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ background: 'var(--hdr)', color: 'var(--hdr-text)', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, zIndex: 50 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: '.06em', opacity: .45 }}>PLANIFY</span>
            <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,.2)' }} />
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-.3px' }}>{authorName}</span>
            <span style={{ fontSize: 11, opacity: .4, fontWeight: 500 }}>HSF Av. Marceau</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AccountPill name={authorName} />
            <BellButton count={unreadCount} onClick={() => { setShowNotifs(true); handleMarkAllRead() }} />
            <button onClick={handleLogout} style={{
              background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
              borderRadius: 7, padding: '5px 10px', color: 'rgba(255,255,255,.7)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', letterSpacing: '.02em',
            }}>Déconnexion</button>
          </div>
        </header>
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {extScreen === 'dashboard' && (
            <DashboardScreen zones={zones} interventions={interventions} trades={trades} companies={companies} authorName={authorName} onUpdate={handleUpdate} visibleBlocks={extPerms} />
          )}
          {extScreen === 'planning' && (
            <PlanningScreen
              interventions={interventions} zones={zones} trades={trades} companies={companies}
              readOnly authorName={authorName}
              onUpdate={handleUpdate} onAdd={handleAdd}
            />
          )}
          {extScreen === 'briefings' && (
            <BriefingsScreen interventions={interventions} zones={zones} trades={trades} companies={companies} readOnly />
          )}
          {extScreen === 'notes' && (
            <NotesScreen
              interventions={interventions} zones={zones} trades={trades} companies={companies}
              authorName={authorName} userId={userId ?? undefined}
              userRole={userRole}
            />
          )}
        </main>
        {showNotifs && <NotifPanel notifications={notifications} onClose={() => setShowNotifs(false)} onNavigate={s => { setExtScreen(s === 'notes' ? 'notes' : s === 'briefings' ? 'briefings' : s === 'dashboard' ? 'dashboard' : 'planning'); setShowNotifs(false) }} />}
        <nav style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', flexShrink: 0 }}>
          {([{ id: 'dashboard', label: 'Dashboard', icon: '◉' }, { id: 'planning', label: 'Planning', icon: '▦' }, { id: 'briefings', label: 'Briefings', icon: '◎' }, { id: 'notes', label: 'Notes', icon: '📝' }] as { id: ExternalScreen; label: string; icon: string }[]).map(item => {
            const active = extScreen === item.id
            return (
              <button key={item.id} onClick={() => setExtScreen(item.id)} style={{
                flex: 1, padding: '8px 0 10px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 3, border: 'none', cursor: 'pointer', background: 'transparent',
                color: active ? 'var(--primary)' : 'var(--xmuted)', fontWeight: active ? 600 : 400, fontSize: 10,
                borderTop: active ? '2px solid var(--primary)' : '2px solid transparent',
              }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
                {item.label}
              </button>
            )
          })}
        </nav>
      </div>
    )
  }

  // ── Vue admin ──
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppHeader screen={screen} onNavigate={setScreen} interventions={interventions} onLogout={handleLogout} unreadCount={unreadCount} onOpenNotifs={() => { setShowNotifs(true); handleMarkAllRead() }} authorName={authorName} />
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {screen === 'dashboard' && <DashboardScreen zones={zones} interventions={interventions} trades={trades} companies={companies} authorName={authorName} onUpdate={handleUpdate} />}
        {screen === 'list' && <ListScreen interventions={interventions} zones={zones} trades={trades} onUpdate={handleUpdate} />}
        {screen === 'planning' && <PlanningScreen interventions={interventions} zones={zones} trades={trades} companies={companies} onUpdate={handleUpdate} onAdd={handleAdd} />}
        {screen === 'notes' && <NotesScreen interventions={interventions} zones={zones} trades={trades} companies={companies} authorName={authorName} userId={userId ?? undefined} userRole={userRole} userCompany={userCompany ?? undefined} />}
        {screen === 'briefings' && <BriefingsScreen interventions={interventions} zones={zones} trades={trades} companies={companies} />}
        {screen === 'settings' && <SettingsScreen zones={zones} trades={trades} companies={companies} onZonesChange={setZones} onTradesChange={setTrades} onCompaniesChange={setCompanies} />}
      </main>
      {showNotifs && <NotifPanel notifications={notifications} onClose={() => setShowNotifs(false)} onNavigate={s => { setScreen(s); setShowNotifs(false) }} />}
      <BottomNav screen={screen} onNavigate={setScreen} notesUnread={notesUnread} />
    </div>
  )
}

// ─── Bell button ──────────────────────────────────────────────────────────────

function BellButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      position: 'relative', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
      borderRadius: 7, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', fontSize: 16,
    }}>
      🔔
      {count > 0 && (
        <span style={{
          position: 'absolute', top: -5, right: -5,
          background: '#EF4444', color: '#fff', borderRadius: 99,
          fontSize: 9, fontWeight: 800, minWidth: 16, height: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
          border: '1.5px solid var(--hdr)',
        }}>{count > 9 ? '9+' : count}</span>
      )}
    </button>
  )
}

// ─── Notifications panel ──────────────────────────────────────────────────────

function NotifPanel({ notifications, onClose, onNavigate }: { notifications: AppNotification[]; onClose: () => void; onNavigate: (s: Screen) => void }) {
  function fmtTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const diff = Math.floor((now.getTime() - d.getTime()) / 60000)
    if (diff < 1)   return 'À l\'instant'
    if (diff < 60)  return `Il y a ${diff} min`
    if (diff < 1440) return `Il y a ${Math.floor(diff / 60)}h`
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  }
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100, backdropFilter: 'blur(2px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
        background: 'var(--surface)', borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,.18)',
        maxHeight: '75vh', display: 'flex', flexDirection: 'column',
        animation: 'slideUp .22s ease-out',
      }}>
        <div style={{ padding: '12px 0 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Notifications</span>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--surface-2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 24px' }}>
          {notifications.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>Aucune notification</div>
          ) : notifications.map(n => (
            <div key={n.id}
              onClick={() => onNavigate(n.message.startsWith('📢') ? 'notes' : 'list')}
              style={{
                padding: '11px 12px', marginBottom: 8, borderRadius: 'var(--r)',
                background: n.read ? 'var(--surface-2)' : 'var(--primary-l)',
                border: `1px solid ${n.read ? 'var(--border)' : 'var(--primary)'}`,
                borderLeft: `3px solid ${n.read ? 'var(--border)' : 'var(--primary)'}`,
                cursor: 'pointer',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: 'var(--text)', lineHeight: 1.4 }}>{n.message}</div>
                  {n.task_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Tâche : {n.task_name}</div>}
                </div>
                <span style={{ fontSize: 10, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtTime(n.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function AppHeader({ screen, onNavigate, interventions, onLogout, unreadCount, onOpenNotifs, authorName }: {
  screen: Screen; onNavigate: (s: Screen) => void; interventions: Intervention[]
  onLogout: () => void; unreadCount: number; onOpenNotifs: () => void; authorName: string
}) {
  const blocked = interventions.filter(iv => iv.status === 'bloque').length
  const labels: Record<Screen, string> = {
    dashboard: 'Dashboard', planning: 'Planning', list: 'Tâches', notes: 'Notes', briefings: 'Briefings', settings: 'Paramètres',
  }
  return (
    <header style={{
      background: 'var(--hdr)', color: 'var(--hdr-text)',
      padding: '0 16px', height: 52, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', flexShrink: 0, zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: '.06em', opacity: .45 }}>PLANIFY</span>
        <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,.2)' }} />
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-.3px' }}>{labels[screen]}</span>
        {screen === 'dashboard' && (
          <span style={{ fontSize: 11, opacity: .4, fontWeight: 500 }}>HSF Av. Marceau</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {blocked > 0 && (
          <button onClick={() => onNavigate('list')} style={{
            background: 'rgba(220,38,38,.18)', border: '1px solid rgba(220,38,38,.3)',
            borderRadius: 6, padding: '3px 8px', color: '#F87171',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            ⚠ {blocked} bloquée{blocked > 1 ? 's' : ''}
          </button>
        )}
        <AccountPill name={authorName} />
        <BellButton count={unreadCount} onClick={onOpenNotifs} />
        <button onClick={onLogout} style={{
          background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
          borderRadius: 7, padding: '5px 10px', color: 'rgba(255,255,255,.7)',
          fontSize: 11, fontWeight: 600, cursor: 'pointer', letterSpacing: '.02em',
        }}>Déconnexion</button>
      </div>
    </header>
  )
}

function AccountPill({ name }: { name: string }) {
  const [open, setOpen]     = useState(false)
  const [draft, setDraft]   = useState(name)
  const [email, setEmail]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => { setDraft(name) }, [name])
  useEffect(() => {
    if (!open) return
    supabase.auth.getUser().then(({ data: { user } }) => setEmail(user?.email ?? ''))
  }, [open])

  async function save() {
    setSaving(true); setError(null)
    const { error: err } = await supabase.auth.updateUser({ data: { display_name: draft.trim() || null } })
    setSaving(false)
    if (err) { setError(err.message); return }
    setOpen(false)
    window.location.reload()
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Modifier mon nom" style={{
        background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
        borderRadius: 7, padding: '5px 10px', color: 'rgba(255,255,255,.85)',
        fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em',
        display: 'flex', alignItems: 'center', gap: 6, maxWidth: 160,
      }}>
        <span style={{ fontSize: 12, opacity: .7 }}>👤</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 201,
            background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: 12, width: 260,
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
              Mon nom
            </div>
            <input
              autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              placeholder="ex. Franco"
              style={{
                width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface-2)', color: 'var(--text)', padding: '8px 10px', fontSize: 13,
                fontFamily: "'DM Sans', sans-serif",
              }}
            />
            {email && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>Compte : {email}</div>}
            {error && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 6 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button onClick={() => setOpen(false)} style={{
                flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)',
                background: 'var(--surface-2)', color: 'var(--text)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>Annuler</button>
              <button onClick={save} disabled={saving} style={{
                flex: 1, padding: '7px 10px', borderRadius: 7, border: 'none',
                background: 'var(--primary)', color: '#fff', fontSize: 11, fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer',
              }}>{saving ? '…' : 'Enregistrer'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Bottom nav ───────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Screen; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'planning',  label: 'Planning',  icon: '▦' },
  { id: 'list',      label: 'Tâches',    icon: '≡' },
  { id: 'notes',     label: 'Notes',     icon: '📝' },
  { id: 'briefings', label: 'Briefings', icon: '◎' },
  { id: 'settings',  label: 'Réglages',  icon: '⚙' },
]

function BottomNav({ screen, onNavigate, notesUnread = 0 }: { screen: Screen; onNavigate: (s: Screen) => void; notesUnread?: number }) {
  return (
    <nav style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', flexShrink: 0 }}>
      {NAV_ITEMS.map(item => {
        const active = screen === item.id
        const badge = item.id === 'notes' && notesUnread > 0 ? notesUnread : 0
        return (
          <button key={item.id} onClick={() => onNavigate(item.id)} style={{
            flex: 1, padding: '8px 0 10px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 3, border: 'none', cursor: 'pointer', background: 'transparent',
            color: active ? 'var(--primary)' : 'var(--xmuted)',
            fontWeight: active ? 600 : 400, fontSize: 10,
            borderTop: active ? '2px solid var(--primary)' : '2px solid transparent',
            position: 'relative',
          }}>
            <span style={{ fontSize: 16, lineHeight: 1, position: 'relative' }}>
              {item.icon}
              {badge > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -8,
                  background: '#DC2626', color: '#fff', borderRadius: 99,
                  fontSize: 8.5, fontWeight: 800, minWidth: 14, height: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                  border: '1.5px solid var(--surface)',
                }}>{badge > 9 ? '9+' : badge}</span>
              )}
            </span>
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardScreen({ zones, interventions, trades, companies, authorName, onUpdate, visibleBlocks }: {
  zones: Zone[]; interventions: Intervention[]; trades: Trade[]; companies: Company[]; authorName: string
  onUpdate: (id: string, patch: Partial<Intervention>) => void
  visibleBlocks?: { sante: boolean; taches: boolean; trades: boolean; zones: boolean }
}) {
  const show = visibleBlocks ?? { sante: true, taches: true, trades: true, zones: true }
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [expandedStatus, setExpandedStatus] = useState<string | null>(null)
  const [expandedTrade, setExpandedTrade]   = useState<string | null>(null)
  const [expandedZone, setExpandedZone]     = useState<string | null>(null)
  const health = computeProjectHealth(interventions, zones)
  const { avancementReel, cadenceCible, derive, fiabilite, alertes } = health
  const total    = interventions.length
  const termine  = interventions.filter(iv => iv.status === 'termine').length
  const encours  = interventions.filter(iv => iv.status === 'encours').length
  const bloque   = interventions.filter(iv => iv.status === 'bloque').length
  const enRetard = interventions.filter(iv => effectiveStatus(iv) === 'en_retard').length

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tasksDue  = interventions.filter(iv => { const e = iv.end_date ?? iv.start_date; return e && new Date(e + 'T00:00:00') <= today }).length
  const tasksDone = interventions.filter(iv => { const e = iv.end_date ?? iv.start_date; return e && new Date(e + 'T00:00:00') <= today && iv.status === 'termine' }).length

  const selectedIv = selectedId ? interventions.find(iv => iv.id === selectedId) ?? null : null

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>


      {/* ── Santé du projet ── */}
      {show.sante && (
      <Card title="Santé du projet">
        {/* Hero: tâches terminées */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 44, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{termine}</span>
          <span style={{ fontSize: 18, color: 'var(--muted)', fontWeight: 500, paddingBottom: 4 }}>/ {total} tâches terminées</span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${Math.round(termine / Math.max(total, 1) * 100)}%`, background: 'linear-gradient(90deg, var(--primary), #4B7CF3)', borderRadius: 99, transition: 'width .6s' }} />
        </div>

        {/* Alert pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20,
            background: enRetard > 0 ? 'rgba(234,88,12,.12)' : 'var(--surface-2)',
            border: `1px solid ${enRetard > 0 ? 'rgba(234,88,12,.35)' : 'var(--border)'}`,
            fontSize: 12, fontWeight: 700, color: enRetard > 0 ? STATUS_META.en_retard.dot : 'var(--muted)',
          }}>
            ⏱ {enRetard} en retard
          </span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20,
            background: bloque > 0 ? 'var(--danger-l)' : 'var(--surface-2)',
            border: `1px solid ${bloque > 0 ? 'rgba(220,38,38,.35)' : 'var(--border)'}`,
            fontSize: 12, fontWeight: 700, color: bloque > 0 ? 'var(--danger)' : 'var(--muted)',
          }}>
            ⛔ {bloque} bloquée{bloque > 1 ? 's' : ''}
          </span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            fontSize: 12, fontWeight: 600, color: 'var(--muted)',
          }}>
            ● {encours} en cours
          </span>
        </div>

        {/* Fiabilité */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Fiabilité du planning</div>
            <div style={{ fontSize: 12, color: 'var(--text)' }}>
              {tasksDone} tâches terminées sur <strong>{tasksDue}</strong> qui étaient dues à ce jour
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: fiabilite > 70 ? 'var(--success)' : 'var(--danger)', flexShrink: 0, marginLeft: 12 }}>
            {fiabilite}%
          </div>
        </div>
      </Card>
      )}

      {/* ── Tâches ── */}
      {show.taches && (
      <Card title="Tâches">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {([
            { key: 'total',     label: 'Total',     value: total,    color: 'var(--primary)',        tasks: interventions },
            { key: 'termine',   label: 'Terminé',   value: termine,  color: STATUS_META.termine.dot,   tasks: interventions.filter(iv => iv.status === 'termine') },
            { key: 'encours',   label: 'En cours',  value: encours,  color: STATUS_META.encours.dot,   tasks: interventions.filter(iv => iv.status === 'encours') },
            { key: 'en_retard', label: 'En retard', value: enRetard, color: STATUS_META.en_retard.dot, tasks: interventions.filter(iv => effectiveStatus(iv) === 'en_retard') },
            { key: 'bloque',    label: 'Bloqué',    value: bloque,   color: STATUS_META.bloque.dot,    tasks: interventions.filter(iv => iv.status === 'bloque') },
          ]).map(({ key, label, value, color, tasks }) => {
            const active = expandedStatus === key
            return (
              <button key={key} onClick={() => setExpandedStatus(active ? null : key)} style={{
                background: active ? color + '18' : 'var(--surface-2)',
                borderRadius: 'var(--r-sm)', padding: '8px 4px', textAlign: 'center',
                border: `1px solid ${active ? color + '55' : 'transparent'}`,
                cursor: tasks.length > 0 ? 'pointer' : 'default',
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 9, color: active ? color : 'var(--muted)', marginTop: 2, lineHeight: 1.2, fontWeight: active ? 700 : 400 }}>{label}</div>
              </button>
            )
          })}
        </div>
        {total > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ flex: termine,    background: STATUS_META.termine.dot }} />
              <div style={{ flex: encours,    background: STATUS_META.encours.dot }} />
              <div style={{ flex: enRetard,   background: STATUS_META.en_retard.dot }} />
              <div style={{ flex: bloque,     background: STATUS_META.bloque.dot }} />
              <div style={{ flex: total - termine - encours - enRetard - bloque, background: 'var(--border)' }} />
            </div>
          </div>
        )}
        {/* Expanded task list */}
        {expandedStatus && (() => {
          const list = expandedStatus === 'total'     ? interventions
                     : expandedStatus === 'termine'   ? interventions.filter(iv => iv.status === 'termine')
                     : expandedStatus === 'encours'   ? interventions.filter(iv => iv.status === 'encours')
                     : expandedStatus === 'en_retard' ? interventions.filter(iv => effectiveStatus(iv) === 'en_retard')
                     : interventions.filter(iv => iv.status === 'bloque')
          if (list.length === 0) return null
          return (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>
                {list.length} tâche{list.length > 1 ? 's' : ''}
              </div>
              {list.slice(0, 20).map(iv => (
                <TaskRow key={iv.id} iv={iv} zones={zones} trades={trades} onClick={() => setSelectedId(iv.id)} />
              ))}
              {list.length > 20 && (
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '4px 0' }}>+ {list.length - 20} autres</div>
              )}
            </div>
          )
        })()}
      </Card>
      )}

      {/* ── Par corps de métier ── */}
      {show.trades && trades.length > 0 && (
        <Card title="Par corps de métier">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {trades.map(t => {
              const tTasks   = interventions.filter(iv => iv.trade === t.id)
              if (tTasks.length === 0) return null
              const tDone    = tTasks.filter(iv => iv.status === 'termine').length
              const tEncours = tTasks.filter(iv => iv.status === 'encours').length
              const tLate    = tTasks.filter(iv => effectiveStatus(iv) === 'en_retard').length
              const tBlocked = tTasks.filter(iv => iv.status === 'bloque').length
              const tARealis = tTasks.length - tDone - tEncours - tLate - tBlocked
              const pct      = Math.round(tDone / tTasks.length * 100)
              const tc       = getTradeColor(t.color)
              const hasAlert = tLate > 0 || tBlocked > 0
              const open     = expandedTrade === t.id
              const sorted   = [...tTasks].sort((a, b) => {
                const rank = (iv: Intervention) => effectiveStatus(iv) === 'en_retard' ? 0 : iv.status === 'bloque' ? 1 : iv.status === 'encours' ? 2 : iv.status === 'termine' ? 4 : 3
                return rank(a) - rank(b)
              })
              return (
                <div key={t.id} style={{ borderLeft: `3px solid ${tc.b}`, paddingLeft: 10 }}>
                  {/* Clickable header */}
                  <button onClick={() => setExpandedTrade(open ? null : t.id)} style={{
                    width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{t.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18, fontWeight: 800, color: pct === 100 ? 'var(--success)' : hasAlert ? STATUS_META.en_retard.dot : 'var(--primary)', lineHeight: 1 }}>{pct}%</span>
                        <span style={{ fontSize: 12, color: 'var(--muted)', transition: 'transform .2s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 6px' }}>
                      {tDone > 0    && <span style={{ color: STATUS_META.termine.dot,   fontWeight: 600 }}>✓ {tDone} terminée{tDone > 1 ? 's' : ''}</span>}
                      {tEncours > 0 && <span style={{ color: STATUS_META.encours.dot,   fontWeight: 600 }}>● {tEncours} en cours</span>}
                      {tLate > 0    && <span style={{ color: STATUS_META.en_retard.dot, fontWeight: 700 }}>⏱ {tLate} en retard</span>}
                      {tBlocked > 0 && <span style={{ color: STATUS_META.bloque.dot,   fontWeight: 700 }}>⛔ {tBlocked} bloquée{tBlocked > 1 ? 's' : ''}</span>}
                      {tARealis > 0 && <span style={{ color: 'var(--xmuted)' }}>◌ {tARealis} à venir</span>}
                    </div>
                    <div style={{ display: 'flex', height: 5, borderRadius: 99, overflow: 'hidden', background: 'var(--border)' }}>
                      <div style={{ flex: tDone,    background: STATUS_META.termine.dot }} />
                      <div style={{ flex: tEncours, background: STATUS_META.encours.dot }} />
                      <div style={{ flex: tLate,    background: STATUS_META.en_retard.dot }} />
                      <div style={{ flex: tBlocked, background: STATUS_META.bloque.dot }} />
                      <div style={{ flex: tARealis, background: 'transparent' }} />
                    </div>
                  </button>
                  {/* Expanded task list */}
                  {open && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {sorted.map(iv => (
                        <TaskRow key={iv.id} iv={iv} zones={zones} trades={trades} onClick={() => setSelectedId(iv.id)} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}


      {/* ── Par zones ── */}
      {show.zones && zones.length > 0 && (
        <Card title="Par zones">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {zones.map(z => {
              const zTasks   = interventions.filter(iv => iv.zone === z.id)
              if (zTasks.length === 0) return null
              const zDone    = zTasks.filter(iv => iv.status === 'termine').length
              const zEncours = zTasks.filter(iv => iv.status === 'encours').length
              const zLate    = zTasks.filter(iv => effectiveStatus(iv) === 'en_retard').length
              const zBlocked = zTasks.filter(iv => iv.status === 'bloque').length
              const zARealis = zTasks.length - zDone - zEncours - zLate - zBlocked
              const pct      = Math.round(zDone / zTasks.length * 100)
              const hasAlert = zLate > 0 || zBlocked > 0
              const open     = expandedZone === z.id
              const sorted   = [...zTasks].sort((a, b) => {
                const rank = (iv: Intervention) => effectiveStatus(iv) === 'en_retard' ? 0 : iv.status === 'bloque' ? 1 : iv.status === 'encours' ? 2 : iv.status === 'arealis' ? 3 : 4
                return rank(a) - rank(b)
              })
              return (
                <div key={z.id} style={{ borderLeft: `3px solid ${z.floor_color ?? '#9CA3AF'}`, paddingLeft: 10 }}>
                  <button onClick={() => setExpandedZone(open ? null : z.id)} style={{
                    width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{z.short}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: pct === 100 ? 'var(--success)' : hasAlert ? STATUS_META.en_retard.dot : 'var(--primary)' }}>{pct}%</span>
                        <span style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s' }}>▾</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 6px' }}>
                      {zDone > 0    && <span style={{ color: STATUS_META.termine.dot,   fontWeight: 600 }}>✓ {zDone} terminée{zDone > 1 ? 's' : ''}</span>}
                      {zEncours > 0 && <span style={{ color: STATUS_META.encours.dot,   fontWeight: 600 }}>● {zEncours} en cours</span>}
                      {zLate > 0    && <span style={{ color: STATUS_META.en_retard.dot, fontWeight: 700 }}>⏱ {zLate} en retard</span>}
                      {zBlocked > 0 && <span style={{ color: STATUS_META.bloque.dot,   fontWeight: 700 }}>⛔ {zBlocked} bloquée{zBlocked > 1 ? 's' : ''}</span>}
                      {zARealis > 0 && <span style={{ color: 'var(--xmuted)' }}>◌ {zARealis} à venir</span>}
                    </div>
                    <div style={{ display: 'flex', height: 5, borderRadius: 99, overflow: 'hidden', background: 'var(--border)' }}>
                      <div style={{ flex: zDone,    background: STATUS_META.termine.dot }} />
                      <div style={{ flex: zEncours, background: STATUS_META.encours.dot }} />
                      <div style={{ flex: zLate,    background: STATUS_META.en_retard.dot }} />
                      <div style={{ flex: zBlocked, background: STATUS_META.bloque.dot }} />
                      <div style={{ flex: zARealis, background: 'transparent' }} />
                    </div>
                  </button>
                  {open && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {sorted.map(iv => (
                        <TaskRow key={iv.id} iv={iv} zones={zones} trades={trades} onClick={() => setSelectedId(iv.id)} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Task detail overlay */}
      {selectedIv && (
        <TaskDetail
          iv={selectedIv}
          zones={zones}
          trades={trades}
          companies={companies}
          allInterventions={interventions}
          authorName={authorName}
          onClose={() => setSelectedId(null)}
          onUpdate={(patch) => { onUpdate(selectedIv.id, patch); setSelectedId(null) }}
        />
      )}

    </div>
  )
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 'var(--r)', border: '1px solid var(--border)', padding: '14px 16px', boxShadow: 'var(--shadow)' }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.5px' }}>{title}</div>
      {children}
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function TaskRow({ iv, zones, trades, onClick }: { iv: Intervention; zones: Zone[]; trades: Trade[]; onClick: () => void }) {
  const es    = effectiveStatus(iv)
  const sm    = STATUS_META[es]
  const zone  = zones.find(z => z.id === iv.zone)
  const trade = trades.find(t => t.id === iv.trade)
  const tc    = getTradeColor(trade?.color ?? 'blue')
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 10px', background: 'var(--surface-2)',
      border: `1px solid var(--border)`, borderLeft: `3px solid ${sm.dot}`,
      borderRadius: 'var(--r-xs)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {iv.task}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1, display: 'flex', gap: 6 }}>
          {iv.task_number && <span style={{ color: tc.b, fontFamily: "'DM Mono', monospace" }}>{iv.task_number}</span>}
          {zone && <span>{zone.short}</span>}
          {iv.company && <span>· {iv.company}</span>}
        </div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: sm.dot, background: sm.bg, padding: '2px 7px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {sm.label}
      </span>
    </button>
  )
}

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--xmuted)', marginTop: 4, lineHeight: 1.3 }}>{sub}</div>
    </div>
  )
}

function ComingSoon({ screen }: { screen: Screen }) {
  const labels: Record<Screen, string> = { dashboard: 'Dashboard', planning: 'Planning', list: 'Liste des tâches', notes: 'Notes', briefings: 'Briefings', settings: 'Paramètres' }
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--muted)' }}>
      <div style={{ fontSize: 40 }}>🚧</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{labels[screen]}</div>
      <div style={{ fontSize: 13 }}>En cours de migration</div>
    </div>
  )
}

function Loader() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>Chargement Planify…</div>
      </div>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ background: 'var(--danger-l)', border: '1px solid var(--danger)', borderRadius: 'var(--r)', padding: 24, maxWidth: 360 }}>
        <div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 8 }}>Erreur de connexion</div>
        <div style={{ fontSize: 12, color: 'var(--danger)', opacity: .8 }}>{message}</div>
      </div>
    </div>
  )
}
