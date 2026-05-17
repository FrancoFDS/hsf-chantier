'use client'

import { useState } from 'react'
import type { Intervention, Zone, Trade, Status } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META, STATUS_OPTIONS } from '@/constants/status'
import { getTradeColor, getZoneFloorColor } from '@/constants/colors'
import { fmtDate, daysOverdue } from '@/lib/dates'
import { supabase } from '@/lib/supabase'

interface Props {
  iv: Intervention
  zones: Zone[]
  trades: Trade[]
  allInterventions: Intervention[]
  onClose: () => void
  onUpdate: (patch: Partial<Intervention>) => void
  onStartMove?: () => void
  onStartDuplicate?: () => void
}

export default function TaskDetail({ iv, zones, trades, allInterventions, onClose, onUpdate, onStartMove, onStartDuplicate }: Props) {
  const [saving, setSaving]   = useState(false)
  const [editing, setEditing] = useState(false)
  const [status, setStatus]   = useState<Status>(iv.status as Status)
  const [notes, setNotes]     = useState(iv.notes ?? '')

  // Edit-mode fields
  const [editTask,      setEditTask]      = useState(iv.task ?? '')
  const [editZone,      setEditZone]      = useState(iv.zone ?? '')
  const [editTrade,     setEditTrade]     = useState(iv.trade ?? '')
  const [editCompany,   setEditCompany]   = useState(iv.company ?? '')
  const [editStartDate, setEditStartDate] = useState(iv.start_date ?? '')
  const [editEndDate,   setEditEndDate]   = useState(iv.end_date ?? '')
  const [editOffDays,   setEditOffDays]   = useState<string[]>(iv.off_days ?? [])
  const [newOffDay,     setNewOffDay]     = useState('')

  const zone  = zones.find(z => z.id === (editing ? editZone : iv.zone))
  const trade = trades.find(t => t.id === (editing ? editTrade : iv.trade))
  const tc    = getTradeColor(trade?.color ?? 'blue')
  const es    = effectiveStatus(iv)
  const sm    = STATUS_META[es]
  const zoneColor = zone ? getZoneFloorColor(zones, zone.floor) : '#9CA3AF'

  const predecessor = iv.predecessor_id ? allInterventions.find(x => x.id === iv.predecessor_id) : null
  const successors  = (iv.successor_ids ?? []).map(id => allInterventions.find(x => x.id === id)).filter(Boolean) as Intervention[]

  const hasChanges = editing
    ? editTask !== (iv.task ?? '') || editZone !== (iv.zone ?? '') || editTrade !== (iv.trade ?? '') ||
      editCompany !== (iv.company ?? '') || editStartDate !== (iv.start_date ?? '') || editEndDate !== (iv.end_date ?? '') ||
      JSON.stringify(editOffDays.slice().sort()) !== JSON.stringify((iv.off_days ?? []).slice().sort()) ||
      status !== iv.status || notes !== (iv.notes ?? '')
    : status !== iv.status || notes !== (iv.notes ?? '')

  function handleTradeChange(newTradeId: string) {
    setEditTrade(newTradeId)
    const firstCompany = trades.find(t => t.id === newTradeId)
    if (firstCompany) setEditCompany('')
  }

  async function handleSave() {
    setSaving(true)
    const patch: Partial<Intervention> = editing
      ? { status, notes, task: editTask, zone: editZone, trade: editTrade, company: editCompany, start_date: editStartDate || null, end_date: editEndDate || null, off_days: editOffDays }
      : { status, notes }
    const { error } = await supabase.from('interventions').update(patch).eq('id', iv.id)
    setSaving(false)
    if (!error) { setEditing(false); onUpdate(patch) }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100, backdropFilter: 'blur(2px)' }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
        background: 'var(--surface)', borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,.18)',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        animation: 'slideUp .22s ease-out',
      }}>
        {/* Handle */}
        <div style={{ padding: '12px 0 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: tc.b, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {iv.task_number && (
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--xmuted)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)' }}>
                  {iv.task_number}
                </span>
              )}
              {zone && !editing && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, color: zoneColor, background: zoneColor + '18', border: `1px solid ${zoneColor}40` }}>
                  {zone.short}
                </span>
              )}
              {trade && !editing && (
                <span style={{ fontSize: 10, color: tc.t, background: tc.bg, padding: '1px 6px', borderRadius: 4, fontWeight: 500, border: `1px solid ${tc.b}30` }}>
                  {trade.short}
                </span>
              )}
              <span style={{ fontSize: 10, fontWeight: 600, color: sm.dot, background: sm.bg, padding: '2px 7px', borderRadius: 10 }}>
                {sm.label}
              </span>
            </div>
            {editing ? (
              <input
                value={editTask}
                onChange={e => setEditTask(e.target.value)}
                style={{ width: '100%', fontSize: 15, fontWeight: 700, color: 'var(--text)', border: '1px solid var(--primary)', borderRadius: 6, padding: '5px 8px', background: 'var(--surface-2)', fontFamily: "'DM Sans', sans-serif" }}
              />
            ) : (
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>{iv.task}</div>
            )}
            {!editing && (
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", marginTop: 4 }}>
                {fmtDate(iv.start_date)}{iv.end_date && iv.end_date !== iv.start_date ? ` → ${fmtDate(iv.end_date)}` : ''}
                {iv.company && ` · ${iv.company}`}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <button onClick={onClose} style={{ border: 'none', background: 'var(--surface-2)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
            <button onClick={() => setEditing(e => !e)} style={{ border: `1px solid ${editing ? 'var(--primary)' : 'var(--border)'}`, background: editing ? 'var(--primary-l)' : 'var(--surface-2)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 13, color: editing ? 'var(--primary)' : 'var(--muted)' }}>✎</button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

          {/* Late warning */}
          {es === 'en_retard' && (
            <div style={{ background: '#FFF7ED', border: '1px solid rgba(234,88,12,.3)', borderRadius: 'var(--r-sm)', padding: '10px 12px', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>⏱</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#9A3412' }}>
                En retard de {daysOverdue(iv)} jour{daysOverdue(iv) > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Prereq */}
          {iv.prereq?.trim() && (
            <div style={{ background: '#FEF2F2', border: '1px solid rgba(220,38,38,.25)', borderLeft: '3px solid #DC2626', borderRadius: 'var(--r-xs)', padding: '8px 10px', marginBottom: 10, fontSize: 12, color: '#991B1B' }}>
              ⚠ Prérequis : {iv.prereq}{iv.prereq_company ? ` · ${iv.prereq_company}` : ''}
            </div>
          )}

          {/* Dependencies */}
          {predecessor && (
            <InfoRow label="Prédécesseur">
              <DepBadge iv={predecessor} zones={zones} trades={trades} />
            </InfoRow>
          )}
          {successors.length > 0 && (
            <InfoRow label={`Successeur${successors.length > 1 ? 's' : ''}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {successors.map(s => <DepBadge key={s.id} iv={s} zones={zones} trades={trades} />)}
              </div>
            </InfoRow>
          )}

          {/* Off days */}
          {(editing || (iv.off_days && iv.off_days.length > 0)) && (
            <InfoRow label="Jours gelés">
              {editing ? (
                <div>
                  {/* Existing chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: editOffDays.length > 0 ? 8 : 0 }}>
                    {editOffDays.sort().map(d => (
                      <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 20, padding: '3px 8px', fontSize: 12, color: '#991B1B' }}>
                        {fmtDate(d)}
                        <button onClick={() => setEditOffDays(prev => prev.filter(x => x !== d))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
                      </span>
                    ))}
                  </div>
                  {/* Add new day */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="date"
                      value={newOffDay}
                      onChange={e => setNewOffDay(e.target.value)}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      onClick={() => {
                        if (newOffDay && !editOffDays.includes(newOffDay)) {
                          setEditOffDays(prev => [...prev, newOffDay])
                          setNewOffDay('')
                        }
                      }}
                      style={{ padding: '7px 14px', borderRadius: 'var(--r-xs)', border: '1px solid var(--primary)', background: 'var(--primary-l)', color: 'var(--primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    >
                      + Ajouter
                    </button>
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--danger)' }}>
                  {iv.off_days!.map(d => fmtDate(d)).join(', ')}
                </span>
              )}
            </InfoRow>
          )}

          {/* Priority */}
          <InfoRow label="Priorité">
            <PriorityBadge priority={iv.priority} />
          </InfoRow>

          <div style={{ height: 1, background: 'var(--border)', margin: '14px 0' }} />

          {/* Edit mode fields */}
          {editing && (
            <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Zone</label>
                  <select value={editZone} onChange={e => setEditZone(e.target.value)} style={inputStyle}>
                    <option value="">— Sans zone —</option>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.short}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Corps de métier</label>
                  <select value={editTrade} onChange={e => handleTradeChange(e.target.value)} style={inputStyle}>
                    <option value="">— Sans trade —</option>
                    {trades.map(t => <option key={t.id} value={t.id}>{t.short}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Entreprise</label>
                <input value={editCompany} onChange={e => setEditCompany(e.target.value)} style={inputStyle} placeholder="Nom de l'entreprise" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Début</label>
                  <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Fin</label>
                  <input type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} style={inputStyle} />
                </div>
              </div>
            </div>
          )}

          {/* Editable: Status */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Statut</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {STATUS_OPTIONS.map(s => {
                const m = STATUS_META[s]
                const active = status === s
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${active ? m.dot : 'var(--border)'}`,
                      background: active ? m.bg : 'var(--surface-2)',
                      color: active ? m.dot : 'var(--muted)',
                      transition: 'all .12s',
                    }}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Editable: Notes */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              style={{
                width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 'var(--r-xs)',
                border: '1px solid var(--border)', background: 'var(--surface-2)',
                color: 'var(--text)', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                resize: 'vertical',
              }}
              placeholder="Ajouter une note…"
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          {/* Move / Duplicate row */}
          {(onStartMove || onStartDuplicate) && (
            <div style={{ display: 'flex', gap: 8 }}>
              {onStartMove && (
                <button
                  onClick={onStartMove}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 'var(--r-sm)', border: '1px solid #3B82F6', background: '#EFF6FF', color: '#1D4ED8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  ↕ Déplacer
                </button>
              )}
              {onStartDuplicate && (
                <button
                  onClick={onStartDuplicate}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 'var(--r-sm)', border: '1px solid #22C55E', background: '#F0FDF4', color: '#15803D', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  ⊕ Dupliquer
                </button>
              )}
            </div>
          )}
          {/* Annuler / Enregistrer row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              style={{
                flex: 2, padding: '11px 0', borderRadius: 'var(--r-sm)', border: 'none',
                background: hasChanges ? 'var(--primary)' : 'var(--border)',
                color: hasChanges ? '#fff' : 'var(--muted)',
                fontSize: 14, fontWeight: 700, cursor: hasChanges ? 'pointer' : 'default',
                transition: 'background .15s',
              }}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
      {children}
    </div>
  )
}

function DepBadge({ iv, zones, trades }: { iv: Intervention; zones: Zone[]; trades: Trade[] }) {
  const trade = trades.find(t => t.id === iv.trade)
  const zone  = zones.find(z => z.id === iv.zone)
  const es    = effectiveStatus(iv)
  const sm    = STATUS_META[es]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)', background: 'var(--surface-2)', borderRadius: 6, padding: '5px 8px', border: '1px solid var(--border)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: sm.dot, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontWeight: 500 }}>{iv.task_number ?? iv.id}</span>
      <span style={{ color: 'var(--muted)' }}>{iv.task?.slice(0, 40)}{(iv.task?.length ?? 0) > 40 ? '…' : ''}</span>
    </div>
  )
}

function PriorityBadge({ priority }: { priority: number }) {
  const cfg = priority === 1
    ? { label: 'Critique', color: '#DC2626', bg: '#FEF2F2' }
    : priority === 2
    ? { label: 'Haute',    color: '#EA580C', bg: '#FFF7ED' }
    : { label: 'Normale',  color: '#6B7280', bg: 'var(--surface-2)' }
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color, background: cfg.bg, padding: '2px 10px', borderRadius: 10, border: `1px solid ${cfg.color}30` }}>
      {cfg.label}
    </span>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--border)', background: 'var(--surface-2)',
  color: 'var(--text)', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
  boxSizing: 'border-box',
}
