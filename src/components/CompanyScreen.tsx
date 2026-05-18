'use client'

import { useState } from 'react'
import type { Intervention, Zone, Trade, Company } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getTradeColor, getZoneFloorColor } from '@/constants/colors'
import { fmtDate } from '@/lib/dates'
import TaskDetail from './TaskDetail'

interface Props {
  companyName: string
  interventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
  authorName?: string
  onUpdate: (id: string, patch: Partial<Intervention>) => void
}

const FR_DAYS  = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
const WEEK_LABELS = ['Sem. actuelle', 'S+1', 'S+2', 'S+3']

type StatusFilter = 'encours' | 'termine' | 'en_retard' | 'bloque' | null

function localDateStr(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function getWeekDaysForOffset(offset: number): string[] {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const mon = new Date(today)
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7)
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return localDateStr(d)
  })
}

function isActiveOn(iv: Intervention, ds: string): boolean {
  if (iv.status === 'termine') return false
  const s = iv.start_date ?? '', e = iv.end_date ?? s
  if (!s || s > ds || e < ds) return false
  if (iv.off_days?.includes(ds)) return false
  return true
}

function weekLabel(offset: number): string {
  const days = getWeekDaysForOffset(offset)
  const mon = new Date(days[0] + 'T00:00:00')
  const fri = new Date(days[4] + 'T00:00:00')
  const fmtShort = (d: Date) => `${d.getDate()} ${['jan','fév','mar','avr','mai','juin','juil','août','sep','oct','nov','déc'][d.getMonth()]}`
  return `${fmtShort(mon)} – ${fmtShort(fri)}`
}

