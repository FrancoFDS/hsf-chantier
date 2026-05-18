'use client'

import { useRef, useState } from 'react'
import type { Intervention, Zone, Trade, Company } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META } from '@/constants/status'
import { getTradeColor, getZoneFloorColor } from '@/constants/colors'
import { isTaskActiveOn, todayStr } from '@/lib/dates'
import { supabase } from '@/lib/supabase'
import TaskDetail from './TaskDetail'

type ViewMode = '1s' | '2s' | '3s'

interface Props {
  interventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
  highlightCompany?: string
  readOnly?: boolean
  authorName?: string
  onUpdate: (id: string, patch: Partial<Intervention>) => void
  onAdd: (iv: Intervention) => void
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getMonday(offset = 0): Date {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + offset * 7)
  return monday
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(startStr: string, endStr: string): number {
  const s = new Date(startStr + 'T00:00:00')
  const e = new Date(endStr   + 'T00:00:00')
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000))
}

function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return localDateStr(d)
}

function multiWeekDays(weekOffset: number, weeks: number): string[] {
  const monday = getMonday(weekOffset)
  const out: string[] = []
  for (let w = 0; w < weeks; w++) {
    for (let d2 = 0; d2 < 7; d2++) {
      const day = new Date(monday)
      day.setDate(monday.getDate() + w * 7 + d2)
      out.push(localDateStr(day))
    }
  }
  return out
}

function dayLabel(dateStr: string): { weekday: string; date: string } {
  const d = new Date(dateStr + 'T12:00:00')
  return {
    weekday: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][d.getDay()],
    date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
  }
}

// ─── French public holiday helpers ───────────────────────────────────────────

/** Gregorian algorithm — returns Easter Sunday for a given year */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day   = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function getFrenchHolidays(year: number): Set<string> {
  const fmt = (d: Date) => localDateStr(d)

  const easter = easterSunday(year)

  function easterPlus(days: number): Date {
    const d = new Date(easter)
    d.setDate(d.getDate() + days)
    return d
  }

  const fixed = [
    `${year}-01-01`, // Jour de l'An
    `${year}-05-01`, // Fête du Travail
    `${year}-05-08`, // Victoire 1945
    `${year}-07-14`, // Fête Nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice
    `${year}-12-25`, // Noël
  ]

  const movable = [
    fmt(easterPlus(1)),  // Lundi de Pâques
    fmt(easterPlus(39)), // Ascension
    fmt(easterPlus(50)), // Lundi de Pentecôte
  ]

  return new Set([...fixed, ...movable])
}

// Cache per year
const holidayCache: Record<number, Set<string>> = {}

function isHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.slice(0, 4), 10)
  if (!holidayCache[year]) holidayCache[year] = getFrenchHolidays(year)
  return holidayCache[year].has(dateStr)
}

// ─── AddTaskModal ─────────────────────────────────────────────────────────────

interface AddTaskModalProps {
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
  defaultZone?: string
  defaultDate?: string
  onClose: () => void
  onAdd: (iv: Intervention) => void
}

