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
}

export default function TaskDetail({ iv, zones, trades, allInterventions, onClose, onUpdate }: Props) {
  const [saving, setSaving]     = useState(false)
  const [status, setStatus]     = useState<Status>(iv.status as Status)
  const [notes, setNotes]       = useState(iv.notes ?? '')
  const [progress, setProgress] = useState(iv.progress ?? 0)

  const zone  = zones.find(z => z.id === iv.zone)
  const trade = trades.find(t => t.id === iv.trade)
  const tc    = getTradeColor(trade?.color ?? 'blue')
  const es    = effectiveStatus(iv)
  const sm    = STATUS_META[es]
  const zoneColor = zone ? getZoneFloorColor(zones, zone.floor) : '#9CA3AF'

  const predecessor = iv.predecessor_id ? allInterventions.find(x => x.id === iv.predecessor_id) : null
  const successors  = (iv.successor_ids ?? []).map(id => allInterventions.find(x => x.id === id)).filter(Boolean) as Intervention[]

  const hasChanges = status !== iv.status || notes !== (iv.notes ?? '') || progress !== (iv.progress ?? 0)

  async function handleSave() {
    setSaving(true)
    const patch: Partial<Intervention> = { status, notes, progress }
    const { error } = await supabase.from('interventions').update(patch).eq('id', iv.id)
    setSaving(false)
    if (!error) onUpdate(patch)
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
              {zone && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, color: zoneColor, background: zoneColor + '18', border: `1px solid ${zoneColor}40` }}>
                  {zone.short}
                </span>
              )}
              {trade && (
                <span style={{ fontSize: 10, color: tc.t, background: tc.bg, padding: '1px 6px', borderRadius: 4, fontWeight: 500, border: `1px solid ${tc.b}30` }}>
                  {trade.short}
                </span>
              )}
              <span style={{ fontSize: 10, fontWeight: 600, color: sm.dot, background: sm.bg, padding: '2px 7px', borderRadius: 10 }}>
                {sm.label}
              </span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>{iv.task}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", marginTop: 4 }}>
              {fmtDate(iv.start_date)}{iv.end_date && iv.end_date !== iv.start_date ? ` → ${fmtDate(iv.end_date)}` : ''}
              {iv.company && ` · ${iv.company}`}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--surface-2)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, color: 'var(--muted)', flexShrink: 0 }}>
            ×
          </button>
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
          {iv.off_days && iv.off_days.length > 0 && (
            <InfoRow label="Jours gelés">
              <span style={{ fontSize: 12, color: 'var(--danger)' }}>
                {iv.off_days.map(d => fmtDate(d)).join(', ')}
              </span>
            </InfoRow>
          )}

          {/* Priority */}
          <InfoRow label="Priorité">
            <PriorityBadge priority={iv.priority} />
          </InfoRow>

          <div style={{ height: 1, background: 'var(--border)', margin: '14px 0' }} />

          {/* Editable: Status */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Statut</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {STATUS_OPTIONS.filter(s => s !== 'en_retard').map(s => {
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

          {/* Editable: Progress */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Avancement manuel : <strong>{progress}%</strong></label>
            <input
              type="range" min={0} max={100} step={5}
              value={progress}
              onChange={e => setProgress(Number(e.target.value))}
              style={{ width: '100%', marginTop: 8, accentColor: 'var(--primary)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--xmuted)', marginTop: 2 }}>
              <span>0%</span><span>50%</span><span>100%</span>
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
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
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
  fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px',
}
