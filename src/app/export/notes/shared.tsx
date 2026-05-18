'use client'

import type { Note, NoteCategory, NoteStatus } from '@/types/database'

export const CAT_META: Record<NoteCategory, { label: string; icon: string; color: string }> = {
  info:     { label: 'Info',     icon: 'ℹ',  color: '#2152C8' },
  demande:  { label: 'Demande',  icon: '?',  color: '#7C3AED' },
  reserve:  { label: 'Réserve',  icon: '!',  color: '#EA580C' },
  incident: { label: 'Incident', icon: '⚠', color: '#DC2626' },
  rappel:   { label: 'Rappel',   icon: '⏰', color: '#D97706' },
}

export const STATUS_META: Record<NoteStatus, { label: string; color: string; bg: string }> = {
  ouvert:    { label: 'Ouvert',    color: '#2152C8', bg: '#EEF2FC' },
  en_cours:  { label: 'En cours',  color: '#D97706', bg: '#FEF3C7' },
  en_retard: { label: 'En retard', color: '#DC2626', bg: '#FEE2E2' },
  resolu:    { label: 'Résolu',    color: '#16A34A', bg: '#DCFCE7' },
  termine:   { label: 'Terminé',   color: '#6B6860', bg: '#EFEDE8' },
}

export function fmtFrDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', opts ?? { day: 'numeric', month: 'long', year: 'numeric' })
}

export function getStatusForNote(n: Note): NoteStatus {
  if ((n.status === 'ouvert' || n.status === 'en_cours') && n.due_date) {
    const today = new Date().toISOString().slice(0, 10)
    if (n.due_date < today) return 'en_retard'
  }
  return n.status
}

export function getWeekRange(offset = 0): { start: string; end: string; label: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const mon = new Date(today); mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const start = mon.toISOString().slice(0, 10)
  const end   = sun.toISOString().slice(0, 10)
  const FR_M  = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.']
  const label = mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()} – ${sun.getDate()} ${FR_M[sun.getMonth()]} ${sun.getFullYear()}`
    : `${mon.getDate()} ${FR_M[mon.getMonth()]} – ${sun.getDate()} ${FR_M[sun.getMonth()]} ${sun.getFullYear()}`
  return { start, end, label }
}

export const PRINT_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: 'DM Sans', sans-serif; background: #ECEAE5; height: auto !important; min-height: 100%; overflow-y: auto !important; }
  .print-page {
    width: 190mm; margin: 0 auto 28px; background: #fff; border-radius: 10px;
    box-shadow: 0 2px 20px rgba(0,0,0,.09); overflow: hidden;
    page-break-after: always; page-break-inside: avoid;
  }
  .print-page:last-child { page-break-after: auto; }
  @media print {
    @page { size: A4; margin: 1cm 1.2cm; }
    html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .print-page { box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; width: 100% !important; }
  }
`

export function PrintToolbar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="no-print" style={{
      background: '#1A1A1A', color: '#fff', padding: '0 20px',
      height: 50, display: 'flex', alignItems: 'center', gap: 14,
      fontFamily: 'DM Sans, sans-serif', position: 'sticky', top: 0, zIndex: 10,
    }}>
      <span style={{ fontWeight: 900, fontSize: 11, letterSpacing: '.1em', opacity: .4 }}>PLANIFY</span>
      <span style={{ opacity: .15 }}>|</span>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
        {children}
        <button onClick={() => window.print()} style={{
          padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: '#2152C8', color: '#fff', fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>🖨 Imprimer / PDF</button>
      </div>
    </div>
  )
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: string }) {
  return (
    <div style={{
      background: '#1A1A1A', color: '#fff',
      padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 8, letterSpacing: '.12em', opacity: .4, textTransform: 'uppercase' }}>Planify</div>
          <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-.3px', lineHeight: 1.1 }}>HSF Av. Marceau</div>
        </div>
        <div style={{ width: 1, height: 26, background: 'rgba(255,255,255,.15)' }} />
        <div>
          <div style={{ fontSize: 8, opacity: .4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>{title}</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{subtitle}</div>
        </div>
      </div>
      {right && <div style={{ textAlign: 'right', fontSize: 9, opacity: .5 }}>{right}</div>}
    </div>
  )
}

export function NoteBlock({ note }: { note: Note }) {
  const cat  = CAT_META[note.category ?? 'info']
  const stat = STATUS_META[getStatusForNote(note)]
  return (
    <div style={{
      padding: '10px 12px', borderBottom: '1px solid #E5E2DC',
      breakInside: 'avoid', pageBreakInside: 'avoid',
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{
          padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 800, color: cat.color,
          background: cat.color + '15', textTransform: 'uppercase', letterSpacing: '.04em',
        }}>{cat.icon} {cat.label}</span>
        <span style={{
          padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, color: stat.color, background: stat.bg,
        }}>● {stat.label}</span>
        {note.due_date && (
          <span style={{ fontSize: 9, color: '#6B6860', fontFamily: "'DM Mono', monospace" }}>⏰ {fmtFrDate(note.due_date, { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#9A9690' }}>{fmtFrDate(note.created_at, { day: '2-digit', month: '2-digit', year: '2-digit' })} · {note.author_name}</span>
      </div>
      {note.title && <div style={{ fontSize: 12, fontWeight: 800, color: '#1A1A1A', marginBottom: 3, lineHeight: 1.25 }}>{note.title}</div>}
      <div style={{ fontSize: 11, color: '#2A2A2A', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{note.content}</div>
      {(note.proof_comment || note.proof_url) && (
        <div style={{ marginTop: 5, padding: '4px 8px', borderRadius: 4, background: '#DCFCE7', borderLeft: '3px solid #15803D', fontSize: 10, color: '#14532D' }}>
          ✓ Preuve : {note.proof_comment ?? (note.proof_url ? 'fichier joint' : '')}
        </div>
      )}
    </div>
  )
}
