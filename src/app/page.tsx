'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Intervention, Zone, Trade, Company } from '@/types/database'
import { computeProjectHealth, effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getTradeColor } from '@/constants/colors'
import ListScreen from '@/components/ListScreen'
import PlanningScreen from '@/components/PlanningScreen'
import BriefingsScreen from '@/components/BriefingsScreen'
import SettingsScreen from '@/components/SettingsScreen'
import TaskDetail from '@/components/TaskDetail'

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

type Screen = 'dashboard' | 'planning' | 'list' | 'briefings' | 'settings'

export default function PlanifyApp() {
  const [screen, setScreen]       = useState<Screen>('dashboard')
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [zones, setZones]                   = useState<Zone[]>([])
  const [trades, setTrades]                 = useState<Trade[]>([])
  const [interventions, setInterventions]   = useState<Intervention[]>([])
  const [companies, setCompanies]           = useState<Company[]>([])

  useEffect(() => {
    loadData()
      .then(d => { setZones(d.zones); setTrades(d.trades); setInterventions(d.interventions); setCompanies(d.companies) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const handleUpdate = useCallback((id: string, patch: Partial<Intervention>) => {
    setInterventions(prev => prev.map(iv => iv.id === id ? { ...iv, ...patch } : iv))
  }, [])

  const handleAdd = useCallback((iv: Intervention) => {
    setInterventions(prev => [...prev, iv])
  }, [])

  if (loading) return <Loader />
  if (error)   return <ErrorScreen message={error} />

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppHeader screen={screen} onNavigate={setScreen} interventions={interventions} />
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {screen === 'dashboard' && <DashboardScreen zones={zones} interventions={interventions} trades={trades} onUpdate={handleUpdate} />}
        {screen === 'list' && <ListScreen interventions={interventions} zones={zones} trades={trades} onUpdate={handleUpdate} />}
        {screen === 'planning' && <PlanningScreen interventions={interventions} zones={zones} trades={trades} companies={companies} onUpdate={handleUpdate} onAdd={handleAdd} />}
        {screen === 'briefings' && <BriefingsScreen interventions={interventions} zones={zones} trades={trades} companies={companies} />}
        {screen === 'settings' && <SettingsScreen zones={zones} trades={trades} companies={companies} onZonesChange={setZones} onTradesChange={setTrades} onCompaniesChange={setCompanies} />}
        {screen !== 'dashboard' && screen !== 'list' && screen !== 'planning' && screen !== 'briefings' && screen !== 'settings' && <ComingSoon screen={screen} />}
      </main>
      <BottomNav screen={screen} onNavigate={setScreen} />
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function AppHeader({ screen, onNavigate, interventions }: {
  screen: Screen; onNavigate: (s: Screen) => void; interventions: Intervention[]
}) {
  const blocked = interventions.filter(iv => iv.status === 'bloque').length
  const labels: Record<Screen, string> = {
    dashboard: 'Planify', planning: 'Planning', list: 'Tâches', briefings: 'Briefings', settings: 'Paramètres',
  }
  return (
    <header style={{
      background: 'var(--hdr)', color: 'var(--hdr-text)',
      padding: '0 16px', height: 52, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', flexShrink: 0, zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.3px' }}>{labels[screen]}</span>
        {screen === 'dashboard' && (
          <span style={{ fontSize: 11, opacity: .5, fontWeight: 500 }}>HSF Av. Marceau</span>
        )}
      </div>
      {blocked > 0 && (
        <button onClick={() => onNavigate('list')} style={{
          background: 'rgba(220,38,38,.18)', border: '1px solid rgba(220,38,38,.3)',
          borderRadius: 6, padding: '3px 8px', color: '#F87171',
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}>
          ⚠ {blocked} bloquée{blocked > 1 ? 's' : ''}
        </button>
      )}
    </header>
  )
}

// ─── Bottom nav ───────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Screen; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'planning',  label: 'Planning',  icon: '▦' },
  { id: 'list',      label: 'Tâches',    icon: '≡' },
  { id: 'briefings', label: 'Briefings', icon: '◎' },
  { id: 'settings',  label: 'Réglages',  icon: '⚙' },
]

function BottomNav({ screen, onNavigate }: { screen: Screen; onNavigate: (s: Screen) => void }) {
  return (
    <nav style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', flexShrink: 0 }}>
      {NAV_ITEMS.map(item => {
        const active = screen === item.id
        return (
          <button key={item.id} onClick={() => onNavigate(item.id)} style={{
            flex: 1, padding: '8px 0 10px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 3, border: 'none', cursor: 'pointer', background: 'transparent',
            color: active ? 'var(--primary)' : 'var(--xmuted)',
            fontWeight: active ? 600 : 400, fontSize: 10,
            borderTop: active ? '2px solid var(--primary)' : '2px solid transparent',
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardScreen({ zones, interventions, trades, onUpdate }: {
  zones: Zone[]; interventions: Intervention[]; trades: Trade[]
  onUpdate: (id: string, patch: Partial<Intervention>) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

      {alertes.map((a, i) => (
        <div key={i} style={{
          background: a.type === 'danger' ? 'var(--danger-l)' : '#FFFBEB',
          border: `1px solid ${a.type === 'danger' ? 'var(--danger)' : '#D97706'}`,
          borderRadius: 'var(--r-sm)', padding: '10px 14px',
          color: a.type === 'danger' ? 'var(--danger)' : '#92400E',
          fontSize: 13, fontWeight: 500,
        }}>
          {a.type === 'danger' ? '⛔ ' : '⚠️ '}{a.msg}
        </div>
      ))}

      {/* ── Santé du projet ── */}
      <Card title="Santé du projet">
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Avancement global</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: avancementReel > 60 ? 'var(--success)' : 'var(--primary)' }}>{avancementReel}%</span>
          </div>
          <div style={{ height: 10, background: 'var(--border)', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
            <div style={{ height: '100%', width: `${avancementReel}%`, background: 'linear-gradient(90deg, var(--primary), #4B7CF3)', borderRadius: 99, transition: 'width .6s' }} />
            {cadenceCible > 0 && (
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.min(cadenceCible, 99)}%`, width: 2, background: '#64748B', opacity: 0.5 }} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>
            <span style={{ fontSize: 9, color: 'var(--xmuted)' }}>Objectif théorique : {cadenceCible}%</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <MetricCard label="Avancement réel" value={`${avancementReel}%`} sub="Progression moyenne de toutes les tâches" color={avancementReel > 60 ? 'var(--success)' : 'var(--primary)'} />
          <MetricCard label="Cadence cible"   value={`${cadenceCible}%`}   sub="Où vous devriez être selon le planning"  color="var(--muted)" />
          <MetricCard label="Dérive"          value={`${derive > 0 ? '+' : ''}${derive}%`} sub={derive >= 0 ? 'En avance sur le planning' : 'En retard sur le planning'} color={derive >= 0 ? 'var(--success)' : 'var(--danger)'} />
          <MetricCard label="Fiabilité"       value={`${fiabilite}%`}      sub={`${tasksDone} terminées sur ${tasksDue} dues`} color={fiabilite > 70 ? 'var(--success)' : 'var(--danger)'} />
        </div>
      </Card>

      {/* ── Tâches ── */}
      <Card title="Tâches">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {([
            { label: 'Total',     value: total,     color: 'var(--primary)' },
            { label: 'Terminé',   value: termine,   color: STATUS_META.termine.dot },
            { label: 'En cours',  value: encours,   color: STATUS_META.encours.dot },
            { label: 'En retard', value: enRetard,  color: STATUS_META.en_retard.dot },
            { label: 'Bloqué',    value: bloque,    color: STATUS_META.bloque.dot },
          ]).map(({ label, value, color }) => (
            <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: '8px 4px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, lineHeight: 1.2 }}>{label}</div>
            </div>
          ))}
        </div>
        {total > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ flex: termine,                                    background: STATUS_META.termine.dot }} />
              <div style={{ flex: encours,                                    background: STATUS_META.encours.dot }} />
              <div style={{ flex: enRetard,                                   background: STATUS_META.en_retard.dot }} />
              <div style={{ flex: bloque,                                     background: STATUS_META.bloque.dot }} />
              <div style={{ flex: total - termine - encours - enRetard - bloque, background: 'var(--border)' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {[
                { label: 'Terminé',   color: STATUS_META.termine.dot,   pct: Math.round(termine  / total * 100) },
                { label: 'En cours',  color: STATUS_META.encours.dot,   pct: Math.round(encours  / total * 100) },
                { label: 'En retard', color: STATUS_META.en_retard.dot, pct: Math.round(enRetard / total * 100) },
                { label: 'Bloqué',   color: STATUS_META.bloque.dot,    pct: Math.round(bloque   / total * 100) },
              ].map(({ label, color, pct }) => pct > 0 ? (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
                  {label} {pct}%
                </span>
              ) : null)}
            </div>
          </div>
        )}
      </Card>

      {/* ── Par corps de métier ── */}
      {trades.length > 0 && (
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
              return (
                <div key={t.id} style={{ borderLeft: `3px solid ${tc.b}`, paddingLeft: 10 }}>
                  {/* Trade name + % */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{t.name}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: pct === 100 ? 'var(--success)' : hasAlert ? STATUS_META.en_retard.dot : 'var(--primary)', lineHeight: 1 }}>{pct}%</span>
                  </div>
                  {/* Human-readable summary */}
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 6px' }}>
                    {tDone > 0    && <span style={{ color: STATUS_META.termine.dot,   fontWeight: 600 }}>✓ {tDone} terminée{tDone > 1 ? 's' : ''}</span>}
                    {tEncours > 0 && <span style={{ color: STATUS_META.encours.dot,   fontWeight: 600 }}>● {tEncours} en cours</span>}
                    {tLate > 0    && <span style={{ color: STATUS_META.en_retard.dot, fontWeight: 700 }}>⏱ {tLate} en retard</span>}
                    {tBlocked > 0 && <span style={{ color: STATUS_META.bloque.dot,   fontWeight: 700 }}>⛔ {tBlocked} bloquée{tBlocked > 1 ? 's' : ''}</span>}
                    {tARealis > 0 && <span style={{ color: 'var(--xmuted)' }}>◌ {tARealis} à venir</span>}
                  </div>
                  {/* Segmented bar */}
                  <div style={{ display: 'flex', height: 5, borderRadius: 99, overflow: 'hidden', background: 'var(--border)' }}>
                    <div style={{ flex: tDone,    background: STATUS_META.termine.dot }} />
                    <div style={{ flex: tEncours, background: STATUS_META.encours.dot }} />
                    <div style={{ flex: tLate,    background: STATUS_META.en_retard.dot }} />
                    <div style={{ flex: tBlocked, background: STATUS_META.bloque.dot }} />
                    <div style={{ flex: tARealis, background: 'transparent' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ── Zones à risque ── */}
      {health.riskyZones.length > 0 && (
        <Card title={`Zones à risque (${health.riskyZones.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {health.riskyZones.slice(0, 5).map(rz => {
              const lateTasks    = interventions.filter(iv => iv.zone === rz.zone.id && effectiveStatus(iv) === 'en_retard')
              const blockedTasks = interventions.filter(iv => iv.zone === rz.zone.id && iv.status === 'bloque')
              const alertTasks   = [...lateTasks, ...blockedTasks]
              return (
                <div key={rz.zone.id}>
                  {/* Zone header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{rz.zone.short}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>
                        {rz.late > 0 && <span style={{ color: STATUS_META.en_retard.dot }}>⏱ {rz.late} en retard{rz.late > 1 ? 's' : ''}</span>}
                        {rz.late > 0 && rz.blocked > 0 && ' · '}
                        {rz.blocked > 0 && <span style={{ color: STATUS_META.bloque.dot }}>⛔ {rz.blocked} bloquée{rz.blocked > 1 ? 's' : ''}</span>}
                      </span>
                    </div>
                    <span style={{
                      background: rz.risk > 60 ? 'var(--danger-l)' : '#FFF7ED',
                      color: rz.risk > 60 ? 'var(--danger)' : '#D97706',
                      borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700,
                    }}>
                      Risque {rz.risk > 60 ? 'élevé' : 'modéré'}
                    </span>
                  </div>
                  {/* Clickable task list */}
                  {alertTasks.map(iv => {
                    const isLate   = effectiveStatus(iv) === 'en_retard'
                    const trade    = trades.find(t => t.id === iv.trade)
                    const tc       = getTradeColor(trade?.color ?? 'blue')
                    return (
                      <button key={iv.id} onClick={() => setSelectedId(iv.id)} style={{
                        width: '100%', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 10px', marginBottom: 4,
                        background: isLate ? 'rgba(234,88,12,.07)' : 'rgba(220,38,38,.07)',
                        border: `1px solid ${isLate ? 'rgba(234,88,12,.25)' : 'rgba(220,38,38,.25)'}`,
                        borderLeft: `3px solid ${isLate ? STATUS_META.en_retard.dot : STATUS_META.bloque.dot}`,
                        borderRadius: 'var(--r-xs)',
                      }}>
                        <span style={{ fontSize: 11 }}>{isLate ? '⏱' : '⛔'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {iv.task}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
                            {iv.task_number && <span style={{ color: tc.b, marginRight: 6 }}>{iv.task_number}</span>}
                            {trade?.short}
                            {iv.company && ` · ${iv.company}`}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--xmuted)', flexShrink: 0 }}>Ouvrir →</span>
                      </button>
                    )
                  })}
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
          allInterventions={interventions}
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
  const labels: Record<Screen, string> = { dashboard: 'Dashboard', planning: 'Planning', list: 'Liste des tâches', briefings: 'Briefings', settings: 'Paramètres' }
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
