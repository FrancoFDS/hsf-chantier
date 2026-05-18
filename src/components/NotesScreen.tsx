'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Note, NoteScope, NoteStatus, NoteCategory, NoteAttachment, Intervention, Zone, Trade, Company } from '@/types/database'

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES: { value: NoteCategory; label: string; icon: string; color: string }[] = [
  { value: 'info',     label: 'Info',     icon: 'ℹ',  color: '#2152C8' },
  { value: 'demande',  label: 'Demande',  icon: '?',  color: '#7C3AED' },
  { value: 'reserve',  label: 'Réserve',  icon: '!',  color: '#EA580C' },
  { value: 'incident', label: 'Incident', icon: '⚠', color: '#DC2626' },
  { value: 'rappel',   label: 'Rappel',   icon: '⏰', color: '#D97706' },
]

const STATUSES: { value: NoteStatus; label: string; color: string; bg: string }[] = [
  { value: 'ouvert',    label: 'Ouvert',    color: '#2152C8', bg: '#EEF2FC' },
  { value: 'en_cours',  label: 'En cours',  color: '#D97706', bg: '#FEF3C7' },
  { value: 'en_retard', label: 'En retard', color: '#DC2626', bg: '#FEE2E2' },
  { value: 'resolu',    label: 'Résolu',    color: '#16A34A', bg: '#DCFCE7' },
  { value: 'termine',   label: 'Terminé',   color: '#6B6860', bg: '#EFEDE8' },
]

// ─── In-app notifications ──────────────────────────────────────────────────

async function notifyForNewNote(note: Note, companies: Company[]) {
  // Concerned = company_codes ∪ mentioned_companies, except author's own company
  const concerned = new Set<string>([...note.company_codes, ...(note.mentioned_companies ?? [])])
  concerned.delete(note.author_name)
  if (concerned.size === 0) return

  const knownCompanies = new Set(companies.map(c => c.name))
  const inserts = [...concerned]
    .filter(name => knownCompanies.has(name))
    .map(companyName => ({
      recipient_role: 'company',
      recipient_company: companyName,
      intervention_id: note.intervention_id,
      task_name: note.title?.slice(0, 80) ?? note.content.slice(0, 60),
      message: note.mentioned_companies?.includes(companyName)
        ? `💬 ${note.author_name} vous a mentionné·e dans une note`
        : `📝 Nouvelle note de ${note.author_name}`,
      read: false,
    }))

  if (inserts.length > 0) {
    const { error } = await supabase.from('notifications').insert(inserts)
    if (error) console.warn('notif insert (new note)', error)
  }
}

async function notifyForReply(reply: Note, parent: Note, thread: Note[], companies: Company[]) {
  const recipients = new Set<string>()
  if (parent.author_name && parent.author_name !== reply.author_name) recipients.add(parent.author_name)
  for (const r of thread) {
    if (r.id !== reply.id && r.author_name !== reply.author_name) recipients.add(r.author_name)
  }
  if (recipients.size === 0) return

  const knownCompanies = new Set(companies.map(c => c.name))
  const inserts = [...recipients].map(name => {
    const isCompany = knownCompanies.has(name)
    return {
      recipient_role: isCompany ? 'company' : 'admin',
      recipient_company: isCompany ? name : null,
      intervention_id: parent.intervention_id,
      task_name: parent.title?.slice(0, 80) ?? parent.content.slice(0, 60),
      message: `💬 ${reply.author_name} a répondu à une note`,
      read: false,
    }
  })

  const { error } = await supabase.from('notifications').insert(inserts)
  if (error) console.warn('notif insert (reply)', error)
}

function isLate(n: Note): boolean {
  if (!n.due_date) return false
  if (n.status === 'resolu' || n.status === 'termine') return false
  return n.due_date < new Date().toISOString().slice(0, 10)
}

/** Effective status: auto-bump to 'en_retard' if due_date passed and not resolved */
function effectiveNoteStatus(n: Note): NoteStatus {
  if (n.status === 'ouvert' || n.status === 'en_cours') {
    if (isLate(n)) return 'en_retard'
  }
  return n.status
}

const SCOPES: { value: 'all' | NoteScope; label: string }[] = [
  { value: 'all',          label: 'Toutes' },
  { value: 'intervention', label: 'Liées au planning' },
  { value: 'libre',        label: 'Libres' },
]

