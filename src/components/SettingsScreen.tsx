'use client'

import { useEffect, useState } from 'react'
import type { Zone, Trade, Company, ExternalContact } from '@/types/database'
import { getZoneFloorColor, getTradeColor, TRADE_COLORS, type TradeColorKey } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { companyTradeIds, primaryTradeId } from '@/lib/company'

interface Props {
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
  onZonesChange: (zones: Zone[]) => void
  onTradesChange: (trades: Trade[]) => void
  onCompaniesChange: (companies: Company[]) => void
}

type Tab = 'zones' | 'trades' | 'companies' | 'contacts'

const FR_MNTHS = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.']

function fmtDeadline(ds: string | null): string {
  if (!ds) return '—'
  const d = new Date(ds + 'T00:00:00')
  return `${d.getDate()} ${FR_MNTHS[d.getMonth()]} ${d.getFullYear()}`
}

function daysUntil(ds: string | null): number | null {
  if (!ds) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(ds + 'T00:00:00')
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

function deadlineColor(days: number | null): string {
  if (days === null) return 'var(--muted)'
  if (days < 0)  return '#DC2626'
  if (days < 14) return '#EA580C'
  if (days < 30) return '#D97706'
  return '#16A34A'
}

const modalLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5, display: 'block',
}

const modalInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--surface-2)', color: 'var(--text)', padding: '8px 10px', fontSize: 13,
  fontFamily: "'DM Sans', sans-serif",
}

export default function SettingsScreen({ zones, trades, companies, onZonesChange, onTradesChange, onCompaniesChange }: Props) {
  const [tab, setTab] = useState<Tab>('zones')

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 14px 100px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Configuration</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {(['zones', 'trades', 'companies', 'contacts'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '9px 4px', background: 'transparent', border: 'none', fontSize: 10, fontWeight: 600,
            cursor: 'pointer', color: tab === t ? 'var(--primary)' : 'var(--muted)',
            fontFamily: "'DM Sans', sans-serif",
            borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent', marginBottom: -1,
          }}>
            {t === 'zones' ? 'Zones' : t === 'trades' ? 'Corps' : t === 'companies' ? 'Entreprises' : 'Contacts ext.'}
          </button>
        ))}
      </div>

      {tab === 'zones'     && <ZonesTab zones={zones} onZonesChange={onZonesChange} />}
      {tab === 'trades'    && <TradesTab trades={trades} onTradesChange={onTradesChange} />}
      {tab === 'companies' && <CompaniesTab companies={companies} trades={trades} onCompaniesChange={onCompaniesChange} />}
      {tab === 'contacts'  && <ExternalContactsTab />}
    </div>
  )
}

// ─── Zones tab ────────────────────────────────────────────────────────────────

