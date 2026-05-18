'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Intervention, Zone, Trade, Company } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getTradeColor, getZoneFloorColor } from '@/constants/colors'

// ─── Date helpers ─────────────────────────────────────────────────────────────

const FR_DAYS_SHORT = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
const FR_MONTHS     = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
const FR_MONTHS_S   = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.']

function localStr(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
}

function getWeekDays(offsetWeeks: number): string[] {
  const today = new Date(); today.setHours(0,0,0,0)
  const dow = today.getDay()
  const mon = new Date(today)
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offsetWeeks * 7)
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return localStr(d)
  })
}

function fmtDayLabel(ds: string) {
  const d = new Date(ds + 'T00:00:00')
  return { short: FR_DAYS_SHORT[d.getDay()], num: d.getDate(), month: FR_MONTHS_S[d.getMonth()] }
}

function fmtDateRange(days: string[]): string {
  const first = new Date(days[0] + 'T00:00:00')
  const last  = new Date(days[days.length - 1] + 'T00:00:00')
  if (first.getMonth() === last.getMonth())
    return `${first.getDate()} – ${last.getDate()} ${FR_MONTHS[last.getMonth()]} ${last.getFullYear()}`
  return `${first.getDate()} ${FR_MONTHS_S[first.getMonth()]} – ${last.getDate()} ${FR_MONTHS_S[last.getMonth()]} ${last.getFullYear()}`
}

// ─── Gantt logic ──────────────────────────────────────────────────────────────

interface GanttBar {
  iv: Intervention
  startCol: number  // 0–4 (clamped to week)
  endCol: number    // 0–4
  lane: number
  startsBeforeWeek: boolean
  endsAfterWeek: boolean
}

function buildGanttBars(ivs: Intervention[], weekDays: string[]): { bars: GanttBar[]; laneCount: number } {
  const weekStart = weekDays[0]
  const weekEnd   = weekDays[4]

  // Keep tasks that overlap with this week
  const active = ivs.filter(iv => {
    if (iv.status === 'termine') return false
    const s = iv.start_date ?? '', e = iv.end_date ?? s
    return s && s <= weekEnd && e >= weekStart
  })

  // Compute column spans (clamped to 0–4)
  const withSpans = active.map(iv => {
    const s = iv.start_date!
    const e = iv.end_date ?? s
    const startCol = Math.max(0, weekDays.findIndex(d => d >= s))
    const endIdx = [...weekDays].reverse().findIndex(d => d <= e)
    const endCol  = endIdx === -1 ? 4 : 4 - endIdx
    return {
      iv,
      startCol: Math.min(startCol, 4),
      endCol:   Math.max(Math.min(endCol, 4), startCol),
      startsBeforeWeek: s < weekStart,
      endsAfterWeek:    e > weekEnd,
      lane: 0,
    }
  })

  // Sort by startCol asc, then span length desc (wider bars get earlier lanes)
  withSpans.sort((a, b) =>
    a.startCol !== b.startCol
      ? a.startCol - b.startCol
      : (b.endCol - b.startCol) - (a.endCol - a.startCol)
  )

  // Greedy lane assignment: pack tasks tightly
  const laneEnds: number[] = [] // laneEnds[i] = endCol of last task in lane i
  for (const bar of withSpans) {
    const laneIdx = laneEnds.findIndex(end => end < bar.startCol)
    if (laneIdx === -1) {
      bar.lane = laneEnds.length
      laneEnds.push(bar.endCol)
    } else {
      bar.lane = laneIdx
      laneEnds[laneIdx] = bar.endCol
    }
  }

  return { bars: withSpans, laneCount: laneEnds.length }
}