function catMeta(c: NoteCategory | null) {
  return CATEGORIES.find(x => x.value === c) ?? { value: 'info' as NoteCategory, label: '—', icon: '·', color: '#6B6860' }
}
function statusMeta(s: NoteStatus) {
  return STATUSES.find(x => x.value === s) ?? STATUSES[0]
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'à l’instant'
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `il y a ${d} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function fmtDue(ds: string | null): { txt: string; late: boolean } | null {
  if (!ds) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(ds + 'T00:00:00')
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const late = diff < 0
  const txt = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  return { txt, late }
}

// ─── Main screen ───────────────────────────────────────────────────────────

interface Props {
  interventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
  authorName: string
  userId?: string
  userRole?: 'admin' | 'company'
  userCompany?: string
}

export default function NotesScreen({ interventions, zones, trades, companies, authorName, userId, userRole, userCompany }: Props) {
  const [notes,     setNotes]     = useState<Note[]>([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<{ code?: string; message: string } | null>(null)
  const [scopeFilt, setScopeFilt] = useState<'all' | NoteScope>('all')
  const [statusFilt,setStatusFilt]= useState<NoteStatus | 'all'>('all')
  const [catFilt,   setCatFilt]   = useState<NoteCategory | 'all'>('all')
  const [coFilt,    setCoFilt]    = useState<string[]>([])
  const [trFilt,    setTrFilt]    = useState<string[]>([])
  const [zoneFilt,  setZoneFilt]  = useState<string[]>([])
  const [query,     setQuery]     = useState('')
  const [showForm,  setShowForm]  = useState<{ mode: 'libre' | 'intervention'; iv?: Intervention } | null>(null)
  const [selected,  setSelected]  = useState<string | null>(null)
  const [toast,        setToast]        = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const [fabOpen,      setFabOpen]      = useState(false)
  const [showIvPicker, setShowIvPicker] = useState(false)
  const [quickView,    setQuickView]    = useState<'all' | 'mine' | 'unread' | 'late' | 'thisweek'>('all')
  const [exportOpen,   setExportOpen]   = useState(false)

  function showToast(msg: string, kind: 'success' | 'error' = 'success') {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 3200)
  }

  // Load + realtime
  useEffect(() => {
    let mounted = true
    supabase.from('notes').select('*').is('deleted_at', null).order('updated_at', { ascending: false }).then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        // Fallback for v1 schema without deleted_at column
        if ((error as { code?: string }).code === '42703') {
          supabase.from('notes').select('*').order('updated_at', { ascending: false }).then(({ data: d2, error: e2 }) => {
            if (!mounted) return
            if (e2) setLoadError({ code: (e2 as { code?: string }).code, message: e2.message })
            else setLoadError(null)
            setNotes((d2 ?? []) as Note[])
            setLoading(false)
          })
          return
        }
        console.error('notes load', error)
        setLoadError({ code: (error as { code?: string }).code, message: error.message })
      } else {
        setLoadError(null)
      }
      setNotes((data ?? []) as Note[])
      setLoading(false)
    })

    const ch = supabase.channel('notes-rt-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, payload => {
        if (!mounted) return
        if (payload.eventType === 'INSERT')        setNotes(prev => [payload.new as Note, ...prev.filter(n => n.id !== (payload.new as Note).id)])
        else if (payload.eventType === 'UPDATE')   setNotes(prev => prev.map(n => n.id === (payload.new as Note).id ? payload.new as Note : n))
        else if (payload.eventType === 'DELETE')   setNotes(prev => prev.filter(n => n.id !== (payload.old as Note).id))
      })
      .subscribe()

    return () => { mounted = false; supabase.removeChannel(ch) }
  }, [])

  // Top-level notes only in list (replies appear inside their thread)
  const topNotes = useMemo(() => notes.filter(n => !n.parent_id), [notes])

  // Reply counts grouped by parent
  const replyCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of notes) if (n.parent_id) map.set(n.parent_id, (map.get(n.parent_id) ?? 0) + 1)
    return map
  }, [notes])

  // Filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const weekStart = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString() })()
    return topNotes.filter(n => {
      // Quick view filter takes precedence
      if (quickView === 'mine'    && n.author_name !== authorName) return false
      if (quickView === 'unread'  && (n.read_by?.includes(userId ?? '') || n.author_name === authorName)) return false
      if (quickView === 'late'    && !isLate(n)) return false
      if (quickView === 'thisweek'&& (n.updated_at ?? n.created_at) < weekStart) return false

      if (scopeFilt !== 'all' && n.scope !== scopeFilt) return false
      if (statusFilt !== 'all' && n.status !== statusFilt) return false
      if (catFilt !== 'all'    && n.category !== catFilt) return false
      if (coFilt.length   && !n.company_codes.some(c => coFilt.includes(c))) return false
      if (trFilt.length   && !n.trade_codes.some(t => trFilt.includes(t))) return false
      if (zoneFilt.length && !n.zone_ids.some(z => zoneFilt.includes(z))) return false
      if (q && !(n.content.toLowerCase().includes(q) || (n.title ?? '').toLowerCase().includes(q) || n.author_name.toLowerCase().includes(q))) return false
      // Subcontractor view: only show notes that concern me (by company, trade, zone or intervention's company)
      if (userRole === 'company' && userCompany) {
        const myTradeIds = new Set(companies.filter(c => c.name === userCompany).map(c => c.trade_id).filter(Boolean) as string[])
        const myIvIds    = new Set(interventions.filter(iv => iv.company === userCompany).map(iv => iv.id))
        const concerns =
          n.company_codes.includes(userCompany)
          || n.trade_codes.some(t => myTradeIds.has(t))
          || (!!n.intervention_id && myIvIds.has(n.intervention_id))
        if (!concerns) return false
      }
      return true
    }).sort((a, b) => {
      const aLate = isLate(a)
      const bLate = isLate(b)
      if (aLate !== bLate) return aLate ? -1 : 1
      return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
    })
  }, [topNotes, scopeFilt, statusFilt, catFilt, coFilt, trFilt, zoneFilt, query, userRole, userCompany, quickView, authorName, userId, interventions, companies])

  const selectedNote = selected ? notes.find(n => n.id === selected) ?? null : null
  const selectedThread = selectedNote ? notes.filter(n => n.parent_id === selectedNote.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : []

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{ padding: '10px 12px 6px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, position: 'relative' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', flex: 1 }}>Notes</div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setExportOpen(o => !o)} style={{
              padding: '7px 11px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--muted)', fontWeight: 700, fontSize: 11,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              📄 Exports <span style={{ opacity: .6, fontSize: 9 }}>▾</span>
            </button>
            {exportOpen && (
              <>
                <div onClick={() => setExportOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 91, minWidth: 240,
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                  boxShadow: 'var(--shadow-md)', overflow: 'hidden',
                }}>
                  <a href="/export/notes/cr" target="_blank" rel="noreferrer" onClick={() => setExportOpen(false)} style={exportItemStyle}>
                    <div style={{ fontSize: 16 }}>📅</div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>CR de réunion hebdo</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Notes de la semaine, groupées par entreprise</div>
                    </div>
                  </a>
                  <a href="/export/notes/reserves" target="_blank" rel="noreferrer" onClick={() => setExportOpen(false)} style={{ ...exportItemStyle, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 16 }}>📋</div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Cahier de réserves</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Réserves ouvertes, par zone ou entreprise</div>
                    </div>
                  </a>
                  <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px 4px', fontSize: 9.5, color: 'var(--xmuted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
                    Fiche entreprise
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', padding: '0 4px 4px' }}>
                    {companies.length === 0 ? (
                      <div style={{ padding: 8, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Aucune entreprise</div>
                    ) : companies.map(c => (
                      <a key={c.id} href={`/export/notes/entreprise/${encodeURIComponent(c.name)}`} target="_blank" rel="noreferrer" onClick={() => setExportOpen(false)} style={{
                        display: 'block', padding: '6px 10px', fontSize: 11.5, color: 'var(--text)',
                        textDecoration: 'none', borderRadius: 5, marginBottom: 1,
                      }}>🏢 {c.name}</a>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setFabOpen(o => !o)} style={{
            padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)',
            color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nouvelle note <span style={{ opacity: .6, fontSize: 10 }}>▾</span>
          </button>
          {fabOpen && (
            <>
              <div onClick={() => setFabOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 91, minWidth: 240,
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                boxShadow: 'var(--shadow-md)', overflow: 'hidden',
              }}>
                <button onClick={() => { setFabOpen(false); setShowForm({ mode: 'libre' }) }} style={fabItemStyle}>
                  <div style={{ fontSize: 18 }}>📌</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Note libre</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Info générale, rappel, consigne…</div>
                  </div>
                </button>
                <button onClick={() => { setFabOpen(false); setShowIvPicker(true) }} style={{ ...fabItemStyle, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 18 }}>📅</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Note ancrée à une tâche</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Lier à une intervention du Gantt</div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Quick views */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
          {([
            { v: 'all',      label: 'Tout',            count: topNotes.length, color: '#2152C8' },
            { v: 'mine',     label: 'Mes notes',       count: topNotes.filter(n => n.author_name === authorName).length, color: '#7C3AED' },
            { v: 'unread',   label: 'Non lues',        count: topNotes.filter(n => !n.read_by?.includes(userId ?? '') && n.author_name !== authorName).length, color: '#2152C8' },
            { v: 'late',     label: 'En retard',       count: topNotes.filter(isLate).length, color: '#DC2626' },
            { v: 'thisweek', label: '7 derniers jours', count: topNotes.filter(n => (n.updated_at ?? n.created_at) >= new Date(Date.now() - 7 * 86400000).toISOString()).length, color: '#0891B2' },
          ] as const).map(v => {
            const active = quickView === v.v
            return (
              <button key={v.v} onClick={() => setQuickView(v.v)} style={{
                padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${active ? v.color : 'var(--border)'}`,
                background: active ? v.color + '12' : 'var(--surface-2)',
                color: active ? v.color : 'var(--muted)',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                {v.label}
                <span style={{
                  background: active ? v.color : 'var(--border)', color: '#fff',
                  borderRadius: 99, padding: '0 6px', fontSize: 9.5, fontWeight: 800, lineHeight: 1.6,
                }}>{v.count}</span>
              </button>
            )
          })}
        </div>

        {/* Search + scope */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Recherche…"
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12,
              fontFamily: "'DM Sans', sans-serif",
            }}
          />
          <div style={{ display: 'flex', gap: 3 }}>
            {SCOPES.map(s => (
              <button key={s.value} onClick={() => setScopeFilt(s.value)} style={{
                padding: '5px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${scopeFilt === s.value ? 'var(--primary)' : 'var(--border)'}`,
                background: scopeFilt === s.value ? 'var(--primary-l)' : 'var(--surface-2)',
                color: scopeFilt === s.value ? 'var(--primary)' : 'var(--muted)',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* Status + category filters */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setStatusFilt('all')} style={chipBtn(statusFilt === 'all')}>Tous statuts</button>
          {STATUSES.map(s => (
            <button key={s.value} onClick={() => setStatusFilt(s.value)} style={chipBtn(statusFilt === s.value, s.color, s.bg)}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, display: 'inline-block', marginRight: 4 }} />
              {s.label}
            </button>
          ))}
          <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 3px' }} />
          <button onClick={() => setCatFilt('all')} style={chipBtn(catFilt === 'all')}>Toutes catégories</button>
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setCatFilt(c.value)} style={chipBtn(catFilt === c.value, c.color)}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 80px', background: 'var(--surface-2)' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 13 }}>Chargement…</div>
        ) : loadError ? (
          <MissingTableError err={loadError} />
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
            Aucune note pour ces filtres.
          </div>
        ) : (
          filtered.map(n => (
            <NoteCard
              key={n.id}
              note={n}
              zones={zones}
              companies={companies}
              trades={trades}
              interventions={interventions}
              replyCount={replyCount.get(n.id) ?? 0}
              onClick={() => setSelected(n.id)}
            />
          ))
        )}
      </div>

      {/* Creation modal */}
      {showForm && (
        <NoteFormModal
          mode={showForm.mode}
          iv={showForm.iv}
          zones={zones}
          trades={trades}
          companies={companies}
          authorName={authorName}
          onClose={() => setShowForm(null)}
          onCreated={() => showToast('Note créée ✓', 'success')}
          onError={msg => showToast(msg, 'error')}
        />
      )}

      {/* Intervention picker for anchored notes */}
      {showIvPicker && (
        <InterventionPicker
          interventions={interventions}
          zones={zones}
          companies={companies}
          onClose={() => setShowIvPicker(false)}
          onPick={iv => { setShowIvPicker(false); setShowForm({ mode: 'intervention', iv }) }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 200,
          padding: '10px 18px', borderRadius: 10,
          background: toast.kind === 'success' ? '#15803D' : '#B91C1C',
          color: '#fff', fontSize: 13, fontWeight: 700,
          boxShadow: '0 4px 18px rgba(0,0,0,.25)', animation: 'slideUp .22s ease',
        }}>{toast.msg}</div>
      )}

      {/* Detail */}
      {selectedNote && (
        <NoteDetail
          note={selectedNote}
          thread={selectedThread}
          zones={zones}
          trades={trades}
          companies={companies}
          interventions={interventions}
          authorName={authorName}
          userId={userId}
          onClose={() => setSelected(null)}
          onToast={showToast}
        />
      )}
    </div>
  )
}