function ZonesTab({ zones, onZonesChange }: { zones: Zone[]; onZonesChange: (z: Zone[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [draft, setDraft]         = useState<string>('')
  const [showAdd, setShowAdd]     = useState(false)

  function startEdit(zone: Zone) {
    setEditingId(zone.id)
    setDraft(zone.deadline ?? '')
  }

  async function saveDeadline(zone: Zone) {
    setSaving(true)
    const newDeadline = draft || null
    const { error } = await supabase.from('zones').update({ deadline: newDeadline }).eq('id', zone.id)
    setSaving(false)
    if (!error) {
      onZonesChange(zones.map(z => z.id === zone.id ? { ...z, deadline: newDeadline } : z))
    }
    setEditingId(null)
  }

  // Group by floor
  const floors = [...new Set(zones.map(z => z.floor).filter(Boolean))].sort()

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {floors.map(floor => {
          const floorZones = zones.filter(z => z.floor === floor)
          const fc = getZoneFloorColor(zones, floor)
          return (
            <div key={floor} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', background: fc + '14', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: fc, display: 'inline-block' }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: fc, textTransform: 'uppercase', letterSpacing: '.04em' }}>{floor}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{floorZones.length} zone{floorZones.length > 1 ? 's' : ''}</span>
              </div>
              {floorZones.map(zone => {
                const days = daysUntil(zone.deadline)
                const dc   = deadlineColor(days)
                const isEditing = editingId === zone.id
                return (
                  <div key={zone.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{zone.name}</div>
                      <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: 'var(--muted)', marginTop: 1 }}>{zone.short}</div>
                    </div>
                    {isEditing ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="date"
                          value={draft}
                          onChange={e => setDraft(e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, fontFamily: "'DM Mono', monospace" }}
                          autoFocus
                        />
                        <button onClick={() => saveDeadline(zone)} disabled={saving} style={smallBtnStyle('primary')}>
                          {saving ? '…' : '✓'}
                        </button>
                        <button onClick={() => setEditingId(null)} style={smallBtnStyle('neutral')}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: dc }}>
                            {zone.deadline
                              ? (days !== null && days < 0 ? `${Math.abs(days)}j dépassé` : days === 0 ? "Auj." : `J-${days}`)
                              : '—'}
                          </div>
                          {zone.deadline && (
                            <div style={{ fontSize: 10, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace" }}>
                              {fmtDeadline(zone.deadline)}
                            </div>
                          )}
                        </div>
                        <button onClick={() => startEdit(zone)} style={smallBtnStyle('neutral')} title="Modifier la deadline">
                          ✎
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        <button onClick={() => setShowAdd(true)} style={addBtnStyle}>+ Ajouter une zone</button>
      </div>

      {showAdd && (
        <AddZoneModal
          zones={zones}
          onClose={() => setShowAdd(false)}
          onCreated={newZone => { onZonesChange([...zones, newZone]); setShowAdd(false) }}
        />
      )}
    </>
  )
}

function AddZoneModal({ zones, onClose, onCreated }: {
  zones: Zone[]
  onClose: () => void
  onCreated: (zone: Zone) => void
}) {
  const [name, setName]   = useState('')
  const [short, setShort] = useState('')
  const [floor, setFloor] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const floors = [...new Set(zones.map(z => z.floor).filter(Boolean))].sort()

  async function handleSubmit() {
    if (!name.trim() || !short.trim() || !floor) { setError('Tous les champs sont requis'); return }
    setSaving(true)
    setError(null)
    const floor_color = zones.find(z => z.floor === floor)?.floor_color ?? '#9CA3AF'
    const { data, error: err } = await supabase
      .from('zones')
      .insert([{ name: name.trim(), short: short.trim(), floor, floor_color, deadline: null, display_order: zones.length + 1 }])
      .select()
      .single()
    setSaving(false)
    if (err || !data) { setError(err?.message ?? 'Erreur'); return }
    onCreated(data as Zone)
  }

  return (
    <BottomModal title="Nouvelle zone" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={modalLabelStyle}>Nom</label>
          <input style={modalInputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="ex. Zone sanitaire R3" autoFocus />
        </div>
        <div>
          <label style={modalLabelStyle}>Abréviation / Short</label>
          <input style={modalInputStyle} value={short} onChange={e => setShort(e.target.value.slice(0, 10))} placeholder="ex. R3-SANI" maxLength={10} />
        </div>
        <div>
          <label style={modalLabelStyle}>Étage</label>
          <select style={modalInputStyle} value={floor} onChange={e => setFloor(e.target.value)}>
            <option value="">— Choisir un étage —</option>
            {floors.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        {error && <div style={{ fontSize: 12, color: '#DC2626' }}>{error}</div>}
        <button onClick={handleSubmit} disabled={saving} style={submitBtnStyle}>{saving ? 'Enregistrement…' : 'Ajouter la zone'}</button>
      </div>
    </BottomModal>
  )
}

// ─── Trades tab ───────────────────────────────────────────────────────────────

const TRADE_COLOR_KEYS = Object.keys(TRADE_COLORS) as TradeColorKey[]

function TradesTab({ trades, onTradesChange }: { trades: Trade[]; onTradesChange: (t: Trade[]) => void }) {
  const [showAdd, setShowAdd]       = useState(false)
  const [editTrade, setEditTrade]   = useState<Trade | null>(null)

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {trades.map(trade => {
          const tc = getTradeColor(trade.color)
          return (
            <div key={trade.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 14px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: tc.bg, border: `2px solid ${tc.b}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: tc.b, display: 'inline-block' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{trade.name}</div>
                <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: 'var(--muted)', marginTop: 1 }}>{trade.short}</div>
              </div>
              <span style={{ fontSize: 10, color: tc.t, background: tc.bg, padding: '2px 8px', borderRadius: 999, fontWeight: 600, border: `1px solid ${tc.b}30` }}>
                {trade.color}
              </span>
              <button onClick={() => setEditTrade(trade)} style={smallBtnStyle('neutral')} title="Modifier">✎</button>
            </div>
          )
        })}

        <button onClick={() => setShowAdd(true)} style={addBtnStyle}>+ Ajouter un corps de métier</button>
      </div>

      {showAdd && (
        <TradeModal
          initial={null}
          onClose={() => setShowAdd(false)}
          onSaved={newTrade => { onTradesChange([...trades, newTrade]); setShowAdd(false) }}
        />
      )}
      {editTrade && (
        <TradeModal
          initial={editTrade}
          onClose={() => setEditTrade(null)}
          onSaved={updated => { onTradesChange(trades.map(t => t.id === updated.id ? updated : t)); setEditTrade(null) }}
        />
      )}
    </>
  )
}

function TradeModal({ initial, onClose, onSaved }: {
  initial: Trade | null
  onClose: () => void
  onSaved: (trade: Trade) => void
}) {
  const [name, setName]     = useState(initial?.name ?? '')
  const [short, setShort]   = useState(initial?.short ?? '')
  const [color, setColor]   = useState<TradeColorKey>((initial?.color as TradeColorKey) ?? 'blue')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim() || !short.trim()) { setError('Nom et abréviation requis'); return }
    setSaving(true); setError(null)
    if (initial) {
      const { error: err } = await supabase.from('trades').update({ name: name.trim(), short: short.trim(), color }).eq('id', initial.id)
      setSaving(false)
      if (err) { setError(err.message); return }
      onSaved({ ...initial, name: name.trim(), short: short.trim(), color })
    } else {
      const { data, error: err } = await supabase
        .from('trades')
        .insert([{ name: name.trim(), short: short.trim(), color, display_order: 999 }])
        .select().single()
      setSaving(false)
      if (err || !data) { setError(err?.message ?? 'Erreur'); return }
      onSaved(data as Trade)
    }
  }

  return (
    <BottomModal title={initial ? 'Modifier le corps de métier' : 'Nouveau corps de métier'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={modalLabelStyle}>Nom</label>
          <input style={modalInputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="ex. Plomberie" autoFocus />
        </div>
        <div>
          <label style={modalLabelStyle}>Abréviation</label>
          <input style={modalInputStyle} value={short} onChange={e => setShort(e.target.value)} placeholder="ex. PLO" />
        </div>
        <div>
          <label style={modalLabelStyle}>Couleur</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {TRADE_COLOR_KEYS.map(k => {
              const tc = TRADE_COLORS[k]
              return (
                <button key={k} onClick={() => setColor(k)} title={k} style={{
                  width: 28, height: 28, borderRadius: '50%', background: tc.b, border: 'none', cursor: 'pointer',
                  outline: color === k ? `3px solid ${tc.b}` : '3px solid transparent',
                  outlineOffset: 2,
                }} />
              )
            })}
          </div>
        </div>
        {error && <div style={{ fontSize: 12, color: '#DC2626' }}>{error}</div>}
        <button onClick={handleSubmit} disabled={saving} style={submitBtnStyle}>{saving ? 'Enregistrement…' : (initial ? 'Enregistrer' : 'Ajouter')}</button>
      </div>
    </BottomModal>
  )
}

// ─── Companies tab ────────────────────────────────────────────────────────────

function CompaniesTab({ companies, trades, onCompaniesChange }: { companies: Company[]; trades: Trade[]; onCompaniesChange: (c: Company[]) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAdd, setShowAdd]       = useState(false)
  const [editCo, setEditCo]         = useState<Company | null>(null)

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {companies.map(co => {
          const coTradeIds = companyTradeIds(co)
          const coTrades   = coTradeIds.map(id => trades.find(t => t.id === id)).filter(Boolean) as Trade[]
          const primary    = coTrades[0]
          const tc         = getTradeColor(primary?.color ?? 'blue')
          const isExp      = expandedId === co.id
          const allContacts: { name: string; phone: string; email: string }[] = []
          if (co.contact || co.phone) allContacts.push({ name: co.contact ?? '', phone: co.phone ?? '', email: co.email ?? '' })
          ;(co.contacts ?? []).forEach(c => { if (c.name || c.phone) allContacts.push(c) })

          return (
            <div key={co.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: tc.b, flexShrink: 0 }} />
                <div onClick={() => setExpandedId(isExp ? null : co.id)} style={{ flex: 1, cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{co.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                    {coTrades.length ? coTrades.map(t => t.short).join(' · ') : '—'}{co.phone ? ` · ${co.phone}` : ''}
                  </div>
                </div>
                <button onClick={() => setEditCo(co)} style={smallBtnStyle('neutral')} title="Modifier">✎</button>
                <span onClick={() => setExpandedId(isExp ? null : co.id)} style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>{isExp ? '▲' : '▼'}</span>
              </div>

              {isExp && (
                <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '10px 0 6px' }}>Contacts</div>
                  {allContacts.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Aucun contact enregistré</div>
                  ) : (
                    allContacts.map((ct, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < allContacts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{ct.name || '—'}</div>
                          {ct.email && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{ct.email}</div>}
                        </div>
                        {ct.phone && (
                          <a href={`tel:${ct.phone}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', fontFamily: "'DM Mono', monospace" }}>
                            {ct.phone}
                          </a>
                        )}
                      </div>
                    ))
                  )}
                  {coTrades.length > 0 && (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '10px 0 6px' }}>Corps de métier</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {coTrades.map(t => {
                          const ttc = getTradeColor(t.color)
                          return (
                            <span key={t.id} style={{ fontSize: 11, color: ttc.t, background: ttc.bg, padding: '2px 10px', borderRadius: 999, fontWeight: 600, border: `1px solid ${ttc.b}30` }}>
                              {t.name}
                            </span>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <button onClick={() => setShowAdd(true)} style={addBtnStyle}>+ Ajouter une entreprise</button>
      </div>

      {showAdd && (
        <CompanyModal
          initial={null}
          trades={trades}
          onClose={() => setShowAdd(false)}
          onSaved={newCo => { onCompaniesChange([...companies, newCo]); setShowAdd(false) }}
        />
      )}
      {editCo && (
        <CompanyModal
          initial={editCo}
          trades={trades}
          onClose={() => setEditCo(null)}
          onSaved={updated => { onCompaniesChange(companies.map(c => c.id === updated.id ? updated : c)); setEditCo(null) }}
        />
      )}
    </>
  )
}

function TradeMultiPick({ trades, selected, onChange }: {
  trades: Trade[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }
  const selectedTrades = selected.map(id => trades.find(t => t.id === id)).filter(Boolean) as Trade[]
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => setOpen(o => !o)} style={{ ...modalInputStyle, minHeight: 36, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', cursor: 'pointer', padding: '5px 8px' }}>
        {selectedTrades.length === 0 && <span style={{ color: 'var(--xmuted)', fontSize: 12 }}>— Sélectionner un ou plusieurs corps de métier —</span>}
        {selectedTrades.map(t => {
          const tc = getTradeColor(t.color)
          return (
            <span key={t.id} style={{ padding: '2px 6px 2px 8px', borderRadius: 999, background: tc.bg, color: tc.t, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {t.name}
              <button onClick={e => { e.stopPropagation(); toggle(t.id) }} style={{ border: 'none', background: 'transparent', color: tc.t, cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
            </span>
          )
        })}
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-md)', zIndex: 201, maxHeight: 240, overflowY: 'auto', padding: 4 }}>
            {trades.map(t => {
              const isSel = selected.includes(t.id)
              return (
                <div key={t.id} onClick={() => toggle(t.id)} style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, background: isSel ? 'var(--primary-l)' : 'transparent', color: isSel ? 'var(--primary)' : 'var(--text)', fontWeight: isSel ? 700 : 500 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`, background: isSel ? 'var(--primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isSel && <span style={{ color: '#fff', fontSize: 9 }}>✓</span>}
                  </span>
                  {t.name} <span style={{ fontSize: 10, color: 'var(--muted)' }}>({t.short})</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function CompanyModal({ initial, trades, onClose, onSaved }: {
  initial: Company | null
  trades: Trade[]
  onClose: () => void
  onSaved: (co: Company) => void
}) {
  const [name, setName]         = useState(initial?.name ?? '')
  const [tradeIds, setTradeIds] = useState<string[]>(companyTradeIds(initial))
  const [contacts, setContacts] = useState<{ name: string; phone: string; email: string }[]>(() => {
    const merged: { name: string; phone: string; email: string }[] = []
    if (initial?.contact || initial?.phone || initial?.email) {
      merged.push({ name: initial.contact ?? '', phone: initial.phone ?? '', email: initial.email ?? '' })
    }
    for (const c of initial?.contacts ?? []) {
      if (c.name || c.phone || c.email) merged.push({ name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '' })
    }
    return merged.length > 0 ? merged : [{ name: '', phone: '', email: '' }]
  })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function updateContact(i: number, patch: Partial<{ name: string; phone: string; email: string }>) {
    setContacts(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  }
  function removeContact(i: number) { setContacts(prev => prev.filter((_, idx) => idx !== i)) }
  function addContact() { setContacts(prev => [...prev, { name: '', phone: '', email: '' }]) }

  async function handleSubmit() {
    if (!name.trim()) { setError('Le nom est requis'); return }
    setSaving(true); setError(null)
    const cleaned = contacts
      .map(c => ({ name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() }))
      .filter(c => c.name || c.phone || c.email)
    const first = cleaned[0] ?? { name: '', phone: '', email: '' }
    const payload = {
      name: name.trim(),
      trade_ids: tradeIds,
      trade_id: tradeIds[0] ?? null,
      contact: first.name || null,
      phone:   first.phone || null,
      email:   first.email || null,
      contacts: cleaned.slice(1),
    }
    if (initial) {
      const { error: err } = await supabase.from('companies').update(payload).eq('id', initial.id)
      setSaving(false)
      if (err) { setError(err.message); return }
      onSaved({ ...initial, ...payload })
    } else {
      const { data, error: err } = await supabase
        .from('companies')
        .insert([{ ...payload, active: true, display_order: 999 }])
        .select().single()
      setSaving(false)
      if (err || !data) { setError(err?.message ?? 'Erreur'); return }
      onSaved(data as Company)
    }
  }

  return (
    <BottomModal title={initial ? 'Modifier l\'entreprise' : 'Nouvelle entreprise'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={modalLabelStyle}>Nom</label>
          <input style={modalInputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="ex. Plomberie Dupont" autoFocus />
        </div>
        <div>
          <label style={modalLabelStyle}>Corps de métier</label>
          <TradeMultiPick trades={trades} selected={tradeIds} onChange={setTradeIds} />
        </div>
        <div>
          <label style={modalLabelStyle}>Contacts</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {contacts.map((c, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Contact {i + 1}{i === 0 ? ' · principal' : ''}
                  </span>
                  <button onClick={() => removeContact(i)} disabled={contacts.length === 1} title="Supprimer" style={{
                    marginLeft: 'auto', width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--surface)', color: contacts.length === 1 ? 'var(--border)' : '#DC2626',
                    cursor: contacts.length === 1 ? 'not-allowed' : 'pointer', fontSize: 13, lineHeight: 1, padding: 0,
                  }}>×</button>
                </div>
                <input style={modalInputStyle} value={c.name} onChange={e => updateContact(i, { name: e.target.value })} placeholder="Nom (ex. Jean Dupont)" />
                <input style={modalInputStyle} value={c.phone} onChange={e => updateContact(i, { phone: e.target.value })} placeholder="Téléphone (ex. 06 12 34 56 78)" type="tel" />
                <input style={modalInputStyle} value={c.email} onChange={e => updateContact(i, { email: e.target.value })} placeholder="Email (ex. jean@dupont.fr)" type="email" />
              </div>
            ))}
            <button onClick={addContact} style={{
              padding: '8px 12px', borderRadius: 8, border: '1px dashed var(--border)',
              background: 'transparent', color: 'var(--primary)', cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
            }}>+ Ajouter un contact</button>
          </div>
        </div>
        {error && <div style={{ fontSize: 12, color: '#DC2626' }}>{error}</div>}
        <button onClick={handleSubmit} disabled={saving} style={submitBtnStyle}>{saving ? 'Enregistrement…' : (initial ? 'Enregistrer' : 'Ajouter')}</button>
      </div>
    </BottomModal>
  )
}

// ─── External contacts tab ────────────────────────────────────────────────────

function ExternalContactsTab() {
  const [contacts, setContacts] = useState<ExternalContact[]>([])
  const [showAdd, setShowAdd]   = useState(false)
  const [editCt, setEditCt]     = useState<ExternalContact | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('external_contacts').select('*').order('created_at').then(({ data }) => {
      if (data) setContacts(data as ExternalContact[])
    })
  }, [])

  async function handleDelete(id: string) {
    setDeleting(id)
    await supabase.from('external_contacts').delete().eq('id', id)
    setContacts(prev => prev.filter(c => c.id !== id))
    setDeleting(null)
  }

  return (
    <>
      <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        Contacts externes (AMO, MOE…) qui reçoivent le récap chantier complet par WhatsApp.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {contacts.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>Aucun contact externe</div>
        )}
        {contacts.map(ct => (
          <div key={ct.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 14px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{ct.name}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                {ct.role ? `${ct.role} · ` : ''}{ct.phone ?? 'Aucun numéro'}
              </div>
            </div>
            <button onClick={() => setEditCt(ct)} style={smallBtnStyle('neutral')} title="Modifier">✎</button>
            <button onClick={() => handleDelete(ct.id)} disabled={deleting === ct.id} style={{ ...smallBtnStyle('neutral'), color: '#DC2626', borderColor: '#FECACA' }} title="Supprimer">
              {deleting === ct.id ? '…' : '✕'}
            </button>
          </div>
        ))}
        <button onClick={() => setShowAdd(true)} style={addBtnStyle}>+ Ajouter un contact externe</button>
      </div>

      {(showAdd || editCt) && (
        <ExternalContactModal
          initial={editCt}
          onClose={() => { setShowAdd(false); setEditCt(null) }}
          onSaved={saved => {
            if (editCt) setContacts(prev => prev.map(c => c.id === saved.id ? saved : c))
            else setContacts(prev => [...prev, saved])
            setShowAdd(false); setEditCt(null)
          }}
        />
      )}
    </>
  )
}

function ExternalContactModal({ initial, onClose, onSaved }: {
  initial: ExternalContact | null
  onClose: () => void
  onSaved: (ct: ExternalContact) => void
}) {
  const [name, setName]     = useState(initial?.name ?? '')
  const [role, setRole]     = useState(initial?.role ?? '')
  const [phone, setPhone]   = useState(initial?.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim()) { setError('Le nom est requis'); return }
    setSaving(true); setError(null)
    const payload = { name: name.trim(), role: role.trim() || null, phone: phone.trim() || null }
    if (initial) {
      const { error: err } = await supabase.from('external_contacts').update(payload).eq('id', initial.id)
      setSaving(false)
      if (err) { setError(err.message); return }
      onSaved({ ...initial, ...payload })
    } else {
      const { data, error: err } = await supabase.from('external_contacts').insert([payload]).select().single()
      setSaving(false)
      if (err || !data) { setError(err?.message ?? 'Erreur'); return }
      onSaved(data as ExternalContact)
    }
  }

  return (
    <BottomModal title={initial ? 'Modifier le contact' : 'Nouveau contact externe'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={modalLabelStyle}>Nom</label>
          <input style={modalInputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="ex. Marie Durand" autoFocus />
        </div>
        <div>
          <label style={modalLabelStyle}>Rôle</label>
          <input style={modalInputStyle} value={role} onChange={e => setRole(e.target.value)} placeholder="ex. AMO, MOE, Architecte…" />
        </div>
        <div>
          <label style={modalLabelStyle}>Téléphone WhatsApp</label>
          <input style={modalInputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="ex. 06 12 34 56 78" type="tel" />
        </div>
        {error && <div style={{ fontSize: 12, color: '#DC2626' }}>{error}</div>}
        <button onClick={handleSubmit} disabled={saving} style={submitBtnStyle}>{saving ? 'Enregistrement…' : (initial ? 'Enregistrer' : 'Ajouter')}</button>
      </div>
    </BottomModal>
  )
}

// ─── Bottom sheet modal ───────────────────────────────────────────────────────

function BottomModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        zIndex: 100, animation: 'fadeIn .15s ease',
      }} />
      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--surface)', borderRadius: '16px 16px 0 0',
        zIndex: 101, animation: 'slideUp .22s ease',
        padding: '0 16px 32px', maxHeight: '85vh', overflowY: 'auto',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <button onClick={onClose} style={{ ...smallBtnStyle('neutral'), fontSize: 16 }}>✕</button>
        </div>
        {children}
      </div>
    </>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

function smallBtnStyle(variant: 'primary' | 'neutral'): React.CSSProperties {
  return {
    width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
    background: variant === 'primary' ? 'var(--primary)' : 'var(--surface-2)',
    color: variant === 'primary' ? '#fff' : 'var(--text)',
    cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  }
}

const addBtnStyle: React.CSSProperties = {
  width: '100%', padding: '10px', border: '1.5px dashed var(--primary)', borderRadius: 'var(--r-sm)',
  background: 'transparent', color: 'var(--primary)', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginTop: 4,
}

const submitBtnStyle: React.CSSProperties = {
  width: '100%', padding: '11px', borderRadius: 10, border: 'none',
  background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700,
  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
}
