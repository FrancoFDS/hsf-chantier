'use client'

import { useEffect, useState } from 'react'
import type { Intervention, Zone, Trade, Company, ExternalContact } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getZoneFloorColor, getTradeColor } from '@/constants/colors'
import { fmtDate } from '@/lib/dates'
import { displayTradeId, primaryTradeId } from '@/lib/company'

interface Props {
  interventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const FR_MNTHS = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.']
const FR_DAYS  = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']
const FR_DAYS3 = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']

function localDateStr(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function getWeekRange(offset: number): { start: string; end: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const mon = new Date(today)
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7)
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4)
  return { start: localDateStr(mon), end: localDateStr(fri) }
}

function fmtShort(ds: string): string {
  if (!ds) return ''
  const d = new Date(ds + 'T00:00:00')
  return `${d.getDate()} ${FR_MNTHS[d.getMonth()]}`
}

function getWeekDays(week: { start: string; end: string }): string[] {
  const days: string[] = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(week.start + 'T00:00:00')
    d.setDate(d.getDate() + i)
    days.push(localDateStr(d))
  }
  return days
}

function getDayIvs(ivs: Intervention[], dateStr: string): Intervention[] {
  return ivs.filter(iv => {
    if (iv.status === 'termine') return false
    const s = iv.start_date ?? '', e = iv.end_date ?? s
    if (!s || s > dateStr || e < dateStr) return false
    if (iv.off_days?.includes(dateStr)) return false
    return true
  })
}

// ─── WhatsApp message generator (jour par jour) ───────────────────────────────

function generateMessage(
  contactFirstName: string,
  company: Company,
  ivs: Intervention[],
  zones: Zone[],
  activeWeeks: { start: string; end: string }[],
): string {
  const getZoneName = (zoneId: string) => {
    const z = zones.find(z => z.id === zoneId)
    return z ? `${z.floor ? z.floor + ' / ' : ''}${z.name}` : zoneId
  }

  const lines: string[] = []
  lines.push(`*Planify — HSF Av. Marceau*`)

  if (activeWeeks.length > 1) {
    lines.push(`Du lundi ${fmtShort(activeWeeks[0].start)} au vendredi ${fmtShort(activeWeeks[activeWeeks.length - 1].end)}`)
  } else {
    const w = activeWeeks[0]
    lines.push(`Semaine du ${fmtShort(w.start)} au ${fmtShort(w.end)}`)
  }

  lines.push(``)
  lines.push(`Bonjour ${contactFirstName || company.name} 👋`)
  lines.push(``)
  lines.push(`Vos interventions ${activeWeeks.length > 1 ? 'sur les semaines sélectionnées' : 'cette semaine'} :`)

  let hasAnyDay = false

  activeWeeks.forEach(w => {
    const days = getWeekDays(w)
    days.forEach(ds => {
      const dayIvs = getDayIvs(ivs, ds)
      if (!dayIvs.length) return
      hasAnyDay = true
      const d = new Date(ds + 'T00:00:00')
      lines.push(``)
      lines.push(`📅 *${FR_DAYS[d.getDay()]} ${d.getDate()} ${FR_MNTHS[d.getMonth()]}*`)
      const byZone: Record<string, Intervention[]> = {}
      dayIvs.forEach(iv => {
        const zn = getZoneName(iv.zone)
        if (!byZone[zn]) byZone[zn] = []
        byZone[zn].push(iv)
      })
      Object.entries(byZone).forEach(([zn, zivs]) => {
        zivs.forEach(iv => {
          const num = iv.task_number ? `[${iv.task_number}] ` : ''
          lines.push(`   📍 ${zn} — ${num}${iv.task}`)
        })
      })
    })
  })

  if (!hasAnyDay) {
    lines.push(``)
    lines.push(`Aucune intervention planifiée sur cette période.`)
  }

  const blocked = ivs.filter(iv => effectiveStatus(iv) === 'bloque')
  if (blocked.length) {
    lines.push(``)
    lines.push(`⚠️ *Point d'attention :* ${blocked.length} tâche${blocked.length > 1 ? 's' : ''} bloquée${blocked.length > 1 ? 's' : ''} — merci de confirmer la situation.`)
  }

  const prereqs = ivs.filter(iv => iv.prereq && iv.prereq_company)
  if (prereqs.length) {
    lines.push(``)
    prereqs.forEach(iv => {
      lines.push(`🔗 *Prérequis :* ${iv.prereq_company} doit intervenir avant vous sur cette zone.`)
    })
  }

  lines.push(``)
  lines.push(`⚠️ Le chantier avance avec l'ensemble des équipes, donc si tu as le moindre souci pour tenir une de ces interventions, merci de me prévenir au plus vite 📱`)
  return lines.join('\n')
}

