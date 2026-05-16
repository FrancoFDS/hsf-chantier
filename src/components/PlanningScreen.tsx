'use client'

import { useRef, useState } from 'react'
import type { Intervention, Zone, Trade } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getTradeColor, getZoneFloorColor } from '@/constants/colors'
import { fmtDate, isTaskActiveOn, todayStr } from '@/lib/dates'
import TaskDetail from './TaskDetail'

type ViewMode = '1s' | '2s' | '3s'

interface Props {
  interventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  onUpdate: (id: string, patch: Partial<Intervention>) => void
}

// ─── Date helpers (local to planning) ────────────────────────────────────────

function getMonday(offset = 0): Date {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + offset * 7)
  return monday
}

function multiWeekDays(weekOffset: number, weeks: number): string[] {
  const monday = getMonday(weekOffset)
  const out: string[] = []
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 5; d++) {
      const day = new Date(monday)
      day.setDate(monday.getDate() + w * 7 + d)
      out.push(day.toISOString().slice(0, 10))
    }
  }
  return out
}

function dayLabel(dateStr: string): { weekday: string; date: string } {
  const d = new Date(dateStr + 'T12:00:00')
  return {
    weekday: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][d.getDay()],
    date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PlanningScreen({ interventions, zones, trades, onUpdate }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [viewMode, setViewMode]     = useState<ViewMode>('1s')
  const [zoneFilter, setZoneFilter] = useState<string[]>([])
  const [dropOpen, setDropOpen]     = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dropRef = useRef<HTMLTableCellElement>(null)
  const today   = todayStr()

  const weeks      = viewMode === '3s' ? 3 : viewMode === '2s' ? 2 : 1
  const isMulti    = weeks > 1
  const days       = multiWeekDays(weekOffset, weeks)
  const visZones   = zoneFilter.length === 0 ? zones : zones.filter(z => zoneFilter.includes(z.id))
  const activeCount = zoneFilter.length

  // zone column and deadline column widths
  const zoneW = isMulti ? 40 : 58
  const deadW = isMulti ? 28 : 50

  function toggleZone(id: string) {
    setZoneFilter(prev => {
      if (prev.length === 0) return zones.filter(z => z.id !== id).map(z => z.id)
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      return next.length === zones.length ? [] : next
    })
  }

  const selectedIv = selectedId ? interventions.find(iv => iv.id === selectedId) ?? null : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* Toolbar */}
      <div style={{ padding: '8px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* Week nav */}
        <button onClick={() => setWeekOffset(w => w - 1)} style={navBtnStyle}>‹</button>
        <div style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
            {weekOffset === 0 ? 'Cette semaine' : weekOffset === 1 ? 'Sem. prochaine' : weekOffset === -1 ? 'Sem. dernière' : `Sem. ${weekOffset > 0 ? '+' : ''}${weekOffset}`}
          </div>
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={navBtnStyle}>›</button>

        {/* View mode */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {(['1s', '2s', '3s'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${viewMode === m ? 'var(--primary)' : 'var(--border)'}`,
              background: viewMode === m ? 'var(--primary-l)' : 'var(--surface-2)',
              color: viewMode === m ? 'var(--primary)' : 'var(--muted)',
            }}>
              {m === '1s' ? '1 sem.' : m === '2s' ? '2 sem.' : '3 sem.'}
            </button>
          ))}
        </div>
      </div>

      {/* Gantt table (scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', position: 'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: isMulti ? `${zoneW + days.length * 28 + deadW}px` : undefined }}>
          <colgroup>
            <col style={{ width: zoneW }} />
            {days.map((_, i) => <col key={i} />)}
            <col style={{ width: deadW }} />
          </colgroup>

          {/* ── Header ── */}
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>

              {/* Zone filter cell */}
              <th ref={dropRef} style={{
                padding: '5px 3px', borderRight: '3px solid var(--border)',
                position: 'sticky', top: 0, zIndex: 12, background: 'var(--surface-2)',
                verticalAlign: 'middle', textAlign: 'center',
              }}>
                <button onClick={() => setDropOpen(o => !o)} style={{
                  width: '100%', padding: '3px 2px', borderRadius: 4,
                  border: `1px solid ${dropOpen || activeCount ? 'var(--primary)' : 'var(--border)'}`,
                  background: activeCount ? 'var(--primary-l)' : 'transparent',
                  color: activeCount ? 'var(--primary)' : 'var(--muted)',
                  fontSize: 8, fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'DM Mono', monospace", letterSpacing: '.04em',
                  textTransform: 'uppercase', lineHeight: 1.3,
                }}>
                  {activeCount ? `${zones.length - activeCount}/${zones.length}` : 'Zones'}
                </button>

                {dropOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: 220,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)',
                    zIndex: 50, overflow: 'hidden', textAlign: 'left',
                  }}>
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Zones</span>
                      <button onClick={() => { setZoneFilter([]); setDropOpen(false) }} style={{ fontSize: 10, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Toutes</button>
                    </div>
                    {zones.map(z => {
                      const checked = zoneFilter.length === 0 || zoneFilter.includes(z.id)
                      const fc = getZoneFloorColor(zones, z.floor)
                      return (
                        <div key={z.id} onClick={e => { e.stopPropagation(); toggleZone(z.id) }} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                          cursor: 'pointer', borderBottom: '1px solid var(--border)',
                          background: checked ? 'var(--primary-l)' : 'transparent',
                        }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                            border: `2px solid ${checked ? 'var(--primary)' : 'var(--border)'}`,
                            background: checked ? 'var(--primary)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {checked && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: fc, flexShrink: 0, display: 'inline-block' }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{z.name}</div>
                            <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: 'var(--muted)' }}>{z.short}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </th>

              {/* Day headers */}
              {days.map((d, i) => {
                const isFirstOfWeek = i > 0 && i % 5 === 0
                const isCurrentDay  = d === today
                const lbl = dayLabel(d)
                return (
                  <th key={d} style={{
                    padding: isMulti ? '3px 0' : '6px 2px',
                    textAlign: 'center', overflow: 'hidden',
                    position: 'sticky', top: 0, zIndex: 11,
                    borderLeft: `${isFirstOfWeek ? 2 : 1}px solid ${isFirstOfWeek ? 'var(--border)' : 'var(--border)'}`,
                    background: isCurrentDay ? 'var(--primary-l)' : 'var(--surface-2)',
                    fontWeight: 'normal', verticalAlign: 'middle',
                  }}>
                    <div style={{ fontSize: isMulti ? (weeks > 2 ? 6 : 7) : 9, fontWeight: 800, color: isCurrentDay ? 'var(--primary)' : 'var(--muted)', lineHeight: 1.05, whiteSpace: 'nowrap' }}>
                      {lbl.weekday}
                    </div>
                    <div style={{ fontSize: isMulti ? (weeks > 2 ? 6.5 : 7.5) : 10, fontFamily: "'DM Mono', monospace", color: isCurrentDay ? 'var(--primary)' : 'var(--muted)', lineHeight: 1.05, whiteSpace: 'nowrap' }}>
                      {lbl.date}
                    </div>
                  </th>
                )
              })}

              {/* FIN header */}
              <th style={{
                padding: '4px 1px', textAlign: 'center',
                borderLeft: '2px solid var(--border)',
                position: 'sticky', top: 0, zIndex: 12,
                background: 'rgba(220,38,38,.07)', verticalAlign: 'middle',
              }}>
                <span style={{ fontSize: 7, fontWeight: 800, color: '#DC2626', fontFamily: "'DM Mono', monospace", writingMode: 'vertical-rl', transform: 'rotate(180deg)', lineHeight: 1 }}>FIN</span>
              </th>
            </tr>
          </thead>

          {/* ── Zone rows ── */}
          <tbody>
            {visZones.map((zone, zi) => {
              const prevZone  = visZones[zi - 1]
              const floorChange = zi > 0 && prevZone?.floor !== zone.floor
              const fc = getZoneFloorColor(zones, zone.floor)
              const dc = zone.deadline ? deadlineColor(zone.deadline) : 'var(--muted)'

              return (
                <tr key={zone.id} style={{
                  borderTop: floorChange ? `3px solid ${fc}` : undefined,
                  borderBottom: '1px solid var(--border)',
                  background: fc + '08',
                }}>
                  {/* Zone label */}
                  <td style={{
                    padding: isMulti ? '4px 3px' : '7px 6px',
                    borderRight: `3px solid ${fc}`,
                    verticalAlign: 'middle', textAlign: 'center',
                    height: isMulti ? 44 : 64,
                    background: fc + '14',
                  }}>
                    <span style={{ fontSize: isMulti ? 8.5 : 11, fontWeight: 900, color: fc, lineHeight: 1.12, fontFamily: "'DM Sans', sans-serif", letterSpacing: '.01em', textTransform: 'uppercase', wordBreak: 'normal', overflowWrap: 'anywhere', display: 'block' }}>
                      {zone.short}
                    </span>
                  </td>

                  {/* Day cells */}
                  {days.map((d, di) => {
                    const isFirstOfWeek = di > 0 && di % 5 === 0
                    const isCurrentDay  = d === today
                    const isDeadline    = zone.deadline === d
                    const cellBg = isDeadline ? 'rgba(220,38,38,.18)' : isCurrentDay ? 'color-mix(in srgb, var(--primary) 5%, transparent)' : 'transparent'
                    const cards  = interventions
                      .filter(iv => iv.zone === zone.id && isTaskActiveOn(iv, d) && !(iv.off_days?.includes(d)))
                      .sort((a, b) => {
                        const ap = a.priority ?? 3, bp = b.priority ?? 3
                        if (ap !== bp) return ap - bp
                        return (a.start_date ?? '').localeCompare(b.start_date ?? '')
                      })

                    return (
                      <td key={d} style={{
                        position: 'relative', overflow: 'hidden',
                        padding: isMulti ? 2 : 3,
                        height: isMulti ? 44 : 64,
                        verticalAlign: 'top',
                        borderLeft: `${isFirstOfWeek ? 2 : 1}px solid var(--border)`,
                        background: cellBg,
                      }}>
                        {cards.map(iv => (
                          <TaskBar key={iv.id} iv={iv} trades={trades} isMulti={isMulti} weeks={weeks} onClick={() => setSelectedId(iv.id)} />
                        ))}
                      </td>
                    )
                  })}

                  {/* Deadline cell */}
                  <DeadlineCell zone={zone} isMulti={isMulti} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* TaskDetail panel */}
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

// ─── Task bar inside a cell ───────────────────────────────────────────────────

function TaskBar({ iv, trades, isMulti, weeks, onClick }: {
  iv: Intervention; trades: Trade[]; isMulti: boolean; weeks: number; onClick: () => void
}) {
  const trade = trades.find(t => t.id === iv.trade)
  const tc    = getTradeColor(trade?.color ?? 'blue')
  const es    = effectiveStatus(iv)
  const sm    = STATUS_META[es]

  if (isMulti) {
    return (
      <div onClick={e => { e.stopPropagation(); onClick() }} style={{
        borderRadius: 4, padding: weeks === 2 ? '3px 4px' : '2px 3px', marginBottom: 1, cursor: 'pointer',
        background: tc.bg, borderLeft: `3px solid ${tc.b}`, border: `1px solid ${tc.b}30`,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: weeks === 2 ? 8.5 : 7.5, fontWeight: 800, color: tc.t, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.12, flex: 1 }}>
            {iv.company || iv.task}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 4px', borderRadius: 999, background: sm.bg, color: sm.dot, fontSize: weeks === 2 ? 6.8 : 6.4, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', flexShrink: 0, border: `1px solid ${sm.dot}55` }}>
            <span style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: sm.dot, display: 'block' }} />
            {sm.label}
          </span>
        </div>
        {weeks <= 2 && (
          <div style={{ fontSize: weeks === 2 ? 7.8 : 7, color: tc.t, opacity: .88, lineHeight: 1.16, overflow: 'hidden', fontWeight: 600 }}>{iv.task}</div>
        )}
      </div>
    )
  }

  // Single week — full card
  return (
    <div onClick={e => { e.stopPropagation(); onClick() }} style={{
      borderRadius: 8, marginBottom: 4, cursor: 'pointer',
      background: tc.bg, borderLeft: `3px solid ${tc.b}`,
      border: `1px solid ${tc.b}30`, padding: '4px 6px',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: tc.t, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {iv.company || '—'}
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: sm.dot, background: sm.bg, padding: '1px 5px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {sm.label}
        </span>
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color: tc.t, opacity: .88, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {iv.task}
      </div>
      {iv.task_number && (
        <div style={{ fontSize: 9, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace", marginTop: 2 }}>{iv.task_number}</div>
      )}
    </div>
  )
}

// ─── Deadline cell ────────────────────────────────────────────────────────────

function deadlineColor(deadline: string | null | undefined): string {
  if (!deadline) return 'var(--muted)'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d     = new Date(deadline + 'T00:00:00')
  const diff  = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff < 0)  return '#DC2626'
  if (diff < 14) return '#EA580C'
  if (diff < 30) return '#D97706'
  return '#16A34A'
}

function DeadlineCell({ zone, isMulti }: { zone: Zone; isMulti: boolean }) {
  if (!zone.deadline) {
    return (
      <td style={{ borderLeft: '2px solid var(--border)', verticalAlign: 'middle', textAlign: 'center', padding: 2 }}>
        <div style={{ fontSize: 8, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace" }}>—</div>
      </td>
    )
  }

  const dc   = deadlineColor(zone.deadline)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d    = new Date(zone.deadline + 'T00:00:00')
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const lbl  = diff < 0 ? `▲` : `J-${diff}`
  const ds2  = zone.deadline.slice(5, 10).replace('-', '/')

  return (
    <td style={{
      borderLeft: '2px solid var(--border)', verticalAlign: 'middle',
      textAlign: 'center', padding: isMulti ? '2px 1px' : '4px 3px',
      background: dc + '12',
    }}>
      <div style={{ fontSize: isMulti ? 7 : 8.5, fontWeight: 800, color: dc, fontFamily: "'DM Mono', monospace", lineHeight: 1.15, whiteSpace: 'nowrap' }}>
        {lbl}
      </div>
      <div style={{ fontSize: 6.5, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace", marginTop: 2, lineHeight: 1 }}>
        {ds2}
      </div>
    </td>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)',
}