export default function CompanyScreen({ companyName, interventions, zones, trades, companies, authorName, onUpdate }: Props) {
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>([0])
  const [selectedDay, setSelectedDay]     = useState<string | null>(null)
  const [statusFilter, setStatusFilter]   = useState<StatusFilter>(null)

  const co    = companies.find(c => c.name === companyName)
  const trade = trades.find(t => t.id === co?.trade_id)
  const tc    = getTradeColor(trade?.color ?? 'blue')
  const today = localDateStr(new Date())

  const allMyIvs = interventions.filter(iv => iv.company === companyName)
  const myIvs    = allMyIvs.filter(iv => iv.status !== 'termine')

  const cntEncours  = allMyIvs.filter(iv => effectiveStatus(iv) === 'encours').length
  const cntTermine  = allMyIvs.filter(iv => iv.status === 'termine').length
  const cntRetard   = allMyIvs.filter(iv => effectiveStatus(iv) === 'en_retard').length
  const cntBloque   = allMyIvs.filter(iv => effectiveStatus(iv) === 'bloque').length

  function toggleWeek(i: number) {
    setSelectedWeeks(prev =>
      prev.includes(i) ? (prev.length > 1 ? prev.filter(w => w !== i) : prev) : [...prev, i].sort()
    )
    setSelectedDay(null)
  }

  // All days across selected weeks, deduplicated and sorted
  const allSelectedDays = [...new Set(
    selectedWeeks.flatMap(w => getWeekDaysForOffset(w))
  )].sort()

  // Days for the planning strip: group by week, each week is a row
  const weekDayGroups = selectedWeeks.map(w => ({
    offset: w,
    label: WEEK_LABELS[w],
    days: getWeekDaysForOffset(w),
  }))

  // Tasks visible in the day panel (when a day is selected)
  const dayPanelIvs = selectedDay
    ? myIvs.filter(iv => isActiveOn(iv, selectedDay))
    : []

  // Build grouped task list by week
  function getIvsForWeek(offset: number): Intervention[] {
    const days = getWeekDaysForOffset(offset)
    const filteredByStatus = statusFilter === 'termine'
      ? allMyIvs.filter(iv => iv.status === 'termine')
      : statusFilter
        ? allMyIvs.filter(iv => effectiveStatus(iv) === statusFilter)
        : myIvs

    return filteredByStatus.filter(iv => {
      const s = iv.start_date ?? '', e = iv.end_date ?? s
      return days.some(d => s <= d && d <= e)
    }).sort((a, b) => {
      const order: Record<string, number> = { en_retard: 0, bloque: 1, encours: 2, a_venir: 3, planifie: 3, termine: 4 }
      return (order[effectiveStatus(a)] ?? 3) - (order[effectiveStatus(b)] ?? 3)
    })
  }

  const selectedIv = selectedId ? interventions.find(iv => iv.id === selectedId) ?? null : null

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingBottom: 80 }}>

      {/* ── Bandeau statuts ── */}
      <div style={{ margin: '14px 14px 0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {([
            { key: 'encours'   as StatusFilter, label: 'En cours',  value: cntEncours, color: STATUS_META.encours.dot,   bg: STATUS_META.encours.bg },
            { key: 'en_retard' as StatusFilter, label: 'En retard', value: cntRetard,  color: STATUS_META.en_retard.dot, bg: STATUS_META.en_retard.bg },
            { key: 'bloque'    as StatusFilter, label: 'Bloquées',  value: cntBloque,  color: STATUS_META.bloque.dot,    bg: STATUS_META.bloque.bg },
            { key: 'termine'   as StatusFilter, label: 'Terminées', value: cntTermine, color: STATUS_META.termine.dot,   bg: STATUS_META.termine.bg },
          ] as { key: StatusFilter; label: string; value: number; color: string; bg: string }[]).map(s => {
            const active = statusFilter === s.key
            return (
              <button key={s.label} onClick={() => setStatusFilter(active ? null : s.key)} style={{
                textAlign: 'center', borderRadius: 'var(--r-sm)', padding: '8px 4px', cursor: 'pointer',
                background: active ? s.bg : 'var(--surface-2)',
                border: `1px solid ${active ? s.color : 'transparent'}`,
              }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 9, color: active ? s.color : 'var(--muted)', marginTop: 2, fontWeight: active ? 700 : 400 }}>{s.label}</div>
              </button>
            )
          })}
        </div>
        {statusFilter && (
          <div style={{ padding: '4px 14px 10px' }}>
            <button onClick={() => setStatusFilter(null)} style={{
              fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600,
            }}>← Voir toutes les tâches</button>
          </div>
        )}
      </div>

      {/* ── Planning ── */}
      <div style={{ margin: '14px 14px 0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>

        {/* Sélecteur de semaines */}
        <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Planning</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {WEEK_LABELS.map((lbl, i) => {
              const active = selectedWeeks.includes(i)
              return (
                <button key={i} onClick={() => toggleWeek(i)} style={{
                  padding: '3px 7px', borderRadius: 6,
                  border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                  background: active ? 'var(--primary-l)' : 'var(--surface-2)',
                  color: active ? 'var(--primary)' : 'var(--muted)',
                  fontSize: 9, fontWeight: active ? 700 : 600, cursor: 'pointer',
                }}>{lbl}</button>
              )
            })}
          </div>
        </div>

        {/* Grille jours par semaine */}
        {weekDayGroups.map(({ offset, label, days }) => (
          <div key={offset}>
            {selectedWeeks.length > 1 && (
              <div style={{ padding: '6px 14px 4px', fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', background: 'var(--surface-2)', borderTop: offset !== selectedWeeks[0] ? '1px solid var(--border)' : undefined }}>
                {label}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
              {days.map(ds => {
                const dayIvs   = myIvs.filter(iv => isActiveOn(iv, ds))
                const isToday  = ds === today
                const isSel    = selectedDay === ds
                const d        = new Date(ds + 'T00:00:00')
                const zoneNames = [...new Set(dayIvs.map(iv => zones.find(z => z.id === iv.zone)?.short ?? '?'))]
                return (
                  <div
                    key={ds}
                    onClick={() => setSelectedDay(isSel ? null : ds)}
                    style={{
                      padding: '8px 4px', textAlign: 'center',
                      borderLeft: '1px solid var(--border)',
                      borderTop: '1px solid var(--border)',
                      cursor: dayIvs.length > 0 ? 'pointer' : 'default',
                      background: isSel ? tc.bg : dayIvs.length > 0 ? tc.bg + '80' : 'var(--surface-2)',
                      outline: isSel ? `2px solid ${tc.b}` : undefined,
                      outlineOffset: -2,
                    }}
                  >
                    <div style={{ fontSize: 8, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--muted)', textTransform: 'uppercase' }}>
                      {FR_DAYS[d.getDay()]}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: dayIvs.length > 0 ? tc.b : 'var(--border)', lineHeight: 1.2, marginBottom: 4 }}>
                      {d.getDate()}
                    </div>
                    {dayIvs.length > 0 ? (
                      <>
                        <div style={{ fontSize: 9, fontWeight: 700, color: tc.b }}>{dayIvs.length} int.</div>
                        <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2, lineHeight: 1.3 }}>
                          {zoneNames.slice(0, 2).join(', ')}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 9, color: 'var(--border)' }}>—</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Panel tâches du jour sélectionné */}
        {selectedDay && (
          <div style={{ borderTop: `2px solid ${tc.b}`, padding: '10px 14px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: tc.b, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {FR_DAYS[new Date(selectedDay + 'T00:00:00').getDay()]} {new Date(selectedDay + 'T00:00:00').getDate()} — {dayPanelIvs.length} intervention{dayPanelIvs.length !== 1 ? 's' : ''}
            </div>
            {dayPanelIvs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Aucune intervention ce jour.</div>
            ) : dayPanelIvs.map(iv => {
              const es = effectiveStatus(iv)
              const sm = STATUS_META[es]
              const z  = zones.find(z => z.id === iv.zone)
              return (
                <div
                  key={iv.id}
                  onClick={() => setSelectedId(iv.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: sm.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{iv.task}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {z?.short}{z ? ' · ' : ''}<span style={{ color: sm.dot, fontWeight: 600 }}>{sm.label}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>›</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Tâches par semaine ── */}
      <div style={{ padding: '14px 14px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          {statusFilter ? STATUS_META[statusFilter]?.label ?? 'Tâches' : 'Mes tâches'}
        </div>

        {selectedWeeks.map(offset => {
          const weekIvs = getIvsForWeek(offset)
          if (weekIvs.length === 0 && selectedWeeks.length > 1) return null
          return (
            <div key={offset} style={{ marginBottom: 16 }}>
              {selectedWeeks.length > 1 && (
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--primary-l)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {WEEK_LABELS[offset]} · {weekLabel(offset)}
                </div>
              )}
              {weekIvs.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, padding: '12px 0' }}>
                  Aucune tâche cette semaine.
                </div>
              ) : weekIvs.map(iv => {
                const es = effectiveStatus(iv)
                const sm = STATUS_META[es]
                const z  = zones.find(z => z.id === iv.zone)
                return (
                  <div
                    key={iv.id}
                    onClick={() => setSelectedId(iv.id)}
                    style={{
                      marginBottom: 8, background: 'var(--surface)',
                      border: `1px solid ${es === 'en_retard' ? '#EA580C' : es === 'bloque' ? 'var(--danger)' : 'var(--border)'}`,
                      borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden', cursor: 'pointer',
                    }}
                  >
                    <div style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: sm.dot, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{iv.task}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 10, color: sm.dot, fontWeight: 700, background: sm.bg, padding: '1px 6px', borderRadius: 999 }}>{sm.label}</span>
                          {z && <span style={{ fontSize: 10, color: 'var(--muted)' }}>📍 {z.short}</span>}
                          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'DM Mono', monospace" }}>
                            {fmtDate(iv.start_date)}{iv.end_date && iv.end_date !== iv.start_date ? ` → ${fmtDate(iv.end_date)}` : ''}
                          </span>
                        </div>
                        {iv.prereq?.trim() && (
                          <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 4 }}>⚠ Prérequis : {iv.prereq}</div>
                        )}
                        {iv.notes?.trim() && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>{iv.notes}</div>
                        )}
                      </div>
                      <span style={{ fontSize: 14, color: 'var(--muted)', flexShrink: 0, alignSelf: 'center' }}>›</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {selectedIv && (
        <TaskDetail
          iv={selectedIv}
          zones={zones} trades={trades} companies={companies} allInterventions={interventions}
          readOnly
          authorName={authorName}
          onClose={() => setSelectedId(null)}
          onUpdate={(patch) => { onUpdate(selectedIv.id, patch); setSelectedId(null) }}
        />
      )}
    </div>
  )
}