// ─── WhatsApp URL ─────────────────────────────────────────────────────────────

function waUrl(phone: string, msg: string): string | null {
  if (!phone) return null
  let p = phone.replace(/\s/g, '').replace(/[^\d+]/g, '')
  if (p.startsWith('00')) p = '+' + p.slice(2)
  else if (p.startsWith('0')) p = '+33' + p.slice(1)
  else if (!p.startsWith('+')) p = '+33' + p
  const num = p.replace('+', '')
  const encoded = Array.from(msg).map(ch => encodeURIComponent(ch)).join('')
  return `https://wa.me/${num}?text=${encoded}`
}

// ─── Weekly plan grid ─────────────────────────────────────────────────────────

function WeeklyPlanGrid({ interventions, zones, trades, companies, activeWeeks }: {
  interventions: Intervention[]; zones: Zone[]; trades: Trade[]
  companies: Company[]; activeWeeks: { start: string; end: string }[]
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const today = localDateStr(new Date())

  const allDays = activeWeeks.flatMap(w => getWeekDays(w))

  return (
    <div style={{ margin: '14px 14px 0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Planning de la semaine</div>
      </div>

      {activeWeeks.map((week, wi) => {
        const days = getWeekDays(week)
        return (
          <div key={wi}>
            {activeWeeks.length > 1 && (
              <div style={{ padding: '6px 14px 4px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>
                Semaine du {fmtShort(week.start)} au {fmtShort(week.end)}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: wi < activeWeeks.length - 1 || selectedDay ? '1px solid var(--border)' : 'none' }}>
              {days.map(ds => {
                const dayIvs = getDayIvs(interventions, ds)
                const d = new Date(ds + 'T00:00:00')
                const isToday = ds === today
                const isSelected = ds === selectedDay
                const tradeColors = [...new Set(
                  dayIvs.map(iv => {
                    const co = companies.find(c => c.name === iv.company)
                    const tr = trades.find(t => t.id === displayTradeId(co, iv.trade))
                    return getTradeColor(tr?.color ?? 'blue').b
                  })
                )].slice(0, 5)

                return (
                  <button key={ds} onClick={() => setSelectedDay(isSelected ? null : ds)} style={{
                    padding: '10px 4px 8px', border: 'none', cursor: dayIvs.length ? 'pointer' : 'default',
                    background: isSelected ? 'var(--primary-l)' : isToday ? 'var(--surface-2)' : 'var(--surface)',
                    borderLeft: '1px solid var(--border)', textAlign: 'center',
                    borderBottom: isSelected ? '2px solid var(--primary)' : '2px solid transparent',
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      {FR_DAYS3[d.getDay()]}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: isToday ? 'var(--primary)' : 'var(--text)', lineHeight: 1.2, marginBottom: 6 }}>
                      {d.getDate()}
                    </div>
                    {dayIvs.length > 0 ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', marginBottom: 4 }}>
                          {tradeColors.map((c, i) => (
                            <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: c, display: 'inline-block' }} />
                          ))}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: "'DM Mono', monospace" }}>
                          {dayIvs.length} int.
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 9, color: 'var(--border)' }}>—</div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Day detail panel */}
      {selectedDay && (() => {
        const dayIvs = getDayIvs(interventions, selectedDay)
        const d = new Date(selectedDay + 'T00:00:00')
        const byZone: Record<string, Intervention[]> = {}
        dayIvs.forEach(iv => {
          const z = zones.find(z => z.id === iv.zone)
          const key = z ? `${z.floor ?? ''}_${z.id}` : iv.zone
          if (!byZone[key]) byZone[key] = []
          byZone[key].push(iv)
        })
        return (
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
              {FR_DAYS[d.getDay()]} {d.getDate()} {FR_MNTHS[d.getMonth()]}
            </div>
            {dayIvs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Aucune intervention planifiée.</div>
            ) : (
              Object.entries(byZone).map(([key, zivs]) => {
                const z = zones.find(z => z.id === zivs[0].zone)
                const fc = getZoneFloorColor(zones, z?.floor ?? '')
                return (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: fc, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{z?.short ?? z?.name ?? '—'}</span>
                    </div>
                    {zivs.map(iv => {
                      const co = companies.find(c => c.name === iv.company)
                      const tr = trades.find(t => t.id === displayTradeId(co, iv.trade))
                      const tc = getTradeColor(tr?.color ?? 'blue')
                      const es = effectiveStatus(iv)
                      const sm = STATUS_META[es]
                      return (
                        <div key={iv.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0 5px 14px', borderLeft: `2px solid ${tc.b}` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
                              {iv.company}
                              <span style={{ fontSize: 10, fontWeight: 400, color: sm.dot, marginLeft: 6 }}>{sm.label}</span>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
                              {iv.task_number ? `[${iv.task_number}] ` : ''}{iv.task}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BriefingsScreen({ interventions, zones, trades, companies }: Props) {
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>([0])
  const [copied, setCopied]               = useState<string | null>(null)
  const [sentStatus, setSentStatus]       = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('planify_briefings_sent') ?? '{}') } catch { return {} }
  })
  const [recapOpen, setRecapOpen]         = useState(false)
  const [extContacts, setExtContacts]     = useState<ExternalContact[]>([])

  useEffect(() => {
    supabase.from('external_contacts').select('*').order('created_at').then(({ data }) => {
      if (data) setExtContacts(data as ExternalContact[])
    })
  }, [])

  const allWeeks = [getWeekRange(0), getWeekRange(1), getWeekRange(2)]
  const activeWeeks = allWeeks.filter((_, i) => selectedWeeks.includes(i))
  const effectiveWeeks = activeWeeks.length ? activeWeeks : [allWeeks[0]]
  const weekNames = ['Sem. en cours', 'S+1', 'S+2']

  function overlapsWeeks(iv: Intervention): boolean {
    const s = iv.start_date ?? '', e = iv.end_date ?? s
    return effectiveWeeks.some(w => s <= w.end && e >= w.start)
  }

  function sentKey(cardId: string): string {
    return `${cardId}_${effectiveWeeks[0]?.start}`
  }

  function markSent(cardId: string) {
    const k = sentKey(cardId)
    const now = new Date()
    const label = now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
      + ' à ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    const next = { ...sentStatus, [k]: label }
    setSentStatus(next)
    try { localStorage.setItem('planify_briefings_sent', JSON.stringify(next)) } catch {}
  }

  function copyText(text: string, id: string) {
    const finish = () => {
      setCopied(id); markSent(id)
      setTimeout(() => setCopied(null), 2400)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(finish).catch(() => legacyCopy(text, finish))
    } else {
      legacyCopy(text, finish)
    }
  }

  function legacyCopy(text: string, cb: () => void) {
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select()
    document.execCommand('copy'); document.body.removeChild(ta); cb()
  }

  // Build company cards
  const cards: { company: Company; contact: { name: string; phone: string; email: string }; cardId: string; ivs: Intervention[] }[] = []
  companies.forEach(co => {
    const ivs = interventions.filter(iv => iv.company === co.name && iv.status !== 'termine' && overlapsWeeks(iv))
    if (!ivs.length) return
    const allContacts: { name: string; phone: string; email: string }[] = []
    if (co.contact || co.phone) allContacts.push({ name: co.contact ?? '', phone: co.phone ?? '', email: co.email ?? '' })
    ;(co.contacts ?? []).forEach(c => { if (c.name || c.phone) allContacts.push(c) })
    if (!allContacts.length) allContacts.push({ name: '', phone: '', email: '' })
    allContacts.forEach((ct, ci) => {
      cards.push({ company: co, contact: ct, cardId: `${co.id}_c${ci}`, ivs })
    })
  })

  const totalSent  = cards.filter(x => !!sentStatus[sentKey(x.cardId)]).length
  const cntTermine = interventions.filter(iv => iv.status === 'termine').length
  const cntEncours = interventions.filter(iv => effectiveStatus(iv) === 'encours').length
  const cntBloque  = interventions.filter(iv => effectiveStatus(iv) === 'bloque').length
  const cntRetard  = interventions.filter(iv => effectiveStatus(iv) === 'en_retard').length
  const cntTotal   = interventions.length

  const recapMsg = generateRecap(interventions, zones, effectiveWeeks)

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingBottom: 80 }}>

      {/* ── Situation à date ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', margin: '14px 14px 0', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 16, borderRadius: 2, background: '#2563EB', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>Situation à date</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", marginTop: 1 }}>{cntTotal} interventions totales</div>
          </div>
        </div>
        <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            { label: 'Terminées', value: cntTermine, color: STATUS_META.termine.dot },
            { label: 'En cours',  value: cntEncours, color: STATUS_META.encours.dot },
            { label: 'En retard', value: cntRetard,  color: STATUS_META.en_retard.dot },
            { label: 'Bloquées',  value: cntBloque,  color: STATUS_META.bloque.dot },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: '8px 4px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        {cntBloque > 0 && (
          <div style={{ margin: '0 14px 12px', padding: '8px 12px', background: 'var(--danger-l)', border: '1px solid var(--danger)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
            ⛔ {cntBloque} tâche{cntBloque > 1 ? 's' : ''} bloquée{cntBloque > 1 ? 's' : ''} — action requise
          </div>
        )}
      </div>

      {/* ── Week selector ── */}
      <div style={{ margin: '14px 14px 0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '12px 14px', boxShadow: 'var(--shadow)' }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Semaines à inclure dans les briefings</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map(i => {
            const w = allWeeks[i]
            const active = selectedWeeks.includes(i)
            return (
              <button key={i} onClick={() => setSelectedWeeks(prev => {
                if (prev.includes(i)) return prev.filter(x => x !== i).length ? prev.filter(x => x !== i) : [i]
                return [...prev, i].sort()
              })} style={{
                flex: 1, padding: '8px 4px', borderRadius: 'var(--r-sm)', cursor: 'pointer', textAlign: 'center',
                border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                background: active ? 'var(--primary-l)' : 'var(--surface-2)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: active ? 'var(--primary)' : 'var(--text)' }}>{weekNames[i]}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", marginTop: 2 }}>
                  {fmtShort(w.start)} — {fmtShort(w.end)}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Weekly plan grid ── */}
      <WeeklyPlanGrid
        interventions={interventions}
        zones={zones}
        trades={trades}
        companies={companies}
        activeWeeks={effectiveWeeks}
      />

      {/* ── Recap block ── */}
      <div style={{ margin: '14px 14px 0' }}>
        <button onClick={() => setRecapOpen(o => !o)} style={{
          width: '100%', padding: '10px 14px', borderRadius: 'var(--r)', cursor: 'pointer', textAlign: 'left',
          border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>📋 Récap chantier complet</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{recapOpen ? '▲' : '▼'}</span>
        </button>
        {recapOpen && (
          <div style={{ marginTop: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => copyText(recapMsg, 'recap')} style={btnStyle(copied === 'recap')}>
                {copied === 'recap' ? '✓ Copié' : '⎘ Copier'}
              </button>
              {extContacts.map(ct => {
                const link = ct.phone ? waUrl(ct.phone, recapMsg) : null
                if (!link) return null
                return (
                  <a key={ct.id} href={link} target="_blank" rel="noreferrer" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px',
                    borderRadius: 'var(--r-xs)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    background: '#25D366', color: '#fff', textDecoration: 'none',
                  }}>
                    WhatsApp · {ct.name}{ct.role ? ` (${ct.role})` : ''}
                  </a>
                )
              })}
            </div>
            <pre style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: '14px 16px', overflowY: 'auto', maxHeight: 400 }}>
              {recapMsg}
            </pre>
          </div>
        )}
      </div>

      {/* ── Company cards ── */}
      <div style={{ padding: '14px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Entreprises actives ({cards.length})
        </div>
        {totalSent > 0 && (
          <span style={{ fontSize: 11, color: STATUS_META.termine.dot, fontWeight: 600 }}>
            ✓ {totalSent}/{cards.length} envoyés
          </span>
        )}
      </div>

      {cards.length === 0 ? (
        <div style={{ margin: '24px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Aucune intervention active sur la période sélectionnée.
        </div>
      ) : (
        cards.map(({ company: co, contact, cardId, ivs }) => (
          <CompanyCard
            key={cardId}
            co={co} contact={contact} cardId={cardId} ivs={ivs}
            zones={zones} trades={trades} companies={companies}
            activeWeeks={effectiveWeeks}
            isCopied={copied === cardId}
            sentAt={sentStatus[sentKey(cardId)] ?? null}
            onCopy={(text) => copyText(text, cardId)}
            onMarkSent={() => markSent(cardId)}
          />
        ))
      )}
    </div>
  )
}

// ─── Company card ─────────────────────────────────────────────────────────────

function CompanyCard({ co, contact, cardId, ivs, zones, trades, companies, activeWeeks, isCopied, sentAt, onCopy, onMarkSent }: {
  co: Company; contact: { name: string; phone: string; email: string }
  cardId: string; ivs: Intervention[]; zones: Zone[]; trades: Trade[]; companies: Company[]
  activeWeeks: { start: string; end: string }[]
  isCopied: boolean; sentAt: string | null
  onCopy: (text: string) => void
  onMarkSent: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [msgOpen, setMsgOpen]   = useState(false)

  const trade   = trades.find(t => t.id === primaryTradeId(co))
  const tc      = getTradeColor(trade?.color ?? 'blue')
  const blocked = ivs.filter(iv => effectiveStatus(iv) === 'bloque').length
  const late    = ivs.filter(iv => effectiveStatus(iv) === 'en_retard').length
  const firstN  = (contact.name || '').split(' ')[0] || co.name
  const msg     = generateMessage(firstN, co, ivs, zones, activeWeeks)
  const waLink  = contact.phone ? waUrl(contact.phone, msg) : null

  const allDays = activeWeeks.flatMap(w => getWeekDays(w))

  return (
    <div style={{ margin: '10px 14px 0', background: 'var(--surface)', border: `1px solid ${blocked > 0 ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: expanded ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
        <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: tc.b, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{co.name}</span>
            {blocked > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-l)', padding: '1px 6px', borderRadius: 999 }}>⛔ {blocked} bloquée{blocked > 1 ? 's' : ''}</span>}
            {late > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#EA580C', background: '#FFF7ED', padding: '1px 6px', borderRadius: 999 }}>⏱ {late} retard{late > 1 ? 's' : ''}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'DM Mono', monospace" }}>
            {contact.name || '—'}{contact.phone ? ` · ${contact.phone}` : ''} · {ivs.length} tâche{ivs.length > 1 ? 's' : ''}
          </div>
        </div>
        <span style={{ fontSize: 14, color: 'var(--muted)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <>
          {/* Day strip */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${allDays.length}, 1fr)`, borderBottom: '1px solid var(--border)' }}>
            {allDays.map(ds => {
              const dayIvs = getDayIvs(ivs, ds)
              const d = new Date(ds + 'T00:00:00')
              const isToday = ds === localDateStr(new Date())
              const active = dayIvs.length > 0
              const zoneNames = [...new Set(dayIvs.map(iv => zones.find(z => z.id === iv.zone)?.short ?? '?'))]
              return (
                <div key={ds} style={{
                  padding: '6px 4px', textAlign: 'center',
                  borderLeft: '1px solid var(--border)',
                  background: active ? tc.bg : 'var(--surface-2)',
                }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--muted)', textTransform: 'uppercase' }}>{FR_DAYS3[d.getDay()]}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: active ? tc.b : 'var(--border)', lineHeight: 1.2 }}>{d.getDate()}</div>
                  {active && (
                    <div style={{ fontSize: 8, color: tc.b, marginTop: 2, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {zoneNames.slice(0, 2).join(', ')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Task list */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            {ivs.map(iv => {
              const es = effectiveStatus(iv)
              const sm = STATUS_META[es]
              const zn = zones.find(z => z.id === iv.zone)
              return (
                <div key={iv.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: sm.dot, flexShrink: 0, marginTop: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{iv.task}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                      {zn?.short} · {fmtDate(iv.start_date)}{iv.end_date && iv.end_date !== iv.start_date ? ` → ${fmtDate(iv.end_date)}` : ''} · <span style={{ color: sm.dot }}>{sm.label}</span>
                    </div>
                    {iv.prereq?.trim() && (
                      <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2 }}>⚠ Prérequis : {iv.prereq}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Message toggle */}
          <div style={{ borderBottom: msgOpen ? '1px solid var(--border)' : 'none' }}>
            <button onClick={() => setMsgOpen(o => !o)} style={{
              width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Message WhatsApp</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msgOpen ? '▲' : '▼'}</span>
            </button>
          </div>

          {msgOpen && (
            <div style={{ padding: '0 12px 10px' }}>
              <pre style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-xs)', padding: '10px 12px', maxHeight: 260, overflowY: 'auto' }}>
                {msg}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div style={{ padding: '10px 12px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => onCopy(msg)} style={btnStyle(isCopied)}>
              {isCopied ? '✓ Copié !' : '⎘ Copier'}
            </button>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" onClick={onMarkSent} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                borderRadius: 'var(--r-xs)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: '#25D366', color: '#fff', border: 'none', textDecoration: 'none',
              }}>
                WhatsApp
              </a>
            )}
            {sentAt && (
              <span style={{ fontSize: 10, color: STATUS_META.termine.dot, fontWeight: 600, background: STATUS_META.termine.bg, padding: '3px 8px', borderRadius: 999, border: `1px solid ${STATUS_META.termine.dot}30` }}>
                ✓ Envoyé {sentAt}
              </span>
            )}
            {!contact.phone && (
              <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>Aucun numéro enregistré</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Recap message generator ──────────────────────────────────────────────────

function generateRecap(interventions: Intervention[], zones: Zone[], activeWeeks: { start: string; end: string }[]): string {
  const getZoneName = (zoneId: string) => {
    const z = zones.find(z => z.id === zoneId)
    return z ? `${z.floor ? z.floor + ' / ' : ''}${z.name}` : zoneId
  }

  const lines: string[] = []
  lines.push('*Planify — HSF Av. Marceau*')

  if (activeWeeks.length > 1) {
    lines.push(`Récap chantier — ${activeWeeks.length} semaines`)
    lines.push(`Du lundi ${fmtShort(activeWeeks[0].start)} au vendredi ${fmtShort(activeWeeks[activeWeeks.length - 1].end)}`)
  } else {
    const w = activeWeeks[0]
    lines.push('Récap chantier')
    lines.push(`Semaine du ${fmtShort(w.start)} au ${fmtShort(w.end)}`)
  }

  let ivCount = 0, coSet = new Set<string>()

  activeWeeks.forEach((w, wi) => {
    if (activeWeeks.length > 1) {
      lines.push(``)
      lines.push(`*Semaine ${wi + 1} — lundi ${fmtShort(w.start)} au vendredi ${fmtShort(w.end)}*`)
    }

    getWeekDays(w).forEach(ds => {
      const dayIvs = getDayIvs(interventions, ds)
      if (!dayIvs.length) return

      dayIvs.forEach(iv => { ivCount++; if (iv.company) coSet.add(iv.company) })
      const d = new Date(ds + 'T00:00:00')
      lines.push(``)
      lines.push(`📅 *${FR_DAYS[d.getDay()]} ${d.getDate()} ${FR_MNTHS[d.getMonth()]}*`)

      const byZone: Record<string, Intervention[]> = {}
      dayIvs.forEach(iv => {
        const zn = getZoneName(iv.zone)
        if (!byZone[zn]) byZone[zn] = []
        byZone[zn].push(iv)
      })
      Object.entries(byZone).sort(([a], [b]) => a.localeCompare(b)).forEach(([zn, zivs]) => {
        lines.push(`  📍 ${zn}`)
        zivs.forEach(iv => {
          const num = iv.task_number ? `[${iv.task_number}] ` : ''
          lines.push(`    • ${iv.company} — ${num}${iv.task}`)
        })
      })
    })
  })

  lines.push(``)
  if (ivCount === 0) {
    lines.push(`Aucune intervention planifiée.`)
  } else {
    lines.push(`${coSet.size} entreprise${coSet.size > 1 ? 's' : ''} · ${ivCount} intervention${ivCount > 1 ? 's' : ''}`)
  }
  return lines.join('\n')
}

// ─── Shared styles ────────────────────────────────────────────────────────────

function btnStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px',
    borderRadius: 'var(--r-xs)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--success, #16A34A)' : 'var(--border)'}`,
    background: active ? '#F0FDF4' : 'var(--surface-2)',
    color: active ? '#16A34A' : 'var(--text)',
    transition: 'all .12s',
  }
}