function chipBtn(active: boolean, c?: string, bg?: string): React.CSSProperties {
  return {
    padding: '4px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active && c ? c : active ? 'var(--primary)' : 'var(--border)'}`,
    background: active ? (bg ?? 'var(--primary-l)') : 'var(--surface-2)',
    color:      active ? (c  ?? 'var(--primary)') : 'var(--muted)',
    display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
  }
}

// ─── Missing table error state ──────────────────────────────────────────────

function MissingTableError({ err }: { err: { code?: string; message: string } }) {
  const isMissing = err.code === 'PGRST205' || err.message.toLowerCase().includes("could not find the table")
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid #FECACA', borderRadius: 10, padding: 18, margin: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>⚙️</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#7F1D1D' }}>
            {isMissing ? 'Table « notes » absente' : 'Erreur de chargement'}
          </div>
          <div style={{ fontSize: 11, color: '#991B1B', marginTop: 2 }}>{err.message}</div>
        </div>
      </div>
      {isMissing ? (
        <div style={{ fontSize: 12, color: '#5A5855', lineHeight: 1.5 }}>
          La table n’existe pas encore dans Supabase. Ouvre <strong>Supabase &gt; SQL Editor</strong> et lance le script <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>supabase/notes.sql</code> (et <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>supabase/notes_v2_statuses.sql</code> pour les statuts harmonisés). Puis recharge cette page.
          <div style={{ marginTop: 10, padding: 8, background: 'var(--surface-2)', borderRadius: 6, fontSize: 11, color: 'var(--muted)' }}>
            💡 Si tu viens de lancer le SQL, attends 30 s puis recharge — Supabase met parfois un instant à rafraîchir le cache PostgREST.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Recharge la page ou vérifie ta connexion réseau.</div>
      )}
      <button onClick={() => window.location.reload()} style={{
        marginTop: 12, padding: '7px 14px', borderRadius: 8, border: 'none',
        background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}>Recharger la page</button>
    </div>
  )
}

// ─── Note card ──────────────────────────────────────────────────────────────

function NoteCard({ note, zones, companies, trades, interventions, replyCount, onClick }: {
  note: Note; zones: Zone[]; companies: Company[]; trades: Trade[]; interventions: Intervention[]; replyCount: number; onClick: () => void
}) {
  const cat  = catMeta(note.category)
  const stat = statusMeta(effectiveNoteStatus(note))
  const due  = fmtDue(note.due_date)
  const ivLink = note.intervention_id ? interventions.find(i => i.id === note.intervention_id) : null
  const zoneList = note.zone_ids.map(id => zones.find(z => z.id === id)?.short ?? id).filter(Boolean)
  const coList   = note.company_codes
  const trList   = note.trade_codes.map(id => trades.find(t => t.id === id)?.short ?? id)

  return (
    <div onClick={onClick} style={{
      background: 'var(--surface)', borderRadius: 10, marginBottom: 8, padding: '10px 12px',
      border: '1px solid var(--border)', cursor: 'pointer',
      boxShadow: due?.late ? '0 0 0 2px rgba(220,38,38,.18)' : undefined,
    }}>
      {/* Top row: category + status + scope icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{
          padding: '2px 7px', borderRadius: 4, fontSize: 9.5, fontWeight: 800, color: cat.color,
          background: cat.color + '15', textTransform: 'uppercase', letterSpacing: '.04em',
        }}>{cat.icon} {cat.label}</span>
        <span style={{
          padding: '2px 7px', borderRadius: 4, fontSize: 9.5, fontWeight: 700, color: stat.color, background: stat.bg,
        }}>● {stat.label}</span>
        <span style={{ fontSize: 11, color: 'var(--xmuted)' }}>
          {note.scope === 'intervention' ? '📅' : '📌'}
        </span>
        {due && (
          <span style={{
            marginLeft: 'auto', fontSize: 10, fontWeight: 700,
            color: due.late ? '#DC2626' : 'var(--muted)',
            padding: '2px 6px', borderRadius: 4,
            background: due.late ? 'rgba(220,38,38,.10)' : 'transparent',
          }}>
            ⏰ {due.txt}
          </span>
        )}
      </div>

      {/* Title or content excerpt */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3, lineHeight: 1.3 }}>
        {note.title || note.content.slice(0, 80) + (note.content.length > 80 ? '…' : '')}
      </div>
      {note.title && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {note.content}
        </div>
      )}

      {/* Anchors */}
      {(coList.length > 0 || trList.length > 0 || zoneList.length > 0 || ivLink) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 5, marginTop: 2 }}>
          {coList.length > 0  && <span style={anchorStyle}>🏢 {coList.join(', ')}</span>}
          {trList.length > 0  && <span style={anchorStyle}>📐 {trList.join(', ')}</span>}
          {zoneList.length > 0 && <span style={anchorStyle}>📍 {zoneList.join(', ')}</span>}
          {ivLink && <span style={anchorStyle}>🔗 {ivLink.task_number || ivLink.task?.slice(0, 25)}</span>}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: 'var(--xmuted)' }}>
        <span>👤 {note.author_name}</span>
        <span>· {timeAgo(note.updated_at ?? note.created_at)}</span>
        {note.attachments.length > 0 && <span>· 📎 {note.attachments.length}</span>}
        {replyCount > 0 && <span style={{ color: 'var(--primary)', fontWeight: 700 }}>· 💬 {replyCount} {replyCount > 1 ? 'réponses' : 'réponse'}</span>}
      </div>
    </div>
  )
}

const anchorStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--muted)', background: 'var(--surface-2)',
  padding: '2px 6px', borderRadius: 4, fontWeight: 600,
}

// ─── Form modal (create note) ───────────────────────────────────────────────

export function NoteFormModal({ mode, iv, zones, trades, companies, authorName, onClose, onCreated, onError }: {
  mode: 'libre' | 'intervention'
  iv?: Intervention
  zones: Zone[]; trades: Trade[]; companies: Company[]
  authorName: string
  onClose: () => void
  onCreated?: (note: Note) => void
  onError?:   (msg: string) => void
}) {
  const [title,    setTitle]    = useState('')
  const [content,  setContent]  = useState('')
  const [cat,      setCat]      = useState<NoteCategory>('info')
  const [dueDate,  setDueDate]  = useState<string>('')
  const [coCodes,  setCoCodes]  = useState<string[]>(iv?.company ? [iv.company] : [])
  const [trCodes,  setTrCodes]  = useState<string[]>(iv?.trade   ? [iv.trade]   : [])
  const [zoneIds,  setZoneIds]  = useState<string[]>(iv?.zone    ? [iv.zone]    : [])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function submit() {
    const trimmed = content.trim()
    if (trimmed.length < 3)    { setError('Le contenu doit faire au moins 3 caractères.'); return }
    if (trimmed.length > 5000) { setError('Le contenu est trop long (5000 caractères max).'); return }
    const hasAnchor = mode === 'intervention' || coCodes.length > 0 || trCodes.length > 0 || zoneIds.length > 0
    if (!hasAnchor) { setError('Au moins un ancrage (entreprise, métier ou zone) est requis.'); return }

    setSaving(true)
    setError(null)
    const mentions = parseMentions(trimmed, companies)
    const basePayload = {
      author_name: authorName,
      title: title.trim() || null,
      content: trimmed,
      intervention_id: iv?.id ?? null,
      zone_ids:      zoneIds,
      company_codes: coCodes,
      trade_codes:   trCodes,
      scope:    mode,
      category: cat,
      status:   'ouvert' as NoteStatus,
      due_date: dueDate || null,
      parent_id: null,
      attachments: [],
    }
    const payload: Record<string, unknown> = { ...basePayload, mentioned_companies: mentions }
    let { data, error: err } = await supabase.from('notes').insert([payload]).select().single()

    // Fallback retry without v3 columns if migration not applied
    if (err && (err as { code?: string }).code === 'PGRST204') {
      const r = await supabase.from('notes').insert([basePayload]).select().single()
      data = r.data; err = r.error
    } else if (err && (err as { message?: string }).message?.toLowerCase().includes('mentioned_companies')) {
      const r = await supabase.from('notes').insert([basePayload]).select().single()
      data = r.data; err = r.error
    }

    setSaving(false)
    if (err || !data) {
      const msg = err?.message ?? 'Erreur inconnue'
      setError(msg)
      onError?.(msg)
      return
    }
    // Fire-and-forget in-app notifications
    notifyForNewNote(data as Note, companies).catch(e => console.warn('notif', e))
    onCreated?.(data as Note)
    onClose()
  }

  return (
    <>
      <div onClick={onClose} style={modalBackdrop} />
      <div style={modalSheet}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 16px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {mode === 'intervention' ? `Note sur « ${iv?.task?.slice(0, 30) ?? '—'} »` : 'Nouvelle note libre'}
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--surface-2)', cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title (optional) */}
          <div>
            <label style={lbl}>Titre <span style={{ color: 'var(--xmuted)', fontWeight: 400 }}>(optionnel)</span></label>
            <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="ex. Demande de prise électrique sup." />
          </div>

          {/* Content */}
          <div>
            <label style={lbl}>
              Contenu <span style={{ color: 'var(--danger)' }}>*</span>
              <span style={{ color: 'var(--xmuted)', fontWeight: 400, marginLeft: 8 }}>tapez @ pour mentionner une entreprise</span>
            </label>
            <MentionTextarea
              value={content} onChange={setContent}
              companies={companies}
              rows={4} autoFocus
              style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="Décrivez la note…"
            />
          </div>

          {/* Category */}
          <div>
            <label style={lbl}>Catégorie</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setCat(c.value)} style={{
                  ...chipBtn(cat === c.value, c.color),
                  padding: '6px 10px', fontSize: 11.5,
                }}>{c.icon} {c.label}</button>
              ))}
            </div>
          </div>

          {/* Anchors — required for libre mode, pre-filled for intervention */}
          <div>
            <label style={lbl}>Entreprises {mode === 'libre' && coCodes.length === 0 && trCodes.length === 0 && zoneIds.length === 0 && <span style={{ color: 'var(--danger)' }}>*</span>}</label>
            <MultiPick options={companies.map(c => ({ value: c.name, label: c.name }))} selected={coCodes} onChange={setCoCodes} placeholder="Sélectionner…" />
          </div>
          <div>
            <label style={lbl}>Corps de métier</label>
            <MultiPick options={trades.map(t => ({ value: t.id, label: t.name }))} selected={trCodes} onChange={setTrCodes} placeholder="Sélectionner…" />
          </div>
          <div>
            <label style={lbl}>Zones</label>
            <MultiPick options={zones.map(z => ({ value: z.id, label: `${z.short} – ${z.name}` }))} selected={zoneIds} onChange={setZoneIds} placeholder="Sélectionner…" />
          </div>

          {/* Due date */}
          <div>
            <label style={lbl}>Échéance <span style={{ color: 'var(--xmuted)', fontWeight: 400 }}>(optionnel)</span></label>
            <input type="date" style={inp} value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid rgba(220,38,38,.3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#DC2626' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 16px 24px', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Annuler</button>
          <button onClick={submit} disabled={saving} style={{
            flex: 2, padding: '11px 0', borderRadius: 10, border: 'none',
            background: saving ? 'var(--border)' : 'var(--primary)',
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
          }}>{saving ? 'Création…' : 'Créer la note'}</button>
        </div>
      </div>
    </>
  )
}

// ─── Mention textarea (autocomplete @entreprise) ───────────────────────────

