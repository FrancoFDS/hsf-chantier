'use client'

import { useState } from 'react'
import type { Intervention, Zone, Trade, Company } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getTradeColor, getZoneFloorColor } from '@/constants/colors'
import { fmtDate } from '@/lib/dates'
import { supabase } from '@/lib/supabase'
import TaskDetail from './TaskDetail'

interface Props {
  companyName: string
  interventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
  onUpdate: (id: string, patch: Partial<Intervention>) => void
}

const FR_MNTHS = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.']
const FR_DAYS  = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']

function localDateStr(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function getWeekDays(): string[] {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const mon = new Date(today)
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return localDateStr(d)
  })
}

function getNextWeekDays(): string[] {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const mon = new Date(today)
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + 7)
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

export default function CompanyScreen({ companyName, interventions, zones, trades, companies, onUpdate }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reportId, setReportId]     = useState<string | null>(null)
  const [reportNote, setReportNote] = useState('')
  const [saving, setSaving]         = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)

  const co     = companies.find(c => c.name === companyName)
  const trade  = trades.find(t => t.id === co?.trade_id)
  const tc     = getTradeColor(trade?.color ?? 'blue')
  const today  = localDateStr(new Date())

  const myIvs = interventions.filter(iv => iv.company === companyName && iv.status !== 'termine')
  const days  = weekOffset === 0 ? getWeekDays() : getNextWeekDays()

  // Sort: en_retard → bloque → encours → others
  const sortedIvs = [...myIvs].sort((a, b) => {
    const order = { en_retard: 0, bloque: 1, encours: 2, a_venir: 3, planifie: 3 }
    return (order[effectiveStatus(a) as keyof typeof order] ?? 3) - (order[effectiveStatus(b) as keyof typeof order] ?? 3)
  })

  const enRetard = myIvs.filter(iv => effectiveStatus(iv) === 'en_retard').length
  const bloque   = myIvs.filter(iv => effectiveStatus(iv) === 'bloque').length

  async function handleReport(iv: Intervention) {
    setSaving(true)
    const patch = { status: 'bloque' as const, notes: reportNote.trim() || iv.notes }
    const { error } = await supabase.from('interventions').update(patch).eq('id', iv.id)
    if (!error) { onUpdate(iv.id, patch); setReportId(null); setReportNote('') }
    setSaving(false)
  }

  async function handleConfirm(iv: Intervention) {
    if (iv.status === 'encours') return
    setSaving(true)
    const patch = { status: 'encours' as const }
    const { error } = await supabase.from('interventions').update(patch).eq('id', iv.id)
    if (!error) onUpdate(iv.id, patch)
    setSaving(false)
  }

  const selectedIv = selectedId ? interventions.find(iv => iv.id === selectedId) ?? null : null

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingBottom: 80 }}>

      {/* ── Résumé ── */}
      <div style={{ margin: '14px 14px 0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            { label: 'Actives',   value: myIvs.length,  color: 'var(--text)' },
            { label: 'En retard', value: enRetard,       color: STATUS_META.en_retard.dot },
            { label: 'Bloquées',  value: bloque,         color: STATUS_META.bloque.dot },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: '8px 4px' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Planning de la semaine ── */}
      <div style={{ margin: '14px 14px 0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Planning</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['Sem. en cours', 'S+1'].map((lbl, i) => (
              <button key={i} onClick={() => setWeekOffset(i)} style={{
                padding: '3px 8px', borderRadius: 6, border: `1px solid ${weekOffset === i ? 'var(--primary)' : 'var(--border)'}`,
                background: weekOffset === i ? 'var(--primary-l)' : 'var(--surface-2)',
                color: weekOffset === i ? 'var(--primary)' : 'var(--muted)', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              }}>{lbl}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {days.map(ds => {
            const active = isActiveOn({ start_date: '', end_date: '', status: 'encours', company: companyName } as Intervention, ds)
            const dayIvs = myIvs.filter(iv => isActiveOn(iv, ds))
            const isToday = ds === today
            const d = new Date(ds + 'T00:00:00')
            const zoneNames = [...new Set(dayIvs.map(iv => zones.find(z => z.id === iv.zone)?.short ?? '?'))]
            return (
              <div key={ds} style={{
                padding: '8px 4px', textAlign: 'center', borderLeft: '1px solid var(--border)',
                background: dayIvs.length > 0 ? tc.bg : 'var(--surface-2)',
                borderBottom: '1px solid var(--border)',
              }}>
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

      {/* ── Liste des tâches ── */}
      <div style={{ padding: '14px 14px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          Mes tâches ({myIvs.length})
        </div>
        {sortedIvs.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>
            Aucune tâche active.
          </div>
        )}
        {sortedIvs.map(iv => {
          const es  = effectiveStatus(iv)
          const sm  = STATUS_META[es]
          const z   = zones.find(z => z.id === iv.zone)
          const fc  = getZoneFloorColor(zones, z?.floor ?? '')
          const isReporting = reportId === iv.id

          return (
            <div key={iv.id} style={{
              marginBottom: 10, background: 'var(--surface)', border: `1px solid ${es === 'en_retard' ? '#EA580C' : es === 'bloque' ? 'var(--danger)' : 'var(--border)'}`,
              borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden',
            }}>
              {/* Task header */}
              <div style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}
                onClick={() => setSelectedId(iv.id)}>
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
              </div>

              {/* Quick actions */}
              {!isReporting && (
                <div style={{ padding: '0 12px 10px', display: 'flex', gap: 8 }}>
                  {iv.status !== 'encours' && es !== 'en_retard' && (
                    <button onClick={() => handleConfirm(iv)} disabled={saving} style={{
                      padding: '6px 12px', borderRadius: 8, border: '1px solid #16A34A',
                      background: '#F0FDF4', color: '#16A34A', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}>
                      ✓ Confirmer ma présence
                    </button>
                  )}
                  {es !== 'bloque' && (
                    <button onClick={() => { setReportId(iv.id); setReportNote('') }} style={{
                      padding: '6px 12px', borderRadius: 8, border: '1px solid var(--danger)',
                      background: 'var(--danger-l)', color: 'var(--danger)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}>
                      ⚠ Signaler un problème
                    </button>
                  )}
                </div>
              )}

              {/* Report form */}
              {isReporting && (
                <div style={{ padding: '0 12px 10px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', marginBottom: 6, marginTop: 8 }}>Décrire le problème</div>
                  <textarea
                    value={reportNote}
                    onChange={e => setReportNote(e.target.value)}
                    placeholder="Ex. : accès zone bloqué, matériaux manquants..."
                    rows={2}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--surface-2)',
                      color: 'var(--text)', fontSize: 12, fontFamily: "'DM Sans', sans-serif', resize: 'none",
                      marginBottom: 8,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => handleReport(iv)} disabled={saving} style={{
                      flex: 1, padding: '8px', borderRadius: 8, border: 'none',
                      background: 'var(--danger)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}>
                      {saving ? 'Envoi...' : 'Envoyer'}
                    </button>
                    <button onClick={() => setReportId(null)} style={{
                      padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                      background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer',
                    }}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* TaskDetail modal */}
      {selectedIv && (
        <TaskDetail
          iv={selectedIv}
          zones={zones} trades={trades} allInterventions={interventions}
          onClose={() => setSelectedId(null)}
          onUpdate={(patch) => { onUpdate(selectedIv.id, patch); setSelectedId(null) }}
        />
      )}
    </div>
  )
}
