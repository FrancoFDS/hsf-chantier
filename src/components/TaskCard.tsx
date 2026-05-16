'use client'

import type { Intervention, Zone, Trade } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getTradeColor, getZoneFloorColor } from '@/constants/colors'
import { fmtDate, daysOverdue } from '@/lib/dates'

interface Props {
  iv: Intervention
  zones: Zone[]
  trades: Trade[]
  onClick?: (id: string) => void
}

export default function TaskCard({ iv, zones, trades, onClick }: Props) {
  const zone  = zones.find(z => z.id === iv.zone)
  const trade = trades.find(t => t.id === iv.trade)
  const tc    = getTradeColor(trade?.color ?? 'blue')
  const es    = effectiveStatus(iv)
  const sm    = STATUS_META[es]
  const isLate   = es === 'en_retard'
  const isBloque = es === 'bloque'

  const borderColor = isLate ? '#EA580C' : isBloque ? '#DC2626' : tc.b
  const borderAlpha = isLate ? 'rgba(234,88,12,.3)' : isBloque ? 'rgba(220,38,38,.3)' : 'var(--border)'
  const overdueDays = isLate ? daysOverdue(iv) : 0

  const dateRange = iv.start_date
    ? fmtDate(iv.start_date) + (iv.end_date && iv.end_date !== iv.start_date ? ' → ' + fmtDate(iv.end_date) : '')
    : '—'

  const zoneColor = zone ? getZoneFloorColor(zones, zone.floor) : '#9CA3AF'
  const cleanNotes = iv.notes?.trim() && !iv.notes.startsWith('Etage') && !iv.notes.startsWith('Étage')
    ? iv.notes
    : null

  return (
    <div
      onClick={() => onClick?.(iv.id)}
      style={{
        marginBottom: 8, borderRadius: 'var(--r-sm)', cursor: onClick ? 'pointer' : 'default',
        background: 'var(--surface)', border: `1px solid ${borderAlpha}`,
        borderLeft: `4px solid ${borderColor}`, boxShadow: 'var(--shadow)',
        overflow: 'hidden', transition: 'box-shadow .15s',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-md)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow)' }}
    >
      {/* Late banner */}
      {isLate && (
        <div style={{ background: '#FFF7ED', borderBottom: '1px solid rgba(234,88,12,.25)', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12 }}>⏱</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9A3412', flex: 1 }}>
            En retard de {overdueDays} jour{overdueDays > 1 ? 's' : ''}
            {iv.end_date ? ` — fin prévue le ${fmtDate(iv.end_date)}` : ''}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#EA580C', background: 'rgba(234,88,12,.12)', padding: '2px 6px', borderRadius: 10 }}>RETARD</span>
        </div>
      )}

      <div style={{ padding: '10px 12px' }}>
        {/* Top row: badges + status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
            {iv.task_number && (
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--xmuted)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)', flexShrink: 0 }}>
                {iv.task_number}
              </span>
            )}
            {zone && (
              <span style={{ fontSize: 10, fontWeight: 600, flexShrink: 0, padding: '2px 7px', borderRadius: 10, color: zoneColor, background: zoneColor + '18', border: `1px solid ${zoneColor}40` }}>
                {zone.short}
              </span>
            )}
            {trade && (
              <span style={{ fontSize: 10, color: tc.t, background: tc.bg, padding: '1px 5px', borderRadius: 4, fontWeight: 500, flexShrink: 0, border: `1px solid ${tc.b}30` }}>
                {trade.short}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: sm.dot, flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: sm.dot }}>{sm.label}</span>
          </div>
        </div>

        {/* Task description */}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.45, marginBottom: 6 }}>
          {iv.task}
        </div>

        {/* Date + off days */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: (iv.prereq || cleanNotes) ? 5 : 0 }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--xmuted)' }}>{dateRange}</span>
          {iv.off_days && iv.off_days.length > 0 && (
            <span style={{ fontSize: 9, color: 'var(--danger)', fontFamily: "'DM Mono', monospace" }}>
              {iv.off_days.length} jour{iv.off_days.length > 1 ? 's' : ''} gelé{iv.off_days.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Prereq */}
        {iv.prereq?.trim() && (
          <div style={{ fontSize: 11, color: '#DC2626', background: '#FEF2F2', padding: '4px 8px', borderRadius: 3, borderLeft: '3px solid #DC2626', marginBottom: 4 }}>
            ⚠ Prérequis : {iv.prereq}{iv.prereq_company ? ` · ${iv.prereq_company}` : ''}
          </div>
        )}

        {/* Notes */}
        {cleanNotes && (
          <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>
            {cleanNotes}
          </div>
        )}
      </div>
    </div>
  )
}
