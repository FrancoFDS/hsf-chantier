'use client'

import { useEffect, useState, useCallback } from 'react'
import type { Intervention, Zone, Trade, Company, Status, TaskChangeRequest } from '@/types/database'
import { effectiveStatus } from '@/lib/progress'
import { STATUS_META, STATUS_OPTIONS } from '@/constants/status'
import { getTradeColor, getZoneFloorColor } from '@/constants/colors'
import { fmtDate, daysOverdue, addDays, daysBetween } from '@/lib/dates'
import { supabase } from '@/lib/supabase'
import { NoteFormModal } from './NotesScreen'
import ChangeRequestPanel, { type ChangeRequestSession, type ReviewAction } from './ChangeRequestPanel'
import type { TaskChangeForm } from '@/constants/changeRequests'
import { changedFieldsFromForm } from '@/lib/changeRequests'

interface NoteEntry {
  id: string
  content: string
  author_name: string
  created_at: string
}

interface TaskNoteSummary {
  id: string
  title: string | null
  content: string
  author_name: string
  created_at: string
}

interface Props {
  iv: Intervention
  zones: Zone[]
  trades: Trade[]
  companies?: Company[]
  allInterventions: Intervention[]
  readOnly?: boolean
  authorName?: string
  userRole?: 'admin' | 'company' | 'external'
  userCompany?: string | null
  onClose: () => void
  onUpdate: (patch: Partial<Intervention>) => void
  onStartMove?: () => void
  onStartDuplicate?: () => void
  onOpenNote?: (noteId: string) => void
  onOpenTask?: (taskId: string) => void
  onUpdateOther?: (id: string, patch: Partial<Intervention>) => void
  onStartPlanningPick?: (kind: 'predecessor' | 'successor') => void
}