// Renders one Gantt lane row (fills all 5 columns, tasks span their columns)
function LaneRow({ bars, weekDays, today, trades, companies }: {
  bars: GanttBar[]
  weekDays: string[]
  today: string
  trades: Trade[]
  companies: Company[]
}) {
  // Build 5-column grid: each segment is either a task bar or an empty cell
  type Seg = { type: 'task'; bar: GanttBar; span: number } | { type: 'empty'; col: number; span: number }
  const segs: Seg[] = []
  let cursor = 0
  const sorted = [...bars].sort((a, b) => a.startCol - b.startCol)

  for (const bar of sorted) {
    if (bar.startCol > cursor) {
      segs.push({ type: 'empty', col: cursor, span: bar.startCol - cursor })
    }
    segs.push({ type: 'task', bar, span: bar.endCol - bar.startCol + 1 })
    cursor = bar.endCol + 1
  }
  if (cursor < 5) segs.push({ type: 'empty', col: cursor, span: 5 - cursor })

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      minHeight: 30,
    }}>
      {segs.map((seg, i) => {
        if (seg.type === 'empty') {
          // Render empty cells (one per column so borders appear)
          return Array.from({ length: seg.span }, (_, j) => {
            const col = seg.col + j
            const isToday = weekDays[col] === today
            return (
              <div key={`e-${i}-${j}`} style={{
                gridColumn: col + 1,
                borderRight: col < 4 ? '1px solid #EEEBE4' : 'none',
                background: isToday ? 'rgba(33,82,200,.03)' : 'transparent',
                minHeight: 30,
              }} />
            )
          })
        }

        // Task bar
        const { bar } = seg
        const co = companies.find(c => c.name === bar.iv.company)
        const tr = trades.find(t => t.id === (co?.trade_id ?? bar.iv.trade))
        const tc = getTradeColor(tr?.color ?? 'blue')
        const es = effectiveStatus(bar.iv)
        const sm = STATUS_META[es]
        const isAlert = es === 'en_retard' || es === 'bloque'
        const accent = isAlert ? sm.dot : tc.b
        const bg     = isAlert ? sm.bg  : tc.bg

        return (
          <div key={`t-${bar.iv.id}`} style={{
            gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`,
            padding: '3px 3px',
            borderRight: bar.endCol < 4 ? '1px solid #EEEBE4' : 'none',
            background: weekDays[bar.startCol] === today ? 'rgba(33,82,200,.03)' : 'transparent',
          }}>
            <div style={{
              height: '100%',
              background: bg,
              borderRadius: bar.startsBeforeWeek ? '0 4px 4px 0' : bar.endsAfterWeek ? '4px 0 0 4px' : 4,
              borderLeft:  `2.5px solid ${accent}`,
              borderTop:   `1px solid ${accent}25`,
              borderBottom:`1px solid ${accent}25`,
              borderRight: `1px solid ${accent}25`,
              padding: '3px 6px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 1,
            }}>
              <div style={{ fontSize: 8.5, fontWeight: 800, color: accent, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {bar.iv.company}
                {isAlert && <span style={{ marginLeft: 5, fontSize: 7, opacity: .85 }}>· {sm.label}</span>}
              </div>
              <div style={{ fontSize: 8, color: '#2A2A2A', lineHeight: 1.3, wordBreak: 'break-word' }}>
                {bar.iv.task_number
                  ? <span style={{ fontFamily: 'DM Mono, monospace', color: '#999', marginRight: 3 }}>[{bar.iv.task_number}]</span>
                  : null}
                {bar.iv.task}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main export page ─────────────────────────────────────────────────────────

export default function ExportPlanningPage() {
  const [zones, setZones]               = useState<Zone[]>([])
  const [trades, setTrades]             = useState<Trade[]>([])
  const [companies, setCompanies]       = useState<Company[]>([])
  const [interventions, setInterventions] = useState<Intervention[]>([])
  const [loading, setLoading]           = useState(true)
  const [weekCount, setWeekCount]       = useState<1 | 2 | 3>(1)
  const [startOffset, setStartOffset]   = useState(0)

  useEffect(() => {
    Promise.all([
      supabase.from('zones').select('*').order('display_order'),
      supabase.from('trades').select('*').order('display_order'),
      supabase.from('companies').select('*').order('display_order').eq('active', true),
      supabase.from('interventions').select('*').order('start_date').limit(1000),
    ]).then(([z, t, c, iv]) => {
      setZones((z.data ?? []) as Zone[])
      setTrades((t.data ?? []) as Trade[])
      setCompanies((c.data ?? []) as Company[])
      setInterventions((iv.data ?? []) as Intervention[])
      setLoading(false)
    })
  }, [])

  const weeks   = Array.from({ length: weekCount }, (_, i) => getWeekDays(startOffset + i))
  const today   = localStr(new Date())
  const floors  = [...new Set(zones.map(z => z.floor).filter(Boolean))].sort()
  const printedAt = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#6B6860' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Chargement…</div>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; background: #ECEAE5; }
        @media print {
          @page { size: A4 landscape; margin: 0.7cm 0.9cm; }
          html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .print-page { box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; page-break-after: always; }
          .print-page:last-child { page-break-after: auto; }
        }
      `}</style>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="no-print" style={{
        background: '#1A1A1A', color: '#fff', padding: '0 20px',
        height: 50, display: 'flex', alignItems: 'center', gap: 14,
        fontFamily: 'DM Sans, sans-serif', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <span style={{ fontWeight: 900, fontSize: 11, letterSpacing: '.1em', opacity: .4 }}>PLANIFY</span>
        <span style={{ opacity: .15 }}>|</span>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Export Planning</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, opacity: .45, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Durée</span>
            {([1, 2, 3] as const).map(n => (
              <button key={n} onClick={() => setWeekCount(n)} style={{
                padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: weekCount === n ? '#2152C8' : 'rgba(255,255,255,.1)',
                color: weekCount === n ? '#fff' : 'rgba(255,255,255,.5)',
              }}>{n} sem.</button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.12)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, opacity: .45, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Semaine</span>
            <button onClick={() => setStartOffset(o => Math.max(0, o - 1))} disabled={startOffset === 0} style={{
              width: 26, height: 26, borderRadius: 6, border: 'none', cursor: startOffset === 0 ? 'not-allowed' : 'pointer',
              background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.7)', fontSize: 14, fontWeight: 700, opacity: startOffset === 0 ? .3 : 1,
            }}>‹</button>
            <span style={{ fontSize: 11, opacity: .6, minWidth: 65, textAlign: 'center' }}>
              {startOffset === 0 ? 'Actuelle' : `S+${startOffset}`}{weekCount > 1 ? `→S+${startOffset + weekCount - 1}` : ''}
            </span>
            <button onClick={() => setStartOffset(o => o + 1)} style={{
              width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.7)', fontSize: 14, fontWeight: 700,
            }}>›</button>
          </div>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.12)' }} />
          <button onClick={() => window.print()} style={{
            padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: '#2152C8', color: '#fff', fontSize: 12, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>🖨 Imprimer / PDF</button>
        </div>
      </div>

      {/* ── Pages ───────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 20px 40px', background: '#ECEAE5', minHeight: 'calc(100vh - 50px)' }}>
        {weeks.map((weekDays, wi) => {
          const weekRange  = fmtDateRange(weekDays)
          const totalIvs   = interventions.filter(iv => {
            if (iv.status === 'termine') return false
            const s = iv.start_date ?? '', e = iv.end_date ?? s
            return s && s <= weekDays[4] && e >= weekDays[0]
          })

          // Only floors/zones with tasks this week
          const activeFloors = floors.filter(floor =>
            zones.some(z => z.floor === floor && totalIvs.some(iv => iv.zone === z.id))
          )

          return (
            <div key={wi} className="print-page" style={{
              background: '#fff', borderRadius: 10,
              boxShadow: '0 2px 20px rgba(0,0,0,.09)',
              marginBottom: 24, overflow: 'hidden',
            }}>

              {/* Page header */}
              <div style={{
                background: '#1A1A1A', color: '#fff',
                padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 8, letterSpacing: '.12em', opacity: .4, textTransform: 'uppercase' }}>Planify</div>
                    <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-.3px', lineHeight: 1.1 }}>HSF Av. Marceau</div>
                  </div>
                  <div style={{ width: 1, height: 26, background: 'rgba(255,255,255,.15)' }} />
                  <div>
                    <div style={{ fontSize: 8, opacity: .4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Planning</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{weekRange}</div>
                  </div>
                  {weekCount > 1 && (
                    <span style={{ fontSize: 10, opacity: .45 }}>· semaine {wi + 1}/{weekCount}</span>
                  )}
                </div>
                <div style={{ textAlign: 'right', fontSize: 9, opacity: .4 }}>
                  <div>Imprimé le {printedAt}</div>
                  <div style={{ marginTop: 2 }}>{totalIvs.length} interventions · {activeFloors.length} étages</div>
                </div>
              </div>

              {/* Column grid: zone label + 5 days */}
              <div style={{ display: 'grid', gridTemplateColumns: '88px repeat(5, 1fr)', borderBottom: '2px solid #E2DDD6', background: '#F8F7F4' }}>
                <div style={{ padding: '7px 8px', borderRight: '1px solid #E2DDD6', display: 'flex', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 7.5, fontWeight: 800, color: '#B0ABA3', textTransform: 'uppercase', letterSpacing: '.08em' }}>Zone</span>
                </div>
                {weekDays.map(ds => {
                  const { short, num, month } = fmtDayLabel(ds)
                  const isToday = ds === today
                  const cnt = totalIvs.filter(iv => {
                    const s = iv.start_date ?? '', e = iv.end_date ?? s
                    return s <= ds && e >= ds
                  }).length
                  return (
                    <div key={ds} style={{
                      padding: '7px 6px 5px', textAlign: 'center', borderRight: '1px solid #E2DDD6',
                      borderTop: `3px solid ${isToday ? '#2152C8' : 'transparent'}`,
                      background: isToday ? '#EEF2FC' : 'transparent',
                    }}>
                      <div style={{ fontSize: 7.5, fontWeight: 800, color: isToday ? '#2152C8' : '#B0ABA3', textTransform: 'uppercase', letterSpacing: '.08em' }}>{short}</div>
                      <div style={{ fontSize: 19, fontWeight: 900, color: isToday ? '#2152C8' : '#1A1A1A', lineHeight: 1.05 }}>{num}</div>
                      <div style={{ fontSize: 7.5, color: '#B0ABA3', marginBottom: 4 }}>{month}</div>
                      <div style={{
                        fontSize: 8, fontWeight: 700, display: 'inline-block',
                        color: isToday ? '#2152C8' : '#6B6860',
                        background: isToday ? 'rgba(33,82,200,.1)' : '#EFEDE8',
                        borderRadius: 99, padding: '1px 6px',
                      }}>{cnt > 0 ? `${cnt} int.` : '—'}</div>
                    </div>
                  )
                })}
              </div>

              {/* Floors + zones */}
              {activeFloors.map(floor => {
                const floorZones = zones.filter(z => z.floor === floor && totalIvs.some(iv => iv.zone === z.id))
                const fc = getZoneFloorColor(zones, floor)

                return (
                  <div key={floor}>
                    {/* Floor header */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '88px repeat(5, 1fr)',
                      background: fc + '18', borderTop: `1px solid ${fc}45`, borderBottom: `1px solid ${fc}25`,
                    }}>
                      <div style={{ padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: fc, flexShrink: 0, display: 'inline-block' }} />
                        <span style={{ fontSize: 8.5, fontWeight: 900, color: fc, textTransform: 'uppercase', letterSpacing: '.07em' }}>{floor}</span>
                      </div>
                      {weekDays.map(ds => {
                        const cnt = floorZones.reduce((acc, z) =>
                          acc + totalIvs.filter(iv => iv.zone === z.id && (iv.start_date ?? '') <= ds && (iv.end_date ?? iv.start_date ?? '') >= ds).length, 0)
                        return (
                          <div key={ds} style={{ padding: '3px 6px', textAlign: 'center', borderLeft: `1px solid ${fc}20` }}>
                            {cnt > 0 && <span style={{ fontSize: 7.5, color: fc, fontWeight: 700 }}>{cnt} int.</span>}
                          </div>
                        )
                      })}
                    </div>

                    {/* Zone rows */}
                    {floorZones.map((zone, zi) => {
                      const zoneIvs = totalIvs.filter(iv => iv.zone === zone.id)
                      const { bars, laneCount } = buildGanttBars(zoneIvs, weekDays)
                      if (bars.length === 0) return null

                      return (
                        <div key={zone.id} style={{
                          display: 'grid',
                          gridTemplateColumns: '88px 1fr',
                          borderBottom: zi < floorZones.length - 1 ? '1px solid #EEEBE4' : `1px solid ${fc}30`,
                        }}>
                          {/* Zone label */}
                          <div style={{
                            padding: '5px 8px', borderRight: '1px solid #E2DDD6',
                            background: '#FAFAF8', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                          }}>
                            <div style={{ fontSize: 9.5, fontWeight: 800, color: '#1A1A1A', lineHeight: 1.2 }}>{zone.short}</div>
                            <div style={{ fontSize: 7.5, color: '#ABA8A0', marginTop: 1, lineHeight: 1.3 }}>{zone.name}</div>
                          </div>

                          {/* Gantt lanes */}
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {Array.from({ length: Math.max(laneCount, 1) }, (_, lane) => (
                              <LaneRow
                                key={lane}
                                bars={bars.filter(b => b.lane === lane)}
                                weekDays={weekDays}
                                today={today}
                                trades={trades}
                                companies={companies}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              {/* Legend */}
              <div style={{
                padding: '6px 14px', borderTop: '1px solid #E2DDD6',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#F8F7F4', flexWrap: 'wrap', gap: 8,
              }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 7.5, fontWeight: 800, color: '#B0ABA3', textTransform: 'uppercase', letterSpacing: '.07em' }}>Corps de métier</span>
                  {trades.map(t => {
                    const tc = getTradeColor(t.color)
                    const hasIv = totalIvs.some(iv => { const co = companies.find(c => c.name === iv.company); return co?.trade_id === t.id })
                    if (!hasIv) return null
                    return (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: tc.b, display: 'inline-block' }} />
                        <span style={{ fontSize: 7.5, fontWeight: 600, color: '#5A5855' }}>{t.name}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 7.5, fontWeight: 800, color: '#B0ABA3', textTransform: 'uppercase', letterSpacing: '.07em' }}>Alertes</span>
                  {(['en_retard', 'bloque'] as const).map(s => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_META[s].dot, display: 'inline-block' }} />
                      <span style={{ fontSize: 7.5, color: STATUS_META[s].dot, fontWeight: 700 }}>{STATUS_META[s].label}</span>
                    </div>
                  ))}
                  <span style={{ fontSize: 7.5, color: '#B0ABA3', marginLeft: 6 }}>◁ débute avant / ▷ continue après la semaine</span>
                </div>
              </div>

            </div>
          )
        })}
      </div>
    </>
  )
}
