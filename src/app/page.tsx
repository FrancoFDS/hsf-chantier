'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Intervention, Zone, Trade, Company } from '@/types/database'
import { computeProjectHealth, deadlineColor, daysUntil, effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import ListScreen from '@/components/ListScreen'
import PlanningScreen from '@/components/PlanningScreen'
import BriefingsScreen from '@/components/BriefingsScreen'
import SettingsScreen from '@/components/SettingsScreen'

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
        {screen === 'dashboard' && <DashboardScreen zones={zones} interventions={interventions} trades={trades} />}
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

function DashboardScreen({ zones, interventions, trades }: { zones: Zone[]; interventions: Intervention[]; trades: Trade[] }) {
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
        {/* Progress bar */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Avancement global</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: avancementReel > 60 ? 'var(--success)' : 'var(--primary)' }}>{avancementReel}%</span>
          </div>
          <div style={{ height: 10, background: 'var(--border)', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
            <div style={{ height: '100%', width: `${avancementReel}%`, background: 'linear-gradient(90deg, var(--primary), #4B7CF3)', borderRadius: 99, transition: 'width .6s' }} />
            {cadenceCible > 0 && (
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${cadenceCible}%`, width: 2, background: '#64748B', opacity: 0.5 }} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>
            <span style={{ fontSize: 9, color: 'var(--xmuted)' }}>Objectif théorique : {cadenceCible}%</span>
          </div>
        </div>

        {/* 4 metrics with explanations */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <MetricCard
            label="Avancement réel"
            value={`${avancementReel}%`}
            sub="Progression moyenne de toutes les tâches"
            color={avancementReel > 60 ? 'var(--success)' : 'var(--primary)'}
          />
          <MetricCard
            label="Cadence cible"
            value={`${cadenceCible}%`}
            sub="Où vous devriez être selon le planning"
            color="var(--muted)"
          />
          <MetricCard
            label="Dérive"
            value={`${derive > 0 ? '+' : ''}${derive}%`}
            sub={derive >= 0 ? 'En avance sur le planning' : 'En retard sur le planning'}
            color={derive >= 0 ? 'var(--success)' : 'var(--danger)'}
          />
          <MetricCard
            label="Fiabilité"
            value={`${fiabilite}%`}
            sub={`${tasksDone} terminées sur ${tasksDue} dues`}
            color={fiabilite > 70 ? 'var(--success)' : 'var(--danger)'}
          />
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
        {/* Completion bar */}
        {total > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
              <div style={{ flex: termine, background: STATUS_META.termine.dot }} />
              <div style={{ flex: encours, background: STATUS_META.encours.dot }} />
              <div style={{ flex: enRetard, background: STATUS_META.en_retard.dot }} />
              <div style={{ flex: bloque, background: STATUS_META.bloque.dot }} />
              <div style={{ flex: total - termine - encours - enRetard - bloque, background: 'var(--border)' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {[
                { label: 'Terminé', color: STATUS_META.termine.dot, pct: Math.round(termine / total * 100) },
                { label: 'En cours', color: STATUS_META.encours.dot, pct: Math.round(encours / total * 100) },
                { label: 'En retard', color: STATUS_META.en_retard.dot, pct: Math.round(enRetard / total * 100) },
                { label: 'Bloqué', color: STATUS_META.bloque.dot, pct: Math.round(bloque / total * 100) },
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {trades.map(t => {
              const tTasks   = interventions.filter(iv => iv.trade === t.id)
              if (tTasks.length === 0) return null
              const tDone    = tTasks.filter(iv => iv.status === 'termine').length
              const tLate    = tTasks.filter(iv => effectiveStatus(iv) === 'en_retard').length
              const tBlocked = tTasks.filter(iv => iv.status === 'bloque').length
              const pct      = Math.round(tDone / tTasks.length * 100)
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--trade-${t.color}, #6B7280)`, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.short}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, marginLeft: 4 }}>
                        {tDone}/{tTasks.length}
                        {tLate > 0 && <span style={{ color: STATUS_META.en_retard.dot, marginLeft: 4 }}>⏱{tLate}</span>}
                        {tBlocked > 0 && <span style={{ color: STATUS_META.bloque.dot, marginLeft: 4 }}>⛔{tBlocked}</span>}
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? STATUS_META.termine.dot : 'var(--primary)', borderRadius: 99 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? 'var(--success)' : 'var(--text)', width: 30, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {health.riskyZones.length > 0 && (
        <Card title={`Zones à risque (${health.riskyZones.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {health.riskyZones.slice(0, 4).map(rz => (
              <div key={rz.zone.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{rz.zone.short}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {rz.late > 0 && `${rz.late} retard(s)`}{rz.late > 0 && rz.blocked > 0 && ' · '}{rz.blocked > 0 && `${rz.blocked} bloquée(s)`}
                    {' · '}Avancement {rz.avancement}% (cible {rz.cadence}%)
                  </div>
                </div>
                <span style={{
                  background: rz.risk > 60 ? 'var(--danger-l)' : '#FFF7ED',
                  color: rz.risk > 60 ? 'var(--danger)' : '#D97706',
                  borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700,
                }}>
                  {rz.risk}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Deadlines">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {zones.filter(z => z.deadline).sort((a, b) => a.deadline! > b.deadline! ? 1 : -1).map(z => {
            const days  = daysUntil(z.deadline!)
            const color = deadlineColor(z.deadline!)
            const zTasks = interventions.filter(iv => iv.zone === z.id)
            const zDone  = zTasks.filter(iv => iv.status === 'termine').length
            return (
              <div key={z.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: z.floor_color, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{z.short}</span>
                  </div>
                  {zTasks.length > 0 && (
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 99, overflow: 'hidden', marginLeft: 16 }}>
                      <div style={{ height: '100%', width: `${Math.round(zDone / zTasks.length * 100)}%`, background: color, borderRadius: 99 }} />
                    </div>
                  )}
                  {zTasks.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--xmuted)', marginTop: 2, marginLeft: 16 }}>{zDone}/{zTasks.length} tâches</div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color }}>
                    {days < 0 ? `${Math.abs(days)}j dépassé` : days === 0 ? "Auj." : `J-${days}`}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--xmuted)' }}>
                    {new Date(z.deadline! + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

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