export default function TaskDetail({ iv, zones, trades, companies = [], allInterventions, readOnly, authorName, userRole = 'admin', userCompany = null, onClose, onUpdate, onStartMove, onStartDuplicate, onOpenNote, onOpenTask, onUpdateOther, onStartPlanningPick }: Props) {
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [showNotesList, setShowNotesList] = useState(false)
  const [taskNotes, setTaskNotes] = useState<TaskNoteSummary[]>([])
  const [noteCount,    setNoteCount]    = useState<number | null>(null)

  useEffect(() => {
    supabase
      .from('notes')
      .select('id, title, content, author_name, created_at')
      .eq('intervention_id', iv.id)
      .is('deleted_at', null)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          if ((error as { code?: string }).code === '42703') {
            supabase.from('notes').select('id, title, content, author_name, created_at').eq('intervention_id', iv.id).order('created_at', { ascending: false }).then(({ data: d2 }) => {
              const rows = (d2 ?? []) as TaskNoteSummary[]
              setTaskNotes(rows); setNoteCount(rows.length)
            })
          }
          return
        }
        const rows = (data ?? []) as TaskNoteSummary[]
        setTaskNotes(rows); setNoteCount(rows.length)
      })
  }, [iv.id])
  const [saving, setSaving]   = useState(false)
  const [editing, setEditing] = useState(false)
  const [status, setStatus]   = useState<Status>(iv.status as Status)
  const [notes, setNotes]     = useState(iv.notes ?? '')

  // History notes
  const [notesList, setNotesList]   = useState<NoteEntry[]>([])
  const [newNote, setNewNote]       = useState('')
  const [addingNote, setAddingNote] = useState(false)

  useEffect(() => {
    supabase
      .from('intervention_notes')
      .select('*')
      .eq('intervention_id', iv.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (data) setNotesList(data as NoteEntry[]) })
  }, [iv.id])

  // ─── Change requests ───
  const [changeRequests, setChangeRequests] = useState<TaskChangeRequest[]>([])
  const [crBusy, setCrBusy] = useState(false)

  useEffect(() => {
    supabase
      .from('task_change_requests')
      .select('*')
      .eq('task_id', iv.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setChangeRequests(data as TaskChangeRequest[]) })
  }, [iv.id])

  const session: ChangeRequestSession =
    userRole === 'admin'
      ? { role: 'admin',    company_name: null,                user_name: authorName ?? null }
      : userRole === 'company'
      ? { role: 'company',  company_name: userCompany ?? '',   user_name: authorName ?? null }
      : { role: 'external', company_name: userCompany ?? null, user_name: authorName ?? null }

  const handleSubmitChangeRequest = useCallback(async (target: Intervention, form: TaskChangeForm) => {
    if (session.role !== 'company' || session.company_name !== target.company) {
      throw new Error('Vous ne pouvez modifier que les tâches de votre entreprise.')
    }
    if (!target.company_edit_allowed) {
      throw new Error('Cette tâche n’a pas été ouverte à modification par l’admin.')
    }
    if (changeRequests.some(r => r.status === 'pending_admin')) {
      throw new Error('Une demande est déjà en attente sur cette tâche.')
    }
    const changed = changedFieldsFromForm(target, form)
    if (!changed.length) throw new Error('Aucune modification détectée.')

    setCrBusy(true)
    try {
      const nowIso = new Date().toISOString()
      const row = {
        task_id: target.id,
        task_number: target.task_number || '',
        task_company: target.company || '',
        requested_by_company: session.company_name,
        requested_by_contact: session.user_name ?? '',
        status: 'pending_admin' as const,
        old_start_date: target.start_date || null,
        old_end_date:   target.end_date   || target.start_date || null,
        old_task:       target.task       || '',
        old_prereq:     target.prereq     || '',
        old_notes:      target.notes      || '',
        new_start_date: form.start || null,
        new_end_date:   form.end   || form.start || null,
        new_task:       form.task   || '',
        new_prereq:     form.prereq || '',
        new_notes:      form.notes  || '',
        created_at: nowIso,
        updated_at: nowIso,
        payload: {
          changed_fields: changed.map(c => c.key),
          company_edit_allowed: !!target.company_edit_allowed,
          company_edit_start_min: target.company_edit_start_min ?? null,
          company_edit_end_max:   target.company_edit_end_max   ?? null,
        },
      }
      const { data, error } = await supabase
        .from('task_change_requests')
        .insert(row)
        .select()
        .single()
      if (error) throw new Error(error.message)
      if (data) setChangeRequests(prev => [data as TaskChangeRequest, ...prev])

      // Notif → admin
      await supabase.from('notifications').insert({
        recipient_role: 'admin',
        intervention_id: target.id,
        task_name: target.task,
        message: `Modification demandée par ${session.company_name} · ${target.task_number || target.task}`,
      })
    } finally {
      setCrBusy(false)
    }
  }, [session, changeRequests])

  const handleReviewChangeRequest = useCallback(async (
    req: TaskChangeRequest,
    action: ReviewAction,
    form: TaskChangeForm,
    comment: string,
  ) => {
    if (session.role !== 'admin') throw new Error('Action réservée à l’admin.')
    setCrBusy(true)
    try {
      const nowIso = new Date().toISOString()
      const isRefuse = action === 'refuse'
      const newStatus = action === 'refuse' ? 'refused' : action === 'adjust' ? 'adjusted_accepted' : 'accepted'
      const patch = {
        status: newStatus,
        admin_decision: action,
        admin_comment: comment || null,
        reviewed_by: session.user_name ?? 'Admin',
        reviewed_at: nowIso,
        final_start_date: isRefuse ? null : (form.start || null),
        final_end_date:   isRefuse ? null : (form.end   || form.start || null),
        final_task:       isRefuse ? null : (form.task   || ''),
        final_prereq:     isRefuse ? null : (form.prereq || ''),
        final_notes:      isRefuse ? null : (form.notes  || ''),
        updated_at: nowIso,
      }
      const { data, error } = await supabase
        .from('task_change_requests')
        .update(patch)
        .eq('id', req.id)
        .select()
        .single()
      if (error) throw new Error(error.message)
      if (data) setChangeRequests(prev => prev.map(r => r.id === req.id ? (data as TaskChangeRequest) : r))

      if (!isRefuse) {
        const ivPatch: Partial<Intervention> = {
          start_date: form.start || null,
          end_date:   form.end   || form.start || null,
          task:       form.task   || iv.task,
          prereq:     form.prereq || '',
          notes:      form.notes  || '',
        }
        const { error: e2 } = await supabase.from('interventions').update(ivPatch).eq('id', iv.id)
        if (!e2) onUpdate(ivPatch)
      }

      // Notif → entreprise demandeuse
      const label = action === 'accept' ? 'acceptée' : action === 'adjust' ? 'ajustée puis validée' : 'refusée'
      if (req.requested_by_company) {
        await supabase.from('notifications').insert({
          recipient_role: 'company',
          recipient_company: req.requested_by_company,
          intervention_id: iv.id,
          task_name: iv.task,
          message: `Votre demande de modification a été ${label}${comment ? ' · ' + comment : ''}`,
        })
      }
    } finally {
      setCrBusy(false)
    }
  }, [session, iv.id, iv.task, onUpdate])

  // Edit-mode fields
  const [editTask,      setEditTask]      = useState(iv.task ?? '')
  const [editZone,      setEditZone]      = useState(iv.zone ?? '')
  const [editTrade,     setEditTrade]     = useState(iv.trade ?? '')
  const [editCompany,   setEditCompany]   = useState(iv.company ?? '')
  const [editStartDate, setEditStartDate] = useState(iv.start_date ?? '')
  const [editEndDate,   setEditEndDate]   = useState(iv.end_date ?? '')
  const [editOffDays,   setEditOffDays]   = useState<string[]>(iv.off_days ?? [])
  const [newOffDay,     setNewOffDay]     = useState('')
  const [editCEAllowed, setEditCEAllowed] = useState<boolean>(!!iv.company_edit_allowed)
  const [editCEMin,     setEditCEMin]     = useState<string>(iv.company_edit_start_min ?? '')
  const [editCEMax,     setEditCEMax]     = useState<string>(iv.company_edit_end_max   ?? '')

  const zone  = zones.find(z => z.id === (editing ? editZone : iv.zone))
  const trade = trades.find(t => t.id === (editing ? editTrade : iv.trade))
  const tc    = getTradeColor(trade?.color ?? 'blue')
  const es    = effectiveStatus(iv)
  const sm    = STATUS_META[es]
  const zoneColor = zone ? getZoneFloorColor(zones, zone.floor) : '#9CA3AF'

  const predecessorIds = (iv.predecessor_ids && iv.predecessor_ids.length > 0)
    ? iv.predecessor_ids
    : (iv.predecessor_id ? [iv.predecessor_id] : [])
  const predecessors = predecessorIds.map(id => allInterventions.find(x => x.id === id)).filter(Boolean) as Intervention[]
  const successors   = (iv.successor_ids ?? []).map(id => allInterventions.find(x => x.id === id)).filter(Boolean) as Intervention[]
  const predecessor  = predecessors[0] ?? null

  const [showLinkPicker, setShowLinkPicker] = useState<'predecessor' | 'successor' | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)

  const canEditLinks = userRole === 'admin' && !readOnly

  async function handleAddLink(otherId: string, kind: 'predecessor' | 'successor') {
    setLinkBusy(true)
    try {
      // Current task : add otherId to its predecessor_ids or successor_ids
      const currentList = kind === 'predecessor'
        ? Array.from(new Set([...(iv.predecessor_ids ?? []), otherId]))
        : Array.from(new Set([...(iv.successor_ids ?? []),   otherId]))
      const ivPatch: Partial<Intervention> = kind === 'predecessor'
        ? { predecessor_ids: currentList }
        : { successor_ids:   currentList }
      const { error: e1 } = await supabase.from('interventions').update(ivPatch).eq('id', iv.id)
      if (!e1) onUpdateOther?.(iv.id, ivPatch)

      // Other task : add iv.id to the reciprocal array
      const other = allInterventions.find(x => x.id === otherId)
      if (other) {
        const otherList = kind === 'predecessor'
          ? Array.from(new Set([...(other.successor_ids   ?? []), iv.id]))
          : Array.from(new Set([...(other.predecessor_ids ?? []), iv.id]))
        const otherPatch: Partial<Intervention> = kind === 'predecessor'
          ? { successor_ids:   otherList }
          : { predecessor_ids: otherList }
        const { error: e2 } = await supabase.from('interventions').update(otherPatch).eq('id', otherId)
        if (!e2) onUpdateOther?.(otherId, otherPatch)
      }
    } finally {
      setLinkBusy(false)
      setShowLinkPicker(null)
    }
  }

  async function handleRemoveLink(otherId: string, kind: 'predecessor' | 'successor') {
    setLinkBusy(true)
    try {
      const currentList = kind === 'predecessor'
        ? (iv.predecessor_ids ?? []).filter(id => id !== otherId)
        : (iv.successor_ids   ?? []).filter(id => id !== otherId)
      const ivPatch: Partial<Intervention> = kind === 'predecessor'
        ? { predecessor_ids: currentList, ...(iv.predecessor_id === otherId ? { predecessor_id: null } : {}) }
        : { successor_ids:   currentList }
      const { error: e1 } = await supabase.from('interventions').update(ivPatch).eq('id', iv.id)
      if (!e1) onUpdateOther?.(iv.id, ivPatch)

      const other = allInterventions.find(x => x.id === otherId)
      if (other) {
        const otherList = kind === 'predecessor'
          ? (other.successor_ids   ?? []).filter(id => id !== iv.id)
          : (other.predecessor_ids ?? []).filter(id => id !== iv.id)
        const otherPatch: Partial<Intervention> = kind === 'predecessor'
          ? { successor_ids:   otherList }
          : { predecessor_ids: otherList, ...(other.predecessor_id === iv.id ? { predecessor_id: null } : {}) }
        const { error: e2 } = await supabase.from('interventions').update(otherPatch).eq('id', otherId)
        if (!e2) onUpdateOther?.(otherId, otherPatch)
      }
    } finally {
      setLinkBusy(false)
    }
  }

  const hasChanges = editing
    ? editTask !== (iv.task ?? '') || editZone !== (iv.zone ?? '') || editTrade !== (iv.trade ?? '') ||
      editCompany !== (iv.company ?? '') || editStartDate !== (iv.start_date ?? '') || editEndDate !== (iv.end_date ?? '') ||
      JSON.stringify(editOffDays.slice().sort()) !== JSON.stringify((iv.off_days ?? []).slice().sort()) ||
      editCEAllowed !== !!iv.company_edit_allowed ||
      editCEMin !== (iv.company_edit_start_min ?? '') ||
      editCEMax !== (iv.company_edit_end_max ?? '') ||
      status !== iv.status || notes !== (iv.notes ?? '')
    : status !== iv.status || notes !== (iv.notes ?? '')

  function handleTradeChange(newTradeId: string) {
    setEditTrade(newTradeId)
    const firstCompany = trades.find(t => t.id === newTradeId)
    if (firstCompany) setEditCompany('')
  }

  const [pendingCascade, setPendingCascade] = useState<{ delta: number; patch: Partial<Intervention> } | null>(null)
  const [cascadeBusy, setCascadeBusy] = useState(false)

  const [justSaved, setJustSaved] = useState(false)

  async function handleSave() {
    if (!hasChanges) return
    setSaving(true)
    const patch: Partial<Intervention> = editing
      ? {
          status, notes, task: editTask, zone: editZone, trade: editTrade, company: editCompany,
          start_date: editStartDate || null, end_date: editEndDate || null, off_days: editOffDays,
          company_edit_allowed:   editCEAllowed,
          company_edit_start_min: editCEAllowed ? (editCEMin || null) : null,
          company_edit_end_max:   editCEAllowed ? (editCEMax || null) : null,
        }
      : { status, notes }
    const { error } = await supabase.from('interventions').update(patch).eq('id', iv.id)
    setSaving(false)
    if (error) return

    // Detect a date shift that should propagate to successors
    let deltaDays = 0
    if (editing && iv.start_date && editStartDate && iv.start_date !== editStartDate) {
      deltaDays = daysBetween(iv.start_date, editStartDate)
    }
    if (canEditLinks && deltaDays !== 0 && successors.length > 0) {
      setEditing(false)
      onUpdateOther?.(iv.id, patch)
      setPendingCascade({ delta: deltaDays, patch })
      return
    }
    setEditing(false)
    setJustSaved(true)
    onUpdateOther?.(iv.id, patch)
    setTimeout(() => onClose(), 800)
  }

  async function applyCascade(delta: number) {
    setCascadeBusy(true)
    try {
      const visited = new Set<string>([iv.id])
      const queue: Intervention[] = [...successors]
      const updates: { id: string; patch: Partial<Intervention> }[] = []
      while (queue.length > 0) {
        const cur = queue.shift()!
        if (visited.has(cur.id)) continue
        visited.add(cur.id)
        const newStart = cur.start_date ? addDays(cur.start_date, delta) : null
        const newEnd   = cur.end_date   ? addDays(cur.end_date,   delta) : newStart
        updates.push({ id: cur.id, patch: { start_date: newStart, end_date: newEnd } })
        for (const sid of (cur.successor_ids ?? [])) {
          const nextSucc = allInterventions.find(x => x.id === sid)
          if (nextSucc && !visited.has(nextSucc.id)) queue.push(nextSucc)
        }
      }
      for (const u of updates) {
        const { error } = await supabase.from('interventions').update(u.patch).eq('id', u.id)
        if (!error) onUpdateOther?.(u.id, u.patch)
      }
    } finally {
      setCascadeBusy(false)
    }
  }

  const canAddNote = !readOnly || (!!authorName && iv.company === authorName)

  async function handleAddNote() {
    if (!newNote.trim()) return
    setAddingNote(true)
    const entry = { intervention_id: iv.id, content: newNote.trim(), author_name: authorName ?? 'Anonyme' }
    const { data, error } = await supabase.from('intervention_notes').insert(entry).select().single()
    if (!error && data) {
      setNotesList(prev => [...prev, data as NoteEntry])
      setNewNote('')
      // Notifications
      if (readOnly && iv.company) {
        await supabase.from('notifications').insert({
          recipient_role: 'admin',
          intervention_id: iv.id,
          task_name: iv.task,
          message: `${authorName} a ajouté une note sur « ${iv.task} »`,
        })
      } else if (!readOnly && iv.company) {
        await supabase.from('notifications').insert({
          recipient_role: 'company',
          recipient_company: iv.company,
          intervention_id: iv.id,
          task_name: iv.task,
          message: `Nouvelle note sur « ${iv.task} »`,
        })
      }
    }
    setAddingNote(false)
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
            {!readOnly && <button onClick={() => setEditing(e => !e)} style={{ border: `1px solid ${editing ? 'var(--primary)' : 'var(--border)'}`, background: editing ? 'var(--primary-l)' : 'var(--surface-2)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 13, color: editing ? 'var(--primary)' : 'var(--muted)' }}>✎</button>}
            <button
              onClick={() => { if (noteCount && noteCount > 0) setShowNotesList(true); else setShowNoteForm(true) }}
              title={noteCount && noteCount > 0 ? `${noteCount} note${noteCount > 1 ? 's' : ''} sur cette tâche — cliquer pour voir` : 'Créer une note sur cette tâche'}
              style={{
                position: 'relative',
                border: '1px solid #DDD6FE',
                background: '#F5F3FF',
                borderRadius: 8, width: 32, height: 32, cursor: 'pointer',
                fontSize: 14, color: '#5B21B6',
              }}
            >
              📝
              {noteCount !== null && noteCount > 0 && (
                <span style={{
                  position: 'absolute', top: -5, right: -5,
                  background: '#7C3AED', color: '#fff', borderRadius: 99,
                  fontSize: 9, fontWeight: 800, minWidth: 16, height: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                  border: '1.5px solid var(--surface)',
                }}>{noteCount > 9 ? '9+' : noteCount}</span>
              )}
            </button>
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

          {/* Dependency alerts */}
          <DependencyAlerts iv={iv} predecessors={predecessors} successors={successors} />


          {/* Prereq */}
          {iv.prereq?.trim() && (
            <div style={{ background: '#FEF2F2', border: '1px solid rgba(220,38,38,.25)', borderLeft: '3px solid #DC2626', borderRadius: 'var(--r-xs)', padding: '8px 10px', marginBottom: 10, fontSize: 12, color: '#991B1B' }}>
              ⚠ Prérequis : {iv.prereq}{iv.prereq_company ? ` · ${iv.prereq_company}` : ''}
            </div>
          )}

          {/* Dependencies */}
          {(canEditLinks || predecessors.length > 0 || successors.length > 0) && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                Dépendances
              </div>

              <DepGroup
                label="Cette tâche commence après"
                items={predecessors}
                zones={zones} trades={trades}
                onOpen={onOpenTask}
                onRemove={canEditLinks ? (id) => handleRemoveLink(id, 'predecessor') : undefined}
                onAdd={canEditLinks ? () => setShowLinkPicker('predecessor') : undefined}
                addLabel="+ Ajouter un prédécesseur"
                busy={linkBusy}
              />
              <DepGroup
                label="Cette tâche est suivie par"
                items={successors}
                zones={zones} trades={trades}
                onOpen={onOpenTask}
                onRemove={canEditLinks ? (id) => handleRemoveLink(id, 'successor') : undefined}
                onAdd={canEditLinks ? () => setShowLinkPicker('successor') : undefined}
                addLabel="+ Ajouter un successeur"
                busy={linkBusy}
              />
            </div>
          )}

          {/* Off days */}
          {(editing || (iv.off_days && iv.off_days.length > 0)) && (
            <InfoRow label="Jours gelés">
              {editing ? (
                <div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: editOffDays.length > 0 ? 8 : 0 }}>
                    {editOffDays.sort().map(d => (
                      <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 20, padding: '3px 8px', fontSize: 12, color: '#991B1B' }}>
                        {fmtDate(d)}
                        <button onClick={() => setEditOffDays(prev => prev.filter(x => x !== d))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="date" value={newOffDay} onChange={e => setNewOffDay(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                    <button
                      onClick={() => { if (newOffDay && !editOffDays.includes(newOffDay)) { setEditOffDays(prev => [...prev, newOffDay]); setNewOffDay('') } }}
                      style={{ padding: '7px 14px', borderRadius: 'var(--r-xs)', border: '1px solid var(--primary)', background: 'var(--primary-l)', color: 'var(--primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    >+ Ajouter</button>
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--danger)' }}>
                  {iv.off_days!.map(d => fmtDate(d)).join(', ')}
                </span>
              )}
            </InfoRow>
          )}

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0 14px' }} />

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
              {/* Modification entreprise (Change Requests) */}
              <div style={{ border: '1px dashed var(--border)', borderRadius: 'var(--r-sm)', padding: 10, background: 'var(--surface-2)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editCEAllowed}
                    onChange={e => setEditCEAllowed(e.target.checked)}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                    Autoriser l’entreprise à demander une modification
                  </span>
                </label>
                {editCEAllowed && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    <div>
                      <label style={labelStyle}>Au plus tôt</label>
                      <input type="date" value={editCEMin} max={editCEMax || undefined} onChange={e => setEditCEMin(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Au plus tard</label>
                      <input type="date" value={editCEMax} min={editCEMin || undefined} onChange={e => setEditCEMax(e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
                  Si activé, l’entreprise verra un bouton « Demander une modification » sur cette tâche. Les dates min/max bornent les dates proposables.
                </div>
              </div>

              <div>
                <label style={labelStyle}>Note interne</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', marginTop: 4 }}
                  placeholder="Note interne (admin)…"
                />
              </div>
            </div>
          )}

          {/* Change requests */}
          <ChangeRequestPanel
            iv={iv}
            requests={changeRequests}
            session={session}
            busy={crBusy}
            onSubmit={handleSubmitChangeRequest}
            onReview={handleReviewChangeRequest}
          />

          {/* Statut */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Statut</label>
            {readOnly ? (
              <div style={{ marginTop: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: sm.dot, background: sm.bg, padding: '4px 12px', borderRadius: 20, border: `1px solid ${sm.dot}40` }}>
                  {sm.label}
                </span>
              </div>
            ) : (
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
                    >{m.label}</button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Notes historique */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes & suivi</label>

            {/* Historique */}
            {notesList.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, marginBottom: 10 }}>
                {notesList.map(n => (
                  <div key={n.id} style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${tc.b}`,
                    borderRadius: 'var(--r-xs)',
                    padding: '9px 11px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: tc.b }}>{n.author_name}</span>
                      <span style={{ fontSize: 10, color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace" }}>
                        {new Date(n.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, fontWeight: 500 }}>
                      {n.content}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Formulaire ajout — seulement si autorisé */}
            {canAddNote && <div style={{
              background: 'var(--surface-2)',
              border: `1px solid ${newNote.trim() ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 'var(--r-xs)',
              padding: '10px 12px',
              transition: 'border-color .15s',
            }}>
              <textarea
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                rows={2}
                placeholder="Ajouter une note ou un commentaire…"
                style={{
                  width: '100%', border: 'none', background: 'transparent',
                  color: 'var(--text)', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                  resize: 'none', outline: 'none', lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
              />
              {newNote.trim() && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    onClick={handleAddNote}
                    disabled={addingNote}
                    style={{
                      padding: '6px 16px', borderRadius: 'var(--r-xs)', border: 'none',
                      background: 'var(--primary)', color: '#fff',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}
                  >{addingNote ? 'Envoi…' : 'Publier'}</button>
                </div>
              )}
            </div>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          {!readOnly && (onStartMove || onStartDuplicate) && (
            <div style={{ display: 'flex', gap: 8 }}>
              {onStartMove && (
                <button onClick={onStartMove} style={{ flex: 1, padding: '9px 0', borderRadius: 'var(--r-sm)', border: '1px solid #3B82F6', background: '#EFF6FF', color: '#1D4ED8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  ↕ Déplacer
                </button>
              )}
              {onStartDuplicate && (
                <button onClick={onStartDuplicate} style={{ flex: 1, padding: '9px 0', borderRadius: 'var(--r-sm)', border: '1px solid #22C55E', background: '#F0FDF4', color: '#15803D', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  ⊕ Dupliquer
                </button>
              )}
            </div>
          )}
          {readOnly ? (
            <button onClick={onClose} style={{ padding: '11px 0', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Fermer
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges || saving || justSaved}
                style={{
                  flex: 2, padding: '11px 0', borderRadius: 'var(--r-sm)', border: 'none',
                  background: justSaved ? 'var(--success, #16A34A)' : hasChanges ? 'var(--primary)' : 'var(--border)',
                  color: justSaved || hasChanges ? '#fff' : 'var(--muted)',
                  fontSize: 14, fontWeight: 700,
                  cursor: (saving || justSaved || !hasChanges) ? 'default' : 'pointer',
                  transition: 'background .15s',
                }}
              >{justSaved ? '✓ Enregistré' : saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          )}
        </div>
      </div>

      {showNoteForm && (
        <NoteFormModal
          mode="intervention"
          iv={iv}
          zones={zones}
          trades={trades}
          companies={companies}
          authorName={authorName ?? 'Admin'}
          onClose={() => setShowNoteForm(false)}
        />
      )}

      {showNotesList && (
        <TaskNotesPicker
          notes={taskNotes}
          onClose={() => setShowNotesList(false)}
          onPick={(id) => {
            setShowNotesList(false)
            if (onOpenNote) { onOpenNote(id); onClose() }
          }}
          onCreate={() => { setShowNotesList(false); setShowNoteForm(true) }}
          canOpenDetail={!!onOpenNote}
        />
      )}

      {showLinkPicker && (
        <TaskDependencyPicker
          kind={showLinkPicker}
          currentIv={iv}
          allInterventions={allInterventions}
          zones={zones}
          trades={trades}
          onClose={() => setShowLinkPicker(null)}
          onPick={(otherId) => handleAddLink(otherId, showLinkPicker)}
          onStartPlanningPick={onStartPlanningPick ? (k) => { setShowLinkPicker(null); onStartPlanningPick(k) } : undefined}
        />
      )}

      {pendingCascade && (
        <CascadeShiftModal
          deltaDays={pendingCascade.delta}
          successors={successors}
          busy={cascadeBusy}
          onCancel={() => { setPendingCascade(null); onClose() }}
          onConfirm={async () => {
            await applyCascade(pendingCascade.delta)
            setPendingCascade(null)
            onClose()
          }}
        />
      )}
    </>
  )
}

function TaskNotesPicker({ notes, onClose, onPick, onCreate, canOpenDetail }: {
  notes: TaskNoteSummary[]
  onClose: () => void
  onPick: (id: string) => void
  onCreate: () => void
  canOpenDetail: boolean
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 110, backdropFilter: 'blur(2px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 111,
        background: 'var(--surface)', borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,.18)',
        maxHeight: '75vh', display: 'flex', flexDirection: 'column',
        animation: 'slideUp .22s ease-out',
      }}>
        <div style={{ padding: '12px 0 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Notes sur cette tâche ({notes.length})
          </span>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--surface-2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 16px' }}>
          {notes.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>Aucune note pour cette tâche.</div>
          ) : notes.map(n => (
            <div key={n.id}
              onClick={() => onPick(n.id)}
              title={canOpenDetail ? 'Cliquer pour ouvrir le détail' : 'Détail des notes accessible depuis l’écran Notes'}
              style={{
                padding: '11px 12px', marginBottom: 8, borderRadius: 'var(--r)',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderLeft: '3px solid #7C3AED',
                cursor: canOpenDetail ? 'pointer' : 'default',
              }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, marginBottom: 3 }}>
                {n.title || (n.content?.slice(0, 80) ?? '—')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'DM Mono', monospace" }}>
                {n.author_name} · {new Date(n.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
          <button
            onClick={onCreate}
            style={{
              width: '100%', marginTop: 8, padding: '11px',
              borderRadius: 'var(--r-sm)', border: '1px dashed var(--primary)',
              background: 'transparent', color: 'var(--primary)',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>
            + Créer une nouvelle note sur cette tâche
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

function DepBadge({ iv, zones, trades, onOpen, onRemove, busy }: {
  iv: Intervention; zones: Zone[]; trades: Trade[]
  onOpen?: (id: string) => void
  onRemove?: (id: string) => void
  busy?: boolean
}) {
  void trades; void zones
  const es = effectiveStatus(iv)
  const sm = STATUS_META[es]
  const clickable = !!onOpen
  return (
    <div
      onClick={clickable ? () => onOpen!(iv.id) : undefined}
      title={clickable ? 'Ouvrir cette tâche' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
        color: 'var(--text)', background: 'var(--surface-2)',
        borderRadius: 6, padding: '5px 8px', border: '1px solid var(--border)',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: sm.dot, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontWeight: 600 }}>{iv.task_number ?? iv.id}</span>
      <span style={{ color: 'var(--muted)' }}>{iv.task?.slice(0, 36)}{(iv.task?.length ?? 0) > 36 ? '…' : ''}</span>
      {iv.company && <span style={{ color: 'var(--xmuted)', fontFamily: "'DM Mono', monospace", fontSize: 10 }}>· {iv.company}</span>}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(iv.id) }}
          disabled={busy}
          title="Retirer ce lien"
          style={{ marginLeft: 4, border: 'none', background: 'transparent', color: 'var(--xmuted)', cursor: busy ? 'wait' : 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
        >×</button>
      )}
    </div>
  )
}

function DepGroup({ label, items, zones, trades, onOpen, onRemove, onAdd, addLabel, busy }: {
  label: string
  items: Intervention[]
  zones: Zone[]; trades: Trade[]
  onOpen?: (id: string) => void
  onRemove?: (id: string) => void
  onAdd?: () => void
  addLabel: string
  busy?: boolean
}) {
  if (items.length === 0 && !onAdd) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {items.map(it => (
            <DepBadge key={it.id} iv={it} zones={zones} trades={trades} onOpen={onOpen} onRemove={onRemove} busy={busy} />
          ))}
        </div>
      )}
      {onAdd && (
        <button
          onClick={onAdd}
          disabled={busy}
          style={{
            padding: '6px 10px', borderRadius: 'var(--r-xs)',
            border: '1px dashed var(--primary)', background: 'transparent',
            color: 'var(--primary)', fontSize: 12, fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {addLabel}
        </button>
      )}
    </div>
  )
}

function DependencyAlerts({ iv, predecessors, successors }: {
  iv: Intervention
  predecessors: Intervention[]
  successors: Intervention[]
}) {
  const ivStart = iv.start_date
  const ivEnd   = iv.end_date || iv.start_date
  const ivStarted = iv.status === 'encours' || iv.status === 'termine'

  const alerts: { kind: 'pred_not_done' | 'pred_overlap' | 'succ_too_early'; msg: string }[] = []

  for (const p of predecessors) {
    const pEnd = p.end_date || p.start_date
    if (ivStarted && p.status !== 'termine') {
      alerts.push({
        kind: 'pred_not_done',
        msg: `Le prédécesseur ${p.task_number ?? ''} ${p.task ?? ''} n’est pas marqué terminé.`,
      })
    }
    if (ivStart && pEnd && pEnd > ivStart) {
      alerts.push({
        kind: 'pred_overlap',
        msg: `Cette tâche démarre le ${fmtDate(ivStart)} alors que ${p.task_number ?? p.task} se termine le ${fmtDate(pEnd)}.`,
      })
    }
  }
  for (const s of successors) {
    const sStart = s.start_date
    if (ivEnd && sStart && sStart < ivEnd) {
      alerts.push({
        kind: 'succ_too_early',
        msg: `Le successeur ${s.task_number ?? s.task} démarre le ${fmtDate(sStart)}, avant la fin de cette tâche (${fmtDate(ivEnd)}).`,
      })
    }
  }

  if (alerts.length === 0) return null

  return (
    <div style={{ marginBottom: 12 }}>
      {alerts.map((a, i) => (
        <div key={i} style={{
          background: 'rgba(234,88,12,.08)', border: '1px solid rgba(234,88,12,.3)',
          borderLeft: '3px solid #EA580C', borderRadius: 'var(--r-xs)',
          padding: '8px 10px', marginBottom: 6, fontSize: 12, color: '#9A3412',
          lineHeight: 1.4,
        }}>
          ⚠ {a.msg}
        </div>
      ))}
    </div>
  )
}

function CascadeShiftModal({ deltaDays, successors, busy, onCancel, onConfirm }: {
  deltaDays: number
  successors: Intervention[]
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const sign = deltaDays > 0 ? '+' : ''
  return (
    <>
      <div onClick={busy ? undefined : onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 120, backdropFilter: 'blur(2px)' }} />
      <div style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 121, background: 'var(--surface)', borderRadius: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,.24)', maxWidth: 460, width: '92%',
        padding: 16,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
          Décaler les tâches dépendantes ?
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>
          Cette tâche a été déplacée de <b>{sign}{deltaDays} jour{Math.abs(deltaDays) > 1 ? 's' : ''}</b>.
          Voulez-vous appliquer le même décalage aux {successors.length} tâche{successors.length > 1 ? 's' : ''} successeur{successors.length > 1 ? 's' : ''} ?
        </div>
        <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 12, background: 'var(--surface-2)', borderRadius: 6, padding: 8 }}>
          {successors.map(s => (
            <div key={s.id} style={{ fontSize: 12, color: 'var(--text)', padding: '3px 0' }}>
              <span style={{ fontFamily: "'DM Mono', monospace", color: 'var(--xmuted)', fontSize: 11, marginRight: 6 }}>{s.task_number}</span>
              {s.task} <span style={{ color: 'var(--muted)' }}>· {s.company}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button onClick={onCancel} disabled={busy}
            style={{ padding: '10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
            Non, garder les dates
          </button>
          <button onClick={onConfirm} disabled={busy}
            style={{ padding: '10px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
            Oui, décaler
          </button>
        </div>
      </div>
    </>
  )
}

function TaskDependencyPicker({ kind, currentIv, allInterventions, zones, trades, onClose, onPick, onStartPlanningPick }: {
  kind: 'predecessor' | 'successor'
  currentIv: Intervention
  allInterventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  onClose: () => void
  onPick: (otherId: string) => void
  onStartPlanningPick?: (kind: 'predecessor' | 'successor') => void
}) {
  const [q, setQ] = useState('')
  const [zoneFilt, setZoneFilt] = useState<string>('')
  const [tradeFilt, setTradeFilt] = useState<string>('')

  // Exclude self + already-linked
  const excluded = new Set<string>([
    currentIv.id,
    ...(currentIv.predecessor_ids ?? []),
    ...(currentIv.successor_ids   ?? []),
    ...(currentIv.predecessor_id ? [currentIv.predecessor_id] : []),
  ])

  const ql = q.trim().toLowerCase()
  const list = allInterventions
    .filter(t => !excluded.has(t.id))
    .filter(t => !zoneFilt  || t.zone  === zoneFilt)
    .filter(t => !tradeFilt || t.trade === tradeFilt)
    .filter(t => !ql || (t.task_number ?? '').toLowerCase().includes(ql) || (t.task ?? '').toLowerCase().includes(ql) || (t.company ?? '').toLowerCase().includes(ql))
    .slice(0, 80)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 110, backdropFilter: 'blur(2px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 111,
        background: 'var(--surface)', borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,.18)',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        animation: 'slideUp .22s ease-out',
      }}>
        <div style={{ padding: '12px 0 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {kind === 'predecessor' ? 'Ajouter un prédécesseur' : 'Ajouter un successeur'}
          </span>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--surface-2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
        </div>

        <div style={{ padding: '10px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {onStartPlanningPick && (
            <button
              type="button"
              onClick={() => onStartPlanningPick(kind)}
              style={{
                width: '100%', padding: '10px',
                borderRadius: 'var(--r-sm)', border: '1px solid var(--primary)',
                background: 'var(--primary-l)', color: 'var(--primary)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              📍 Sélectionner directement sur le planning
            </button>
          )}
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Rechercher : n° tâche, intitulé, entreprise…"
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 'var(--r-xs)',
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value={zoneFilt} onChange={e => setZoneFilt(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12 }}>
              <option value="">Toutes zones</option>
              {zones.map(z => <option key={z.id} value={z.id}>{z.short}</option>)}
            </select>
            <select value={tradeFilt} onChange={e => setTradeFilt(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12 }}>
              <option value="">Tous corps de métier</option>
              {trades.map(t => <option key={t.id} value={t.id}>{t.short}</option>)}
            </select>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 16px' }}>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>
              Aucune tâche trouvée.
            </div>
          ) : list.map(t => {
            const z = zones.find(zz => zz.id === t.zone)
            const es = effectiveStatus(t)
            const sm = STATUS_META[es]
            return (
              <div key={t.id}
                onClick={() => onPick(t.id)}
                style={{
                  padding: '9px 11px', marginBottom: 6, borderRadius: 'var(--r-xs)',
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${sm.dot}`,
                  cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>
                      <span style={{ fontFamily: "'DM Mono', monospace", color: 'var(--xmuted)', fontSize: 11, marginRight: 6 }}>{t.task_number}</span>
                      {t.task}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {t.company} · {z?.short ?? '—'} · {t.start_date ? new Date(t.start_date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—'}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
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
