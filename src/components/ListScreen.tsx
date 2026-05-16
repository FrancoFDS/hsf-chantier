'use client'

import { useState } from 'react'
import type { Intervention, Zone, Trade } from '@/types/database'
import type { Status } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { fmtDate, fmtDateLong, weekDays, isTaskActiveOn } from '@/lib/dates'
import { getTradeColor } from '@/constants/colors'
import TaskCard from './TaskCard'
import TaskDetail from './TaskDetail'

interface Props {
  interventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  onUpdate: (id: string, patch: Partial<Intervention>) => void
}

type FilterStatus = Status | 'all'

export default function ListScreen({ interventions, zones, trades, onUpdate }: Props) {
  const [weekOffset, setWeekOffset]   = useState(0)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterTrade, setFilterTrade]   = useState<string>('all')
  const [selectedId, setSelectedId]     = useState<string | null>(null)

  const days = weekDays(weekOffset)
  const weekStart = days[0]
  const weekEnd   = days[4]

  // Filter interventions active this week
  const weekItems = interventions.filter(iv => days.some(d => isTaskActiveOn(iv, d)))

  // Apply status + trade filters
  const filtered = weekItems
    .filter(iv => filterStatus === 'all' || effectiveStatus(iv) === filterStatus)
    .filter(iv => filterTrade  === 'all' || iv.trade === filterTrade)
    .sort((a, b) => {
      const rank = (iv: Intervention) => {
        const es = effectiveStatus(iv)
        if (es === 'bloque')    return 0
        if (es === 'en_retard') return 1
        if (es === 'encours')   return 2
        if (es === 'arealis')   return 3
        if (es === 'termine')   return 5
        return 9
      }
      const ra = rank(a), rb = rank(b)
      if (ra !== rb) return ra - rb
      return (a.start_date ?? '').localeCompare(b.start_date ?? '')
    })

  // Group by date
  const grouped: Record<string, Intervention[]> = {}
  filtered.forEach(iv => {
    const key = iv.start_date ?? 'sans-date'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(iv)
  })

  // Trades active this week (for filter)
  const activeTrades = trades.filter(t => weekItems.some(iv => iv.trade === t.id))

  // Stats for the week
  const weekDone   = weekItems.filter(iv => iv.status === 'termine').length
  const weekBloque = weekItems.filter(iv => iv.status === 'bloque').length
  const weekLate   = weekItems.filter(iv => effectiveStatus(iv) === 'en_retard').length

  const selectedIv = selectedId ? interventions.find(iv => iv.id === selectedId) : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Week navigator */}
      <div style={{ padding: '10px 14px 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => setWeekOffset(w => w - 1)} style={navBtn}>‹</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              {weekOffset === 0 ? 'Cette semaine' : weekOffset === 1 ? 'Semaine prochaine' : weekOffset === -1 ? 'Semaine dernière' : `Semaine ${weekOffset > 0 ? '+' : ''}${weekOffset}`}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'DM Mono', monospace" }}>
              {fmtDate(weekStart)} — {fmtDate(weekEnd)}
            </div>
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} style={navBtn}>›</button>
        </div>

        {/* Week stats */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[
            { label: 'Cette sem.', value: weekItems.length, color: 'var(--primary)' },
            { label: 'Terminées',  value: weekDone,         color: STATUS_META.termine.dot },
            { label: 'Bloquées',   value: weekBloque,       color: STATUS_META.bloque.dot },
            { label: 'En retard',  value: weekLate,         color: STATUS_META.en_retard.dot },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, textAlign: 'center', background: 'var(--surface-2)', borderRadius: 'var(--r-xs)', padding: '5px 4px' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10 }}>
          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as FilterStatus)}
            style={selectStyle}
          >
            <option value="all">Tous statuts</option>
            {(Object.entries(STATUS_META) as [Status, typeof STATUS_META[Status]][]).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          {/* Trade filter */}
          <select
            value={filterTrade}
            onChange={e => setFilterTrade(e.target.value)}
            style={selectStyle}
          >
            <option value="all">Tous corps de métier</option>
            {activeTrades.map(t => {
              const tc = getTradeColor(t.color)
              return <option key={t.id} value={t.id}>{t.name}</option>
            })}
          </select>

          {(filterStatus !== 'all' || filterTrade !== 'all') && (
            <button
              onClick={() => { setFilterStatus('all'); setFilterTrade('all') }}
              style={{ ...selectStyle, background: 'var(--primary-l)', color: 'var(--primary)', border: '1px solid var(--primary)', flexShrink: 0 }}
            >
              ✕ Reset
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 80px' }}>
        {filtered.length === 0 ? (
          <EmptyState hasFilter={filterStatus !== 'all' || filterTrade !== 'all'} />
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, ivs]) => (
              <div key={date} style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em',
                  textTransform: 'uppercase', fontFamily: "'DM Mono', monospace",
                  marginBottom: 8, paddingBottom: 5, borderBottom: '1px solid var(--border)',
                }}>
                  {date === 'sans-date' ? 'Sans date' : fmtDateLong(date)}
                </div>
                {ivs.map(iv => (
                  <TaskCard
                    key={iv.id}
                    iv={iv}
                    zones={zones}
                    trades={trades}
                    onClick={setSelectedId}
                  />
                ))}
              </div>
            ))
        )}
      </div>

      {/* Task detail panel */}
      {selectedIv && (
        <TaskDetail
          iv={selectedIv}
          zones={zones}
          trades={trades}
          allInterventions={interventions}
          onClose={() => setSelectedId(null)}
          onUpdate={(patch) => {
            onUpdate(selectedIv.id, patch)
            setSelectedId(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface-2)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text)',
}

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--border)', background: 'var(--surface-2)',
  color: 'var(--text)', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
  flexShrink: 0,
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--muted)', gap: 8 }}>
      <div style={{ fontSize: 36, opacity: .3 }}>📋</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
        {hasFilter ? 'Aucun résultat' : 'Aucune intervention cette semaine'}
      </div>
      <div style={{ fontSize: 13 }}>
        {hasFilter ? 'Modifiez les filtres' : 'Naviguez vers une autre semaine'}
      </div>
    </div>
  )
}
