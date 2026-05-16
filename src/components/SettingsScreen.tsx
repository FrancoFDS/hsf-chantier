'use client'

import { useState } from 'react'
import type { Zone, Trade, Company } from '@/types/database'
import { getZoneFloorColor, getTradeColor } from '@/constants/colors'
import { supabase } from '@/lib/supabase'

interface Props {
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
  onZonesChange: (zones: Zone[]) => void
}

type Tab = 'zones' | 'trades' | 'companies'

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

export default function SettingsScreen({ zones, trades, companies, onZonesChange }: Props) {
  const [tab, setTab] = useState<Tab>('zones')

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 14px 100px' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Configuration</div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {(['zones', 'trades', 'companies'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '9px', background: 'transparent', border: 'none', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', color: tab === t ? 'var(--primary)' : 'var(--muted)',
            fontFamily: "'DM Sans', sans-serif",
            borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent', marginBottom: -1,
          }}>
            {t === 'zones' ? 'Zones' : t === 'trades' ? 'Corps de métier' : 'Entreprises'}
          </button>
        ))}
      </div>

      {tab === 'zones'     && <ZonesTab zones={zones} onZonesChange={onZonesChange} />}
      {tab === 'trades'    && <TradesTab trades={trades} />}
      {tab === 'companies' && <CompaniesTab companies={companies} trades={trades} />}
    </div>
  )
}

// ─── Zones tab ────────────────────────────────────────────────────────────────

function ZonesTab({ zones, onZonesChange }: { zones: Zone[]; onZonesChange: (z: Zone[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [draft, setDraft]         = useState<string>('')

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
    </div>
  )
}

// ─── Trades tab ───────────────────────────────────────────────────────────────

function TradesTab({ trades }: { trades: Trade[] }) {
  return (
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
          </div>
        )
      })}
    </div>
  )
}

// ─── Companies tab ────────────────────────────────────────────────────────────

function CompaniesTab({ companies, trades }: { companies: Company[]; trades: Trade[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {companies.map(co => {
        const trade = trades.find(t => t.id === co.trade_id)
        const tc    = getTradeColor(trade?.color ?? 'blue')
        const isExp = expandedId === co.id
        const allContacts = []
        if (co.contact || co.phone) allContacts.push({ name: co.contact ?? '', phone: co.phone ?? '', email: co.email ?? '' })
        ;(co.contacts ?? []).forEach(c => { if (c.name || c.phone) allContacts.push(c) })

        return (
          <div key={co.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
            <div onClick={() => setExpandedId(isExp ? null : co.id)} style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: tc.b, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{co.name}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                  {trade?.short ?? '—'}{co.phone ? ` · ${co.phone}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{isExp ? '▲' : '▼'}</span>
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
                {trade && (
                  <>
                    <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '10px 0 6px' }}>Corps de métier</div>
                    <span style={{ fontSize: 11, color: tc.t, background: tc.bg, padding: '2px 10px', borderRadius: 999, fontWeight: 600, border: `1px solid ${tc.b}30` }}>
                      {trade.name}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

function smallBtnStyle(variant: 'primary' | 'neutral'): React.CSSProperties {
  return {
    width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
    background: variant === 'primary' ? 'var(--primary)' : 'var(--surface-2)',
    color: variant === 'primary' ? '#fff' : 'var(--text)',
    cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}