function AddTaskModal({ zones, trades, companies, defaultZone, defaultDate, onClose, onAdd }: AddTaskModalProps) {
  const today = todayStr()
  const firstTradeId = trades[0]?.id ?? ''
  const firstCompany = companies.find(c => c.trade_id === firstTradeId)?.name ?? ''
  const [zoneId,    setZoneId]    = useState(defaultZone ?? zones[0]?.id ?? '')
  const [tradeId,   setTradeId]   = useState(firstTradeId)
  const [company,   setCompany]   = useState(firstCompany)
  const [task,      setTask]      = useState('')
  const [startDate, setStartDate] = useState(defaultDate ?? today)
  const [endDate,   setEndDate]   = useState(defaultDate ?? today)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  function handleTradeChange(newTradeId: string) {
    setTradeId(newTradeId)
    const autoCompany = companies.find(c => c.trade_id === newTradeId)?.name ?? ''
    setCompany(autoCompany)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!task.trim()) { setError('La description est requise.'); return }
    setSaving(true)
    setError(null)
    const newIv = {
      trade:      tradeId,
      company,
      task:       task.trim(),
      task_number: '',
      zone:       zoneId,
      start_date: startDate,
      end_date:   endDate >= startDate ? endDate : startDate,
      status:     'arealis' as const,
      priority:   3 as const,
      prereq:     '',
      notes:      '',
      predecessor_id:   null,
      predecessor_ids:  [],
      successor_ids:    [],
      off_days:         [],
      attachments:      [],
      progress:         0,
      prereq_company:   null,
      company_edit_allowed: false,
    }
    const { data, error: err } = await supabase.from('interventions').insert([newIv]).select().single()
    setSaving(false)
    if (err || !data) { setError(err?.message ?? 'Erreur inconnue'); return }
    onAdd(data as Intervention)
    onClose()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100, backdropFilter: 'blur(2px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
        background: 'var(--surface)', borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,.18)',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        animation: 'slideUp .22s ease-out',
      }}>
        {/* Handle */}
        <div style={{ padding: '12px 0 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div style={{ padding: '10px 16px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Nouvelle tâche</span>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--surface-2)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Zone */}
            <div>
              <label style={modalLabelStyle}>Zone</label>
              <select value={zoneId} onChange={e => setZoneId(e.target.value)} style={modalSelectStyle}>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name} ({z.short})</option>)}
              </select>
            </div>

            {/* Corps de métier */}
            <div>
              <label style={modalLabelStyle}>Corps de métier</label>
              <select value={tradeId} onChange={e => handleTradeChange(e.target.value)} style={modalSelectStyle}>
                {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            {/* Entreprise */}
            <div>
              <label style={modalLabelStyle}>Entreprise</label>
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="Nom de l'entreprise"
                style={modalInputStyle}
              />
            </div>

            {/* Description */}
            <div>
              <label style={modalLabelStyle}>Description <span style={{ color: 'var(--danger)' }}>*</span></label>
              <textarea
                value={task}
                onChange={e => setTask(e.target.value)}
                rows={3}
                placeholder="Description de la tâche…"
                style={{ ...modalInputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* Dates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={modalLabelStyle}>Date début</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value) }}
                  style={modalInputStyle}
                />
              </div>
              <div>
                <label style={modalLabelStyle}>Date fin</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={e => setEndDate(e.target.value)}
                  style={modalInputStyle}
                />
              </div>
            </div>

            {error && (
              <div style={{ background: '#FEF2F2', border: '1px solid rgba(220,38,38,.3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#DC2626' }}>
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Annuler
            </button>
            <button type="submit" disabled={saving} style={{
              flex: 2, padding: '11px 0', borderRadius: 'var(--r-sm)', border: 'none',
              background: saving ? 'var(--border)' : 'var(--primary)',
              color: saving ? 'var(--muted)' : '#fff',
              fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
            }}>
              {saving ? 'Création…' : 'Créer la tâche'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

const modalLabelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5,
}
const modalInputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--border)', background: 'var(--surface-2)',
  color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
}
const modalSelectStyle: React.CSSProperties = {
  ...modalInputStyle,
}

// ─── Main component ───────────────────────────────────────────────────────────

type MoveMode = { iv: Intervention; mode: 'move' | 'dup' } | null