function parseMentions(text: string, companies: Company[]): string[] {
  const found = new Set<string>()
  for (const c of companies) {
    // Match @CompanyName as whole token (word boundary or end)
    const pattern = new RegExp(`(^|[^\\w])@${c.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?=[^\\w]|$)`, 'g')
    if (pattern.test(text)) found.add(c.name)
  }
  return [...found]
}

function MentionTextarea({ value, onChange, companies, ...rest }: {
  value: string
  onChange: (next: string) => void
  companies: Company[]
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [popup, setPopup] = useState<{ query: string; tokenStart: number } | null>(null)
  const [picked, setPicked] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value)
    const cur   = e.target.selectionStart ?? e.target.value.length
    const before = e.target.value.slice(0, cur)
    const m = /(?:^|\s)@([\wÀ-ÿ-]*)$/.exec(before)
    if (m) setPopup({ query: m[1].toLowerCase(), tokenStart: before.length - m[1].length - 1 })
    else setPopup(null)
    setPicked(0)
  }

  const candidates = popup
    ? companies.filter(c => !popup.query || c.name.toLowerCase().includes(popup.query)).slice(0, 6)
    : []

  function pick(c: Company) {
    if (!popup || !taRef.current) return
    const before = value.slice(0, popup.tokenStart)
    const after  = value.slice((taRef.current.selectionStart ?? value.length))
    const inserted = `${before}@${c.name} ${after}`
    onChange(inserted)
    setPopup(null)
    setTimeout(() => {
      if (taRef.current) {
        const pos = before.length + c.name.length + 2
        taRef.current.focus()
        taRef.current.setSelectionRange(pos, pos)
      }
    }, 0)
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!popup || candidates.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setPicked(p => (p + 1) % candidates.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPicked(p => (p - 1 + candidates.length) % candidates.length) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(candidates[picked]) }
    else if (e.key === 'Escape') { e.preventDefault(); setPopup(null) }
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea ref={taRef} value={value} onChange={handleChange} onKeyDown={handleKey} {...rest} />
      {popup && candidates.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--primary)', borderRadius: 8,
          boxShadow: 'var(--shadow-md)', overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
        }}>
          <div style={{ padding: '4px 10px', fontSize: 9.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', background: 'var(--surface-2)' }}>
            Mentionner une entreprise
          </div>
          {candidates.map((c, i) => (
            <div key={c.id} onMouseDown={e => { e.preventDefault(); pick(c) }} style={{
              padding: '6px 10px', fontSize: 12, cursor: 'pointer',
              background: i === picked ? 'var(--primary-l)' : 'transparent',
              color: i === picked ? 'var(--primary)' : 'var(--text)',
              fontWeight: i === picked ? 700 : 500,
            }}>
              @{c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Multi-pick (companies/trades/zones) ────────────────────────────────────

function MultiPick({ options, selected, onChange, placeholder }: {
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [q,    setQ]    = useState('')
  const ql = q.trim().toLowerCase()
  const visible = options.filter(o => !ql || o.label.toLowerCase().includes(ql))

  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => setOpen(true)} style={{
        ...inp, minHeight: 36, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', cursor: 'text', padding: '5px 8px',
      }}>
        {selected.map((v, idx) => {
          const opt = options.find(o => o.value === v)
          return (
            <span key={`${v}-${idx}`} style={{
              padding: '2px 6px 2px 8px', borderRadius: 999, background: 'var(--primary-l)',
              color: 'var(--primary)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {opt?.label ?? v}
              <button onClick={e => { e.stopPropagation(); onChange(selected.filter(x => x !== v)) }} style={{
                border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1,
              }}>×</button>
            </span>
          )
        })}
        {selected.length === 0 && <span style={{ color: 'var(--xmuted)', fontSize: 12 }}>{placeholder}</span>}
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: 'var(--shadow-md)', zIndex: 201, maxHeight: 220, overflowY: 'auto', padding: 4,
          }}>
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Rechercher…"
              style={{ ...inp, marginBottom: 4, padding: '6px 8px', fontSize: 12 }}
            />
            {visible.length === 0 ? (
              <div style={{ padding: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>Aucun résultat</div>
            ) : visible.map((o, idx) => {
              const isSel = selected.includes(o.value)
              return (
                <div key={`${o.value}-${idx}`} onClick={() => onChange(isSel ? selected.filter(x => x !== o.value) : [...selected, o.value])} style={{
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
                  background: isSel ? 'var(--primary-l)' : 'transparent',
                  color: isSel ? 'var(--primary)' : 'var(--text)',
                  fontWeight: isSel ? 700 : 500,
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`,
                    background: isSel ? 'var(--primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSel && <span style={{ color: '#fff', fontSize: 9 }}>✓</span>}
                  </span>
                  {o.label}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Detail panel (note + thread) ───────────────────────────────────────────

function NoteDetail({ note, thread, zones, trades, companies, interventions, authorName, userId, onClose, onToast }: {
  note: Note; thread: Note[]
  zones: Zone[]; trades: Trade[]; companies: Company[]; interventions: Intervention[]
  authorName: string
  userId?: string
  onClose: () => void
  onToast: (msg: string, kind?: 'success' | 'error') => void
}) {
  const [reply,         setReply]         = useState('')
  const [saving,        setSaving]        = useState(false)
  const [status,        setStatus]        = useState<NoteStatus>(note.status)
  const [editing,       setEditing]       = useState(false)
  const [editTitle,     setEditTitle]     = useState(note.title ?? '')
  const [editContent,   setEditContent]   = useState(note.content)
  const [editDue,       setEditDue]       = useState(note.due_date ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingProof,  setPendingProof]  = useState(false)
  const [showShare,     setShowShare]     = useState(false)
  const [attachments,   setAttachments]   = useState<NoteAttachment[]>(note.attachments ?? [])
  const [uploading,     setUploading]     = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const cat    = catMeta(note.category)
  const stat   = statusMeta(status === note.status ? effectiveNoteStatus({ ...note, status }) : status)
  const due    = fmtDue(note.due_date)
  const ivLink = note.intervention_id ? interventions.find(i => i.id === note.intervention_id) : null
  const isAuthor = !!userId && note.author_id === userId || note.author_name === authorName

  // Mark as read on open
  useEffect(() => {
    if (!userId) return
    if (note.read_by?.includes(userId)) return
    supabase.from('notes').update({ read_by: [...(note.read_by ?? []), userId] }).eq('id', note.id).then(({ error }) => {
      if (error && (error as { code?: string }).code !== '42703') {
        console.warn('mark as read failed', error)
      }
    })
  }, [note.id, userId, note.read_by])

  async function postReply() {
    const txt = reply.trim()
    if (txt.length < 1) return
    setSaving(true)
    const payload = {
      author_name: authorName,
      author_id:   userId ?? null,
      content:     txt,
      parent_id:   note.id,
      scope: 'libre' as NoteScope,
      intervention_id: note.intervention_id,
      zone_ids: [], company_codes: [], trade_codes: [], attachments: [],
    }
    const { data: insertedReply, error: err } = await supabase.from('notes').insert([payload]).select().single()
    setSaving(false)
    if (err) { onToast(err.message, 'error'); return }
    setReply('')
    // Bump parent updated_at + notify
    await supabase.from('notes').update({ updated_at: new Date().toISOString() }).eq('id', note.id)
    if (insertedReply) {
      notifyForReply(insertedReply as Note, note, thread, companies).catch(e => console.warn('notif', e))
    }
  }

  async function changeStatus(newStatus: NoteStatus) {
    if (newStatus === 'en_retard') {
      onToast('« En retard » est automatique selon l’échéance.', 'error')
      return
    }
    // Force preuve obligatoire pour passer à Résolu
    if (newStatus === 'resolu' && status !== 'resolu') {
      setPendingProof(true)
      return
    }
    setStatus(newStatus)
    const { error: err } = await supabase.from('notes').update({ status: newStatus }).eq('id', note.id)
    if (err) { onToast(err.message, 'error'); setStatus(note.status); return }
    onToast(`Statut → ${statusMeta(newStatus).label}`, 'success')
  }

  async function saveEdit() {
    const trimmed = editContent.trim()
    if (trimmed.length < 3)    { onToast('Contenu trop court (min 3 caractères).', 'error'); return }
    if (trimmed.length > 5000) { onToast('Contenu trop long (5000 caractères max).', 'error'); return }
    setSaving(true)
    const patch = { title: editTitle.trim() || null, content: trimmed, due_date: editDue || null }
    const { error: err } = await supabase.from('notes').update(patch).eq('id', note.id)
    setSaving(false)
    if (err) { onToast(err.message, 'error'); return }
    setEditing(false)
    onToast('Note mise à jour ✓', 'success')
  }

  async function softDelete() {
    setSaving(true)
    const { error: err } = await supabase.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', note.id)
    setSaving(false)
    if (err) {
      if ((err as { code?: string }).code === '42703') {
        onToast('Migration v3 manquante : lance notes_v3_features.sql.', 'error')
      } else onToast(err.message, 'error')
      return
    }
    onToast('Note supprimée', 'success')
    onClose()
  }

  async function handleFile(file: File) {
    if (file.size > 10 * 1024 * 1024) { onToast('Fichier > 10 Mo refusé.', 'error'); return }
    const allowed = ['image/jpeg', 'image/png', 'application/pdf']
    if (!allowed.includes(file.type)) { onToast('Format refusé (JPG/PNG/PDF uniquement).', 'error'); return }
    setUploading(true)
    const path = `${note.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: upErr } = await supabase.storage.from('notes-attachments').upload(path, file)
    if (upErr) {
      setUploading(false)
      if (upErr.message?.toLowerCase().includes('bucket')) {
        onToast('Bucket « notes-attachments » à créer dans Supabase Storage.', 'error')
      } else onToast(upErr.message, 'error')
      return
    }
    const { data: { publicUrl } } = supabase.storage.from('notes-attachments').getPublicUrl(path)
    const next = [...attachments, { url: publicUrl, name: file.name, type: file.type, size: file.size }]
    const { error: updErr } = await supabase.from('notes').update({ attachments: next }).eq('id', note.id)
    setUploading(false)
    if (updErr) { onToast(updErr.message, 'error'); return }
    setAttachments(next)
    onToast('Pièce jointe ajoutée ✓', 'success')
  }

  async function removeAttachment(idx: number) {
    const next = attachments.filter((_, i) => i !== idx)
    const { error: err } = await supabase.from('notes').update({ attachments: next }).eq('id', note.id)
    if (err) { onToast(err.message, 'error'); return }
    setAttachments(next)
  }

  return (
    <>
      <div onClick={onClose} style={modalBackdrop} />
      <div style={{ ...modalSheet, maxHeight: '92vh' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div style={{ padding: '0 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{
              padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, color: cat.color,
              background: cat.color + '15', textTransform: 'uppercase', letterSpacing: '.04em',
            }}>{cat.icon} {cat.label}</span>
            <span style={{ fontSize: 11, color: 'var(--xmuted)' }}>{note.scope === 'intervention' ? '📅 Liée au planning' : '📌 Libre'}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {!editing && (
                <button onClick={() => setShowShare(true)} title="Partager par WhatsApp / Email" style={iconBtnStyle}>📤</button>
              )}
              {!editing && isAuthor && (
                <>
                  <button onClick={() => setEditing(true)} title="Éditer" style={iconBtnStyle}>✎</button>
                  <button onClick={() => setConfirmDelete(true)} title="Supprimer" style={{ ...iconBtnStyle, color: '#DC2626' }}>🗑</button>
                </>
              )}
              <button onClick={onClose} style={iconBtnStyle}>✕</button>
            </span>
          </div>

          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input style={inp} value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Titre (optionnel)" />
              <textarea style={{ ...inp, resize: 'vertical', fontFamily: 'inherit', minHeight: 90 }} value={editContent} onChange={e => setEditContent(e.target.value)} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Échéance :</label>
                <input type="date" style={{ ...inp, width: 'auto' }} value={editDue} onChange={e => setEditDue(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setEditing(false); setEditTitle(note.title ?? ''); setEditContent(note.content); setEditDue(note.due_date ?? '') }} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Annuler</button>
                <button onClick={saveEdit} disabled={saving} style={{ flex: 2, padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </div>
          ) : (
            <>
              {note.title && <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>{note.title}</div>}
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{note.content}</div>

              {/* Anchors */}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                {note.company_codes.length > 0 && <span style={anchorStyle}>🏢 {note.company_codes.join(', ')}</span>}
                {note.trade_codes.length > 0 && <span style={anchorStyle}>📐 {note.trade_codes.map(t => trades.find(x => x.id === t)?.name ?? t).join(', ')}</span>}
                {note.zone_ids.length > 0 && <span style={anchorStyle}>📍 {note.zone_ids.map(z => zones.find(x => x.id === z)?.short ?? z).join(', ')}</span>}
                {ivLink && <span style={anchorStyle}>🔗 {ivLink.task_number || ivLink.task?.slice(0, 30)}</span>}
                {due && <span style={{ ...anchorStyle, color: due.late ? '#DC2626' : undefined, background: due.late ? 'rgba(220,38,38,.10)' : undefined }}>⏰ {due.txt}</span>}
              </div>

              {/* Author + status changer */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--xmuted)' }}>👤 {note.author_name} · {timeAgo(note.created_at)}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {STATUSES.filter(s => s.value !== 'en_retard').map(s => (
                    <button key={s.value} onClick={() => changeStatus(s.value)} style={{
                      ...chipBtn(status === s.value, s.color, s.bg),
                      padding: '4px 8px', fontSize: 10,
                    }}>{s.label}</button>
                  ))}
                </div>
              </div>

              {/* Proof preview (when resolved) */}
              {status === 'resolu' && (note.proof_url || note.proof_comment) && (
                <div style={{ marginTop: 8, padding: 8, background: '#DCFCE7', borderRadius: 6, border: '1px solid #86EFAC' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#15803D', marginBottom: 3 }}>✓ Résolution prouvée</div>
                  {note.proof_comment && <div style={{ fontSize: 11.5, color: '#14532D' }}>{note.proof_comment}</div>}
                  {note.proof_url && (
                    <a href={note.proof_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#15803D', fontWeight: 700, marginTop: 4, display: 'inline-block' }}>📎 Voir le fichier</a>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Attachments */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              📎 Pièces jointes {attachments.length > 0 && `(${attachments.length})`}
            </span>
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{
              padding: '4px 10px', borderRadius: 6, border: '1.5px dashed var(--primary)', background: 'transparent',
              color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: uploading ? 'default' : 'pointer',
            }}>{uploading ? 'Upload…' : '+ Ajouter'}</button>
            <input
              ref={fileInputRef} type="file" hidden
              accept="image/jpeg,image/png,application/pdf"
              onChange={e => { const f = e.target.files?.[0]; if (f) { handleFile(f); e.target.value = '' } }}
            />
          </div>
          {attachments.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--xmuted)', textAlign: 'center', padding: '4px 0' }}>Aucune pièce jointe</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {attachments.map((a, i) => (
                <AttachmentChip key={i} att={a} onRemove={isAuthor ? () => removeAttachment(i) : undefined} />
              ))}
            </div>
          )}
        </div>

        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 80, maxHeight: '32vh' }}>
          {thread.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--xmuted)', fontSize: 11, padding: '12px 0' }}>Aucune réponse pour l’instant.</div>
          ) : thread.map(r => (
            <div key={r.id} style={{ marginBottom: 10, paddingLeft: 10, borderLeft: '2px solid var(--border)' }}>
              <div style={{ fontSize: 10.5, color: 'var(--xmuted)', marginBottom: 2 }}>
                <strong style={{ color: 'var(--text)' }}>{r.author_name}</strong> · {timeAgo(r.created_at)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{r.content}</div>
            </div>
          ))}
        </div>

        {/* Reply box */}
        <div style={{ padding: '10px 16px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <input
            value={reply} onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postReply() } }}
            placeholder="Répondre…"
            style={{ ...inp, flex: 1, padding: '9px 10px', fontSize: 12.5 }}
          />
          <button onClick={postReply} disabled={saving || !reply.trim()} style={{
            padding: '0 14px', borderRadius: 8, border: 'none',
            background: !reply.trim() || saving ? 'var(--border)' : 'var(--primary)',
            color: '#fff', fontSize: 12, fontWeight: 700, cursor: !reply.trim() || saving ? 'default' : 'pointer',
          }}>Envoyer</button>
        </div>
      </div>

      {/* Confirm delete */}
      {confirmDelete && (
        <ConfirmDialog
          title="Supprimer cette note ?"
          message="La note sera masquée. Elle restera consultable dans la base 30 jours pour permettre une restauration manuelle."
          confirmLabel="Supprimer"
          danger
          onConfirm={() => { setConfirmDelete(false); softDelete() }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* Proof modal for resolution */}
      {pendingProof && (
        <ProofModal
          onCancel={() => setPendingProof(false)}
          onConfirm={async (proofUrl, proofComment) => {
            setStatus('resolu')
            const { error: err } = await supabase.from('notes').update({ status: 'resolu', proof_url: proofUrl, proof_comment: proofComment }).eq('id', note.id)
            if (err) { onToast(err.message, 'error'); setStatus(note.status); setPendingProof(false); return }
            onToast('Note résolue ✓', 'success')
            setPendingProof(false)
          }}
          noteId={note.id}
          onToast={onToast}
        />
      )}

      {/* Share modal */}
      {showShare && (
        <ShareModal note={note} companies={companies} attachments={attachments} onClose={() => setShowShare(false)} />
      )}
    </>
  )
}

// ─── Attachment chip ────────────────────────────────────────────────────────

function AttachmentChip({ att, onRemove }: { att: NoteAttachment; onRemove?: () => void }) {
  const isImg = att.type.startsWith('image/')
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <a href={att.url} target="_blank" rel="noreferrer" style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: 6, textDecoration: 'none', color: 'var(--text)',
        fontSize: 11, fontWeight: 600, maxWidth: 200,
      }}>
        {isImg ? (
          <img src={att.url} alt="" style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
        ) : (
          <span style={{ fontSize: 16 }}>📄</span>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
      </a>
      {onRemove && (
        <button onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove() }} style={{
          position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%',
          background: '#DC2626', color: '#fff', border: 'none', cursor: 'pointer',
          fontSize: 10, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} title="Retirer">×</button>
      )}
    </div>
  )
}

// ─── Confirm dialog ─────────────────────────────────────────────────────────

function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; danger?: boolean
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <>
      <div onClick={onCancel} style={{ ...modalBackdrop, zIndex: 150 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: 'var(--surface)', borderRadius: 12, padding: '18px 20px', maxWidth: 360, width: '90%',
        boxShadow: '0 10px 40px rgba(0,0,0,.25)', zIndex: 151,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.45 }}>{message}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Annuler</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
            background: danger ? '#DC2626' : 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>{confirmLabel}</button>
        </div>
      </div>
    </>
  )
}

// ─── Proof modal (when marking note as resolved) ───────────────────────────

function ProofModal({ noteId, onCancel, onConfirm, onToast }: {
  noteId: string
  onCancel: () => void
  onConfirm: (proofUrl: string | null, proofComment: string | null) => void
  onToast: (msg: string, kind?: 'success' | 'error') => void
}) {
  const [comment, setComment] = useState('')
  const [file,    setFile]    = useState<File | null>(null)
  const [busy,    setBusy]    = useState(false)

  async function submit() {
    if (!comment.trim() && !file) {
      onToast('Photo OU commentaire de preuve obligatoire.', 'error')
      return
    }
    setBusy(true)
    let proofUrl: string | null = null
    if (file) {
      const path = `${noteId}/proof-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('notes-attachments').upload(path, file)
      if (upErr) {
        setBusy(false)
        onToast(upErr.message?.toLowerCase().includes('bucket') ? 'Bucket « notes-attachments » à créer.' : upErr.message, 'error')
        return
      }
      proofUrl = supabase.storage.from('notes-attachments').getPublicUrl(path).data.publicUrl
    }
    onConfirm(proofUrl, comment.trim() || null)
  }

  return (
    <>
      <div onClick={onCancel} style={{ ...modalBackdrop, zIndex: 150 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: 'var(--surface)', borderRadius: 12, padding: '18px 20px', maxWidth: 400, width: '92%',
        boxShadow: '0 10px 40px rgba(0,0,0,.25)', zIndex: 151,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>✓ Marquer comme résolu</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.4 }}>
          Pour passer à « Résolu », fournis <strong>une photo</strong> et/ou <strong>un commentaire</strong> de preuve.
        </div>
        <label style={lbl}>Commentaire de preuve</label>
        <textarea
          value={comment} onChange={e => setComment(e.target.value)}
          rows={3} autoFocus
          placeholder="Ce qui a été fait, par qui, quand…"
          style={{ ...inp, marginBottom: 10, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <label style={lbl}>Photo / fichier (optionnel)</label>
        <input
          type="file" accept="image/jpeg,image/png,application/pdf"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          style={{ marginBottom: 14, fontSize: 12 }}
        />
        {file && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>📎 {file.name}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Annuler</button>
          <button onClick={submit} disabled={busy} style={{
            flex: 2, padding: '9px 0', borderRadius: 8, border: 'none',
            background: busy ? 'var(--border)' : '#15803D', color: '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
          }}>{busy ? 'Enregistrement…' : 'Valider la résolution'}</button>
        </div>
      </div>
    </>
  )
}

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface-2)', cursor: 'pointer', fontSize: 13,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

// ─── Share modal (WhatsApp / Email) ─────────────────────────────────────────

function buildShareText(note: Note, attachments: NoteAttachment[]): string {
  const lines: string[] = []
  lines.push(`📝 Note de ${note.author_name}`)
  if (note.category) lines.push(`Catégorie : ${note.category}`)
  if (note.due_date) lines.push(`Échéance : ${note.due_date}`)
  lines.push('')
  if (note.title) { lines.push(note.title); lines.push('') }
  lines.push(note.content)
  if (attachments.length > 0) {
    lines.push('')
    lines.push('📎 Pièces jointes :')
    for (const a of attachments) lines.push(`- ${a.name} : ${a.url}`)
  }
  lines.push('')
  const url = typeof window !== 'undefined' ? window.location.origin : 'https://hsf-chantier.vercel.app'
  lines.push(`Voir / répondre : ${url}`)
  return lines.join('\n')
}

function cleanPhone(p: string | null | undefined): string {
  if (!p) return ''
  return p.replace(/[^\d]/g, '').replace(/^0/, '33') // FR default
}

function ShareModal({ note, companies, attachments, onClose }: {
  note: Note; companies: Company[]; attachments: NoteAttachment[]; onClose: () => void
}) {
  const text     = buildShareText(note, attachments)
  const encoded  = encodeURIComponent(text)
  const subject  = encodeURIComponent(`📝 ${note.title ?? note.content.slice(0, 60)} — Planify`)
  const targets  = (note.company_codes.length > 0 ? note.company_codes : []).concat(note.mentioned_companies ?? [])
  const uniqueT  = [...new Set(targets)]
  const cos      = uniqueT.map(name => companies.find(c => c.name === name) ?? { id: name, name, phone: null, email: null, contacts: [] as Company['contacts'] })

  return (
    <>
      <div onClick={onClose} style={{ ...modalBackdrop, zIndex: 150 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: 'var(--surface)', borderRadius: 12, padding: '16px 18px',
        maxWidth: 440, width: '94%', maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 10px 40px rgba(0,0,0,.25)', zIndex: 151,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>📤 Partager cette note</div>
          <button onClick={onClose} style={iconBtnStyle}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
          Le message s&apos;ouvre pré-rempli dans WhatsApp ou Mail. Reste à appuyer sur Envoyer.
        </div>

        {cos.length === 0 ? (
          <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
            Aucune entreprise destinataire dans cette note.
          </div>
        ) : cos.map(co => {
          const allContacts: { name: string; phone: string | null; email: string | null }[] = [
            { name: co.name, phone: co.phone ?? null, email: co.email ?? null },
            ...((co.contacts as Company['contacts'] | undefined) ?? []).map(c => ({ name: c.name || co.name, phone: c.phone ?? null, email: c.email ?? null })),
          ].filter(c => c.phone || c.email)

          return (
            <div key={co.id} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>🏢 {co.name}</div>
              {allContacts.length === 0 ? (
                <div style={{ fontSize: 11, color: '#DC2626', background: '#FEE2E2', padding: '6px 10px', borderRadius: 6 }}>
                  ⚠ Aucun téléphone ni email configuré. Renseigne-les dans <strong>Réglages → Entreprises</strong>.
                </div>
              ) : allContacts.map((c, idx) => {
                const waPhone = cleanPhone(c.phone)
                return (
                  <div key={idx} style={{ marginBottom: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>
                      {c.name}{c.phone ? ` · ${c.phone}` : ''}{c.email ? ` · ${c.email}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <a
                        href={waPhone ? `https://wa.me/${waPhone}?text=${encoded}` : '#'}
                        target="_blank" rel="noreferrer"
                        onClick={e => { if (!waPhone) { e.preventDefault(); alert('Pas de téléphone'); } }}
                        style={{
                          flex: 1, padding: '8px 0', textAlign: 'center', borderRadius: 6, textDecoration: 'none',
                          background: waPhone ? '#25D366' : 'var(--border)',
                          color: '#fff', fontSize: 11.5, fontWeight: 700,
                          opacity: waPhone ? 1 : .5, cursor: waPhone ? 'pointer' : 'not-allowed',
                        }}
                      >💬 WhatsApp</a>
                      <a
                        href={c.email ? `mailto:${c.email}?subject=${subject}&body=${encoded}` : '#'}
                        onClick={e => { if (!c.email) { e.preventDefault(); alert('Pas d\'email'); } }}
                        style={{
                          flex: 1, padding: '8px 0', textAlign: 'center', borderRadius: 6, textDecoration: 'none',
                          background: c.email ? '#2152C8' : 'var(--border)',
                          color: '#fff', fontSize: 11.5, fontWeight: 700,
                          opacity: c.email ? 1 : .5, cursor: c.email ? 'pointer' : 'not-allowed',
                        }}
                      >✉ Email</a>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        <button onClick={onClose} style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>Fermer</button>
      </div>
    </>
  )
}

// ─── Intervention picker (anchored note creation) ──────────────────────────

function InterventionPicker({ interventions, zones, companies, onClose, onPick }: {
  interventions: Intervention[]
  zones: Zone[]
  companies: Company[]
  onClose: () => void
  onPick: (iv: Intervention) => void
}) {
  const [q, setQ] = useState('')
  const ql = q.trim().toLowerCase()
  const visible = useMemo(() => {
    return interventions
      .filter(iv => iv.status !== 'termine')
      .filter(iv => !ql
        || iv.task?.toLowerCase().includes(ql)
        || (iv.task_number ?? '').toLowerCase().includes(ql)
        || (iv.company ?? '').toLowerCase().includes(ql))
      .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
      .slice(0, 100)
  }, [interventions, ql])

  return (
    <>
      <div onClick={onClose} style={modalBackdrop} />
      <div style={{ ...modalSheet, maxHeight: '85vh' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        <div style={{ padding: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
            Choisir une intervention à ancrer
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: '0 16px 8px' }}>
          <input
            autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Rechercher par tâche, n° ou entreprise…"
            style={inp}
          />
        </div>
        <div style={{ overflowY: 'auto', padding: '0 8px 16px' }}>
          {visible.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
              Aucune intervention trouvée
            </div>
          ) : visible.map(iv => {
            const z = zones.find(z => z.id === iv.zone)
            const co = companies.find(c => c.name === iv.company)
            return (
              <button key={iv.id} onClick={() => onPick(iv)} style={{
                width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 8, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {iv.task}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 6 }}>
                    {iv.task_number && <span style={{ fontFamily: "'DM Mono', monospace" }}>{iv.task_number}</span>}
                    {z && <span>· {z.short}</span>}
                    {iv.company && <span>· {iv.company}{co?.trade_id ? '' : ''}</span>}
                    {iv.start_date && <span>· {iv.start_date.slice(5, 10).replace('-', '/')}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 18, color: 'var(--primary)' }}>›</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ─── Shared styles ──────────────────────────────────────────────────────────

const fabItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
}

const exportItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
  background: 'transparent', textDecoration: 'none', cursor: 'pointer',
}

const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  zIndex: 100, animation: 'fadeIn .15s ease',
}

const modalSheet: React.CSSProperties = {
  position: 'fixed', bottom: 0, left: 0, right: 0,
  background: 'var(--surface)', borderRadius: '16px 16px 0 0',
  zIndex: 101, animation: 'slideUp .22s ease',
  maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
}

const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--muted)',
  textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5, display: 'block',
}

const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--surface-2)', color: 'var(--text)', padding: '8px 10px', fontSize: 13,
  fontFamily: "'DM Sans', sans-serif",
}
