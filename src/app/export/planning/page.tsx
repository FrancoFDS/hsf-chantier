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

function isActiveOn(iv: Intervention, ds: string): boolean {
  if (iv.status === 'termine') return false
  const s = iv.start_date ?? '', e = iv.end_date ?? s
  if (!s || s > ds || e < ds) return false
  if (iv.off_days?.includes(ds)) return false
  return true
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
  const allDays = weeks.flat()
  const today   = localStr(new Date())
  const floors  = [...new Set(zones.map(z => z.floor).filter(Boolean))].sort()
  const printedAt = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#6B6860' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Chargement du planning…</div>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; background: #ECEAE5; }

        @media print {
          @page { size: A4 landscape; margin: 0.8cm 1cm; }
          html, body { background: white !important; }
          .no-print { display: none !important; }
          .print-sheet {
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            page-break-after: always;
            page-break-inside: avoid;
          }
          .print-sheet:last-child { page-break-after: auto; }
        }
      `}</style>

      {/* ── Toolbar (masquée à l'impression) ────────────────────────────── */}
      <div className="no-print" style={{
        background: '#1A1A1A', color: '#fff', padding: '0 20px',
        height: 52, display: 'flex', alignItems: 'center', gap: 16,
        fontFamily: 'DM Sans, sans-serif', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <span style={{ fontWeight: 900, fontSize: 12, letterSpacing: '.1em', opacity: .4 }}>PLANIFY</span>
        <span style={{ opacity: .15, fontSize: 18 }}>|</span>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Export Planning</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, opacity: .5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Durée</span>
            {([1, 2, 3] as const).map(n => (
              <button key={n} onClick={() => setWeekCount(n)} style={{
                padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: weekCount === n ? '#2152C8' : 'rgba(255,255,255,.1)',
                color: weekCount === n ? '#fff' : 'rgba(255,255,255,.55)',
              }}>{n} sem.</button>
            ))}
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,.12)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, opacity: .5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Semaine</span>
            <button onClick={() => setStartOffset(o => Math.max(0, o - 1))} disabled={startOffset === 0} style={{
              width: 28, height: 28, borderRadius: 6, border: 'none', cursor: startOffset === 0 ? 'not-allowed' : 'pointer',
              background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.7)', fontSize: 14, fontWeight: 700,
              opacity: startOffset === 0 ? .35 : 1,
            }}>‹</button>
            <span style={{ fontSize: 11, opacity: .7, minWidth: 70, textAlign: 'center' }}>
              {startOffset === 0 ? 'Actuelle' : `S+${startOffset}`}{weekCount > 1 ? ` → S+${startOffset + weekCount - 1}` : ''}
            </span>
            <button onClick={() => setStartOffset(o => o + 1)} style={{
              width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.7)', fontSize: 14, fontWeight: 700,
            }}>›</button>
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,.12)' }} />

          <button onClick={() => window.print()} style={{
            padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: '#2152C8', color: '#fff', fontSize: 12, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            🖨 Imprimer / PDF
          </button>
        </div>
      </div>

      {/* ── Pages ───────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 20px 40px', background: '#ECEAE5', minHeight: 'calc(100vh - 52px)' }}>
        {weeks.map((weekDays, wi) => {
          const weekRange = fmtDateRange(weekDays)

          // Only zones that have at least one intervention this week
          const activeZones = zones.filter(zone =>
            weekDays.some(ds => interventions.some(iv => iv.zone === zone.id && isActiveOn(iv, ds)))
          )
          const activeFloors = [...new Set(activeZones.map(z => z.floor).filter(Boolean))].sort()

          return (
            <div key={wi} className="print-sheet" style={{
              background: '#fff',
              borderRadius: 10,
              boxShadow: '0 2px 20px rgba(0,0,0,.09)',
              marginBottom: 24,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}>

              {/* ── Page header ── */}
              <div style={{
                background: '#1A1A1A', color: '#fff',
                padding: '11px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 9, letterSpacing: '.12em', opacity: .4, textTransform: 'uppercase' }}>Planify</div>
                    <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.3px', lineHeight: 1.1 }}>HSF Av. Marceau</div>
                  </div>
                  <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,.15)' }} />
                  <div>
                    <div style={{ fontSize: 9, opacity: .45, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em' }}>Planning</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{weekRange}</div>
                  </div>
                  {weekCount > 1 && (
                    <div style={{ fontSize: 11, opacity: .5, marginLeft: 6 }}>
                      (semaine {wi + 1}/{weekCount})
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, opacity: .35 }}>Imprimé le {printedAt}</div>
                  <div style={{ fontSize: 10, opacity: .5, marginTop: 2 }}>
                    {activeZones.length} zone{activeZones.length > 1 ? 's' : ''} · {interventions.filter(iv => weekDays.some(ds => isActiveOn(iv, ds))).length} interventions
                  </div>
                </div>
              </div>

              {/* ── Day header ── */}
              <div style={{
                display: 'grid', gridTemplateColumns: '100px repeat(5, 1fr)',
                background: '#F8F7F4', borderBottom: '2px solid #E2DDD6',
                flexShrink: 0,
              }}>
                <div style={{ padding: '8px 10px', borderRight: '1px solid #E2DDD6', display: 'flex', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 8, fontWeight: 800, color: '#B0ABA3', textTransform: 'uppercase', letterSpacing: '.08em' }}>Zone / Tâches</span>
                </div>
                {weekDays.map(ds => {
                  const { short, num, month } = fmtDayLabel(ds)
                  const isToday = ds === today
                  const cnt = interventions.filter(iv => isActiveOn(iv, ds)).length
                  return (
                    <div key={ds} style={{
                      padding: '8px 6px 6px', textAlign: 'center',
                      borderRight: '1px solid #E2DDD6',
                      borderTop: `3px solid ${isToday ? '#2152C8' : 'transparent'}`,
                      background: isToday ? '#EEF2FC' : 'transparent',
                    }}>
                      <div style={{ fontSize: 8, fontWeight: 800, color: isToday ? '#2152C8' : '#B0ABA3', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 1 }}>{short}</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: isToday ? '#2152C8' : '#1A1A1A', lineHeight: 1 }}>{num}</div>
                      <div style={{ fontSize: 8, color: '#B0ABA3', marginBottom: 4 }}>{month}</div>
                      <div style={{
                        fontSize: 9, fontWeight: 700, display: 'inline-block',
                        color: isToday ? '#2152C8' : '#6B6860',
                        background: isToday ? 'rgba(33,82,200,.1)' : '#EFEDE8',
                        borderRadius: 99, padding: '2px 7px',
                      }}>
                        {cnt > 0 ? `${cnt} int.` : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* ── Zone rows grouped by floor ── */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                {activeFloors.map(floor => {
                  const floorZones = activeZones.filter(z => z.floor === floor)
                  const fc = getZoneFloorColor(zones, floor)

                  return (
                    <div key={floor}>

                      {/* Floor header */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '100px repeat(5, 1fr)',
                        background: fc + '18',
                        borderTop: `1px solid ${fc}50`,
                        borderBottom: `1px solid ${fc}30`,
                      }}>
                        <div style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: fc, flexShrink: 0, display: 'inline-block' }} />
                          <span style={{ fontSize: 9, fontWeight: 900, color: fc, textTransform: 'uppercase', letterSpacing: '.07em' }}>{floor}</span>
                        </div>
                        {weekDays.map(ds => {
                          const cnt = floorZones.reduce((acc, z) =>
                            acc + interventions.filter(iv => iv.zone === z.id && isActiveOn(iv, ds)).length, 0)
                          return (
                            <div key={ds} style={{ padding: '4px 6px', textAlign: 'center', borderLeft: `1px solid ${fc}25` }}>
                              {cnt > 0 && (
                                <span style={{ fontSize: 8, color: fc, fontWeight: 700 }}>{cnt} int.</span>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Zone rows */}
                      {floorZones.map((zone, zi) => (
                        <div key={zone.id} style={{
                          display: 'grid', gridTemplateColumns: '100px repeat(5, 1fr)',
                          borderBottom: zi < floorZones.length - 1 ? '1px solid #F0EDE6' : '1px solid #E2DDD6',
                        }}>
                          {/* Zone label */}
                          <div style={{
                            padding: '6px 8px 6px 10px', borderRight: '1px solid #E2DDD6',
                            background: '#FAFAF8', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                          }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: '#1A1A1A', lineHeight: 1.2 }}>{zone.short}</div>
                            <div style={{ fontSize: 8, color: '#ABA8A0', marginTop: 1, lineHeight: 1.3 }}>{zone.name}</div>
                          </div>

                          {/* Day cells */}
                          {weekDays.map(ds => {
                            const dayIvs = interventions.filter(iv => iv.zone === zone.id && isActiveOn(iv, ds))
                            const isToday = ds === today
                            return (
                              <div key={ds} style={{
                                padding: '4px', borderRight: '1px solid #F0EDE6',
                                display: 'flex', flexDirection: 'column', gap: 2,
                                background: isToday ? 'rgba(33,82,200,.025)' : 'transparent',
                              }}>
                                {dayIvs.map(iv => {
                                  const co = companies.find(c => c.name === iv.company)
                                  const tr = trades.find(t => t.id === (co?.trade_id ?? iv.trade))
                                  const tc = getTradeColor(tr?.color ?? 'blue')
                                  const es = effectiveStatus(iv)
                                  const sm = STATUS_META[es]
                                  const isAlert = es === 'en_retard' || es === 'bloque'
                                  return (
                                    <div key={iv.id} style={{
                                      background: isAlert ? sm.bg : tc.bg,
                                      borderLeft: `2.5px solid ${isAlert ? sm.dot : tc.b}`,
                                      borderRadius: 3,
                                      padding: '3px 5px',
                                      border: `1px solid ${isAlert ? sm.dot + '40' : tc.b + '30'}`,
                                      borderLeftWidth: '2.5px',
                                    }}>
                                      {/* Company */}
                                      <div style={{
                                        fontSize: 8.5, fontWeight: 800,
                                        color: isAlert ? sm.dot : tc.b,
                                        lineHeight: 1.2, marginBottom: 1,
                                      }}>
                                        {iv.company}
                                        {isAlert && (
                                          <span style={{ marginLeft: 4, fontSize: 7.5, fontWeight: 700, opacity: .8 }}>
                                            · {sm.label}
                                          </span>
                                        )}
                                      </div>
                                      {/* Task */}
                                      <div style={{
                                        fontSize: 8, color: '#2A2A2A', lineHeight: 1.35,
                                        wordBreak: 'break-word', hyphens: 'auto',
                                      }}>
                                        {iv.task_number ? (
                                          <span style={{ fontFamily: 'DM Mono, monospace', color: '#888', marginRight: 3 }}>[{iv.task_number}]</span>
                                        ) : null}
                                        {iv.task}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>

              {/* ── Legend ── */}
              <div style={{
                padding: '7px 14px', borderTop: '1px solid #E2DDD6',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#F8F7F4', flexShrink: 0, flexWrap: 'wrap', gap: 8,
              }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 8, fontWeight: 800, color: '#B0ABA3', textTransform: 'uppercase', letterSpacing: '.07em' }}>Corps de métier</span>
                  {trades.map(t => {
                    const tc = getTradeColor(t.color)
                    const hasIv = interventions.some(iv => {
                      const co = companies.find(c => c.name === iv.company)
                      return co?.trade_id === t.id && weekDays.some(ds => isActiveOn(iv, ds))
                    })
                    if (!hasIv) return null
                    return (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: tc.b, display: 'inline-block' }} />
                        <span style={{ fontSize: 8, fontWeight: 600, color: '#5A5855' }}>{t.name}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 8, fontWeight: 800, color: '#B0ABA3', textTransform: 'uppercase', letterSpacing: '.07em' }}>Alertes</span>
                  {(['en_retard', 'bloque'] as const).map(s => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_META[s].dot, display: 'inline-block' }} />
                      <span style={{ fontSize: 8, color: STATUS_META[s].dot, fontWeight: 700 }}>{STATUS_META[s].label}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )
        })}
      </div>
    </>
  )
}