export default function PlanningScreen({ interventions, zones, trades, companies, highlightCompany, readOnly, authorName, onUpdate, onAdd }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [viewMode, setViewMode]     = useState<ViewMode>('1s')
  const [zoneFilter, setZoneFilter] = useState<string[]>([])
  const [dropOpen, setDropOpen]     = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd]       = useState(false)
  const [addDefaults, setAddDefaults] = useState<{ zone?: string; date?: string }>({})
  const [moveMode, setMoveMode]     = useState<MoveMode>(null)
  const dropRef = useRef<HTMLTableCellElement>(null)
  const today   = todayStr()

  const weeks      = viewMode === '3s' ? 3 : viewMode === '2s' ? 2 : 1
  const isMulti    = weeks > 1
  const days       = multiWeekDays(weekOffset, weeks)
  const visZones   = zoneFilter.length === 0 ? zones : zones.filter(z => zoneFilter.includes(z.id))
  const activeCount = zoneFilter.length

  const zoneW = isMulti ? 40 : 58
  const deadW = isMulti ? 28 : 50

  function toggleZone(id: string) {
    setZoneFilter(prev => {
      if (prev.length === 0) return zones.filter(z => z.id !== id).map(z => z.id)
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      return next.length === zones.length ? [] : next
    })
  }

  const selectedIv = selectedId ? interventions.find(iv => iv.id === selectedId) ?? null : null

  async function handleCellClick(zoneId: string, dateStr: string) {
    if (moveMode) {
      const { iv, mode } = moveMode
      const duration = daysBetween(iv.start_date ?? dateStr, iv.end_date ?? iv.start_date ?? dateStr)
      const newStart = dateStr
      const newEnd   = addDaysLocal(dateStr, duration)

      if (mode === 'move') {
        const patch: Partial<Intervention> = { start_date: newStart, end_date: newEnd }
        const { error } = await supabase.from('interventions').update(patch).eq('id', iv.id)
        if (!error) onUpdate(iv.id, patch)
      } else {
        // dup
        const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = iv
        void _id; void _ca; void _ua
        const newRow = { ...rest, start_date: newStart, end_date: newEnd }
        const { data, error } = await supabase.from('interventions').insert([newRow]).select().single()
        if (!error && data) onAdd(data as Intervention)
      }
      setMoveMode(null)
      return
    }
    // no move mode — open add modal pre-filled
    setAddDefaults({ zone: zoneId, date: dateStr })
    setShowAdd(true)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }} onClick={() => { if (dropOpen) setDropOpen(false) }}>

      {/* Toolbar */}
      <div style={{ padding: '8px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* Week nav */}
        <button onClick={() => setWeekOffset(w => w - 1)} style={navBtnStyle}>‹</button>
        <div style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
            {weekOffset === 0 ? 'Cette semaine' : weekOffset === 1 ? 'Sem. prochaine' : weekOffset === -1 ? 'Sem. dernière' : `Sem. ${weekOffset > 0 ? '+' : ''}${weekOffset}`}
          </div>
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={navBtnStyle}>›</button>

        {/* View mode */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {(['1s', '2s', '3s'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${viewMode === m ? 'var(--primary)' : 'var(--border)'}`,
              background: viewMode === m ? 'var(--primary-l)' : 'var(--surface-2)',
              color: viewMode === m ? 'var(--primary)' : 'var(--muted)',
            }}>
              {m === '1s' ? '1 sem.' : m === '2s' ? '2 sem.' : '3 sem.'}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Export PDF — admin only */}
        {!readOnly && (
          <a
            href="/export/planning"
            target="_blank"
            rel="noreferrer"
            style={{
              height: 32, borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              padding: '0 10px', textDecoration: 'none', whiteSpace: 'nowrap',
            }}
            title="Exporter le planning en PDF"
          >
            🖨 PDF
          </a>
        )}

        {/* Add button — admin only */}
        {!readOnly && (
          <button
            onClick={e => { e.stopPropagation(); setAddDefaults({}); setShowAdd(true) }}
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none',
              background: 'var(--primary)', color: '#fff', fontSize: 20, lineHeight: 1,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 300,
            }}
            title="Ajouter une tâche"
          >
            +
          </button>
        )}
      </div>

      {/* Move mode banner */}
      {moveMode && (
        <div style={{
          background: moveMode.mode === 'move' ? '#EFF6FF' : '#F0FDF4',
          borderBottom: `2px solid ${moveMode.mode === 'move' ? '#3B82F6' : '#22C55E'}`,
          padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: moveMode.mode === 'move' ? '#1D4ED8' : '#15803D' }}>
            {moveMode.mode === 'move' ? '↕ Tapez une cellule pour déplacer' : '⊕ Tapez une cellule pour dupliquer'} · <em>{moveMode.iv.task?.slice(0, 30)}</em>
          </span>
          <button
            onClick={() => setMoveMode(null)}
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}
          >
            Annuler
          </button>
        </div>
      )}

      {/* Gantt table (scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', position: 'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: isMulti ? `${zoneW + days.length * 28 + deadW}px` : undefined }}>
          <colgroup>
            <col style={{ width: zoneW }} />
            {days.map((_, i) => <col key={i} />)}
            <col style={{ width: deadW }} />
          </colgroup>

          {/* ── Header ── */}
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>

              {/* Zone filter cell */}
              <th ref={dropRef} style={{
                padding: '5px 3px', borderRight: '3px solid var(--border)',
                position: 'sticky', top: 0, zIndex: 12, background: 'var(--surface-2)',
                verticalAlign: 'middle', textAlign: 'center',
              }}>
                <button onClick={e => { e.stopPropagation(); setDropOpen(o => !o) }} style={{
                  width: '100%', padding: '3px 2px', borderRadius: 4,
                  border: `1px solid ${dropOpen || activeCount ? 'var(--primary)' : 'var(--border)'}`,
                  background: activeCount ? 'var(--primary-l)' : 'transparent',
                  color: activeCount ? 'var(--primary)' : 'var(--muted)',
                  fontSize: 8, fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'DM Mono', monospace", letterSpacing: '.04em',
                  textTransform: 'uppercase', lineHeight: 1.3,
                }}>
                  {activeCount ? `${zones.length - activeCount}/${zones.length}` : 'Zones'}
                </button>

                {dropOpen && (
                  <div onClick={e => e.stopPropagation()} style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: 220,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)',
                    zIndex: 50, overflow: 'hidden', textAlign: 'left',
                  }}>
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Zones</span>
                      <button onClick={() => { setZoneFilter([]); setDropOpen(false) }} style={{ fontSize: 10, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Toutes</button>
                    </div>
                    {zones.map(z => {
                      const checked = zoneFilter.length === 0 || zoneFilter.includes(z.id)
                      const fc = getZoneFloorColor(zones, z.floor)
                      return (
                        <div key={z.id} onClick={() => toggleZone(z.id)} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                          cursor: 'pointer', borderBottom: '1px solid var(--border)',
                          background: checked ? 'var(--primary-l)' : 'transparent',
                        }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                            border: `2px solid ${checked ? 'var(--primary)' : 'var(--border)'}`,
                            background: checked ? 'var(--primary)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {checked && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: fc, flexShrink: 0, display: 'inline-block' }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{z.name}</div>
                            <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: 'var(--muted)' }}>{z.short}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </th>

              {/* Day headers */}
              {days.map((d, i) => {
                const isFirstOfWeek = i > 0 && i % 7 === 0
                const isCurrentDay  = d === today
                const lbl = dayLabel(d)
                const isWeekend = lbl.weekday === 'Sam' || lbl.weekday === 'Dim'
                const isHol     = isHoliday(d)

                let headerBg: string
                if (isCurrentDay) {
                  headerBg = 'var(--primary-l)'
                } else if (isHol) {
                  headerBg = '#FEF3C7'
                } else if (isWeekend) {
                  headerBg = 'var(--border)'
                } else {
                  headerBg = 'var(--surface-2)'
                }

                const headerColor = isCurrentDay ? 'var(--primary)' : isHol ? '#92400E' : 'var(--muted)'

                return (
                  <th key={d} style={{
                    padding: isMulti ? '3px 0' : '6px 2px',
                    textAlign: 'center', overflow: 'hidden',
                    position: 'sticky', top: 0, zIndex: 11,
                    borderLeft: `${isFirstOfWeek ? 2 : 1}px solid var(--border)`,
                    background: headerBg,
                    fontWeight: 'normal', verticalAlign: 'middle',
                  }}>
                    <div style={{ fontSize: isMulti ? (weeks > 2 ? 6 : 7) : 9, fontWeight: 800, color: headerColor, lineHeight: 1.05, whiteSpace: 'nowrap' }}>
                      {lbl.weekday}
                    </div>
                    <div style={{ fontSize: isMulti ? (weeks > 2 ? 6.5 : 7.5) : 10, fontFamily: "'DM Mono', monospace", color: headerColor, lineHeight: 1.05, whiteSpace: 'nowrap' }}>
                      {lbl.date}
                    </div>
                  </th>
                )
              })}

              {/* FIN header */}
              <th style={{
                padding: '4px 1px', textAlign: 'center',
                borderLeft: '2px solid var(--border)',
                position: 'sticky', top: 0, zIndex: 12,
                background: 'rgba(220,38,38,.07)', verticalAlign: 'middle',
              }}>
                <span style={{ fontSize: 7, fontWeight: 800, color: '#DC2626', fontFamily: "'DM Mono', monospace", writingMode: 'vertical-rl', transform: 'rotate(180deg)', lineHeight: 1 }}>FIN</span>
              </th>
            </tr>
          </thead>

          {/* ── Zone rows ── */}
          <tbody>
            {visZones.map((zone, zi) => {
              const prevZone  = visZones[zi - 1]
              const floorChange = zi > 0 && prevZone?.floor !== zone.floor
              const fc = getZoneFloorColor(zones, zone.floor)

              return (
                <tr key={zone.id} style={{
                  borderTop: floorChange ? `3px solid ${fc}` : undefined,
                  borderBottom: '1px solid var(--border)',
                  background: fc + '08',
                }}>
                  {/* Zone label */}
                  <td style={{
                    padding: isMulti ? '4px 3px' : '7px 6px',
                    borderRight: `3px solid ${fc}`,
                    verticalAlign: 'middle', textAlign: 'center',
                    height: isMulti ? 44 : 64,
                    background: fc + '14',
                  }}>
                    <span style={{ fontSize: isMulti ? 8.5 : 11, fontWeight: 900, color: fc, lineHeight: 1.12, fontFamily: "'DM Sans', sans-serif", letterSpacing: '.01em', textTransform: 'uppercase', wordBreak: 'normal', overflowWrap: 'anywhere', display: 'block' }}>
                      {zone.short}
                    </span>
                  </td>

                  {/* Day cells */}
                  {days.map((d, di) => {
                    const isFirstOfWeek = di > 0 && di % 7 === 0
                    const isCurrentDay  = d === today
                    const isDeadline    = zone.deadline === d
                    const lbl2 = dayLabel(d)
                    const isWeekend2 = lbl2.weekday === 'Sam' || lbl2.weekday === 'Dim'
                    const isHol2     = isHoliday(d)

                    let cellBg: string
                    if (isDeadline) {
                      cellBg = 'rgba(220,38,38,.18)'
                    } else if (isCurrentDay) {
                      cellBg = 'color-mix(in srgb, var(--primary) 5%, transparent)'
                    } else if (isHol2) {
                      cellBg = 'rgba(251,191,36,.15)'
                    } else if (isWeekend2) {
                      cellBg = 'var(--border)'
                    } else {
                      cellBg = 'transparent'
                    }

                    const cards  = interventions
                      .filter(iv => iv.zone === zone.id && isTaskActiveOn(iv, d) && !(iv.off_days?.includes(d)))
                      .sort((a, b) => {
                        const ap = a.priority ?? 3, bp = b.priority ?? 3
                        if (ap !== bp) return ap - bp
                        return (a.start_date ?? '').localeCompare(b.start_date ?? '')
                      })

                    return (
                      <td
                        key={d}
                        onClick={() => handleCellClick(zone.id, d)}
                        style={{
                          position: 'relative', overflow: 'hidden',
                          padding: isMulti ? 2 : 3,
                          height: isMulti ? 44 : 64,
                          verticalAlign: 'top',
                          borderLeft: `${isFirstOfWeek ? 2 : 1}px solid var(--border)`,
                          background: cellBg,
                          cursor: moveMode ? 'crosshair' : 'default',
                        }}
                      >
                        {cards.map(iv => (
                          <TaskBar
                            key={iv.id}
                            iv={iv}
                            trades={trades}
                            isMulti={isMulti}
                            weeks={weeks}
                            inMoveMode={!!moveMode}
                            dimmed={!!highlightCompany && iv.company !== highlightCompany}
                            onClick={() => {
                              if (!moveMode) setSelectedId(iv.id)
                            }}
                          />
                        ))}
                      </td>
                    )
                  })}

                  {/* Deadline cell */}
                  <DeadlineCell zone={zone} isMulti={isMulti} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* TaskDetail panel */}
      {selectedIv && (
        <TaskDetail
          iv={selectedIv}
          zones={zones}
          trades={trades}
          allInterventions={interventions}
          readOnly={readOnly}
          authorName={authorName}
          onClose={() => setSelectedId(null)}
          onUpdate={(patch) => {
            onUpdate(selectedIv.id, patch)
            setSelectedId(null)
          }}
          onStartMove={readOnly ? undefined : () => {
            setMoveMode({ iv: selectedIv, mode: 'move' })
            setSelectedId(null)
          }}
          onStartDuplicate={readOnly ? undefined : () => {
            setMoveMode({ iv: selectedIv, mode: 'dup' })
            setSelectedId(null)
          }}
        />
      )}

      {/* AddTask modal */}
      {showAdd && (
        <AddTaskModal
          zones={zones}
          trades={trades}
          companies={companies}
          defaultZone={addDefaults.zone}
          defaultDate={addDefaults.date}
          onClose={() => setShowAdd(false)}
          onAdd={onAdd}
        />
      )}
    </div>
  )
}

// ─── Task bar inside a cell ───────────────────────────────────────────────────

function TaskBar({ iv, trades, isMulti, weeks, inMoveMode, dimmed, onClick }: {
  iv: Intervention; trades: Trade[]; isMulti: boolean; weeks: number; inMoveMode: boolean; dimmed?: boolean; onClick: () => void
}) {
  const trade = trades.find(t => t.id === iv.trade)
  const tc    = getTradeColor(trade?.color ?? 'blue')
  const es    = effectiveStatus(iv)
  const sm    = STATUS_META[es]

  const baseStyle: React.CSSProperties = {
    opacity: inMoveMode ? 0.5 : dimmed ? 0.25 : 1,
    cursor:  inMoveMode ? 'crosshair' : 'pointer',
    filter:  dimmed ? 'grayscale(60%)' : undefined,
  }

  function handleClick(e: React.MouseEvent) {
    if (!inMoveMode) {
      e.stopPropagation()
      onClick()
    }
    // in move mode, let click propagate to the parent TD
  }

  const isLate = es === 'en_retard'
  const barBorder = isLate ? sm.dot : tc.b
  const barBg     = isLate ? 'rgba(234,88,12,.10)' : tc.bg

  if (isMulti) {
    return (
      <div onClick={handleClick} style={{
        ...baseStyle,
        borderRadius: 4, padding: weeks === 2 ? '3px 4px' : '2px 3px', marginBottom: 1,
        background: barBg, borderLeft: `3px solid ${barBorder}`, border: `1px solid ${barBorder}30`,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: weeks === 2 ? 8.5 : 7.5, fontWeight: 800, color: isLate ? sm.dot : tc.t, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.12, flex: 1 }}>
            {isLate ? '⏱ ' : ''}{iv.company || iv.task}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 4px', borderRadius: 999, background: sm.bg, color: sm.dot, fontSize: weeks === 2 ? 6.8 : 6.4, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', flexShrink: 0, border: `1px solid ${sm.dot}55` }}>
            <span style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: sm.dot, display: 'block' }} />
            {sm.label}
          </span>
        </div>
        {weeks <= 2 && (
          <div style={{ fontSize: weeks === 2 ? 7.8 : 7, color: isLate ? sm.dot : tc.t, opacity: .88, lineHeight: 1.16, overflow: 'hidden', fontWeight: 600 }}>{iv.task}</div>
        )}
      </div>
    )
  }

  // Single week — full card
  return (
    <div onClick={handleClick} style={{
      ...baseStyle,
      borderRadius: 8, marginBottom: 4,
      background: barBg, borderLeft: `3px solid ${barBorder}`,
      border: `1px solid ${barBorder}30`, padding: '4px 6px',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: isLate ? sm.dot : tc.t, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {isLate ? '⏱ ' : ''}{iv.company || '—'}
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: sm.dot, background: sm.bg, padding: '1px 5px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {sm.label}
        </span>
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color: tc.t, opacity: .88, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {iv.task}
      </div>
      {iv.task_number && (
        <div style={{ fontSize: 9, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace", marginTop: 2 }}>{iv.task_number}</div>
      )}
    </div>
  )
}

// ─── Deadline cell ────────────────────────────────────────────────────────────

function deadlineColor(deadline: string | null | undefined): string {
  if (!deadline) return 'var(--muted)'
  const today2 = new Date(); today2.setHours(0, 0, 0, 0)
  const d      = new Date(deadline + 'T00:00:00')
  const diff   = Math.round((d.getTime() - today2.getTime()) / 86400000)
  if (diff < 0)  return '#DC2626'
  if (diff < 14) return '#EA580C'
  if (diff < 30) return '#D97706'
  return '#16A34A'
}

function DeadlineCell({ zone, isMulti }: { zone: Zone; isMulti: boolean }) {
  if (!zone.deadline) {
    return (
      <td style={{ borderLeft: '2px solid var(--border)', verticalAlign: 'middle', textAlign: 'center', padding: 2 }}>
        <div style={{ fontSize: 8, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace" }}>—</div>
      </td>
    )
  }

  const dc   = deadlineColor(zone.deadline)
  const today3 = new Date(); today3.setHours(0, 0, 0, 0)
  const d    = new Date(zone.deadline + 'T00:00:00')
  const diff = Math.round((d.getTime() - today3.getTime()) / 86400000)
  const lbl  = diff < 0 ? `▲` : `J-${diff}`
  const ds2  = zone.deadline.slice(5, 10).replace('-', '/')

  return (
    <td style={{
      borderLeft: '2px solid var(--border)', verticalAlign: 'middle',
      textAlign: 'center', padding: isMulti ? '2px 1px' : '4px 3px',
      background: dc + '12',
    }}>
      <div style={{ fontSize: isMulti ? 7 : 8.5, fontWeight: 800, color: dc, fontFamily: "'DM Mono', monospace", lineHeight: 1.15, whiteSpace: 'nowrap' }}>
        {lbl}
      </div>
      <div style={{ fontSize: 6.5, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace", marginTop: 2, lineHeight: 1 }}>
        {ds2}
      </div>
    </td>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)',
}

