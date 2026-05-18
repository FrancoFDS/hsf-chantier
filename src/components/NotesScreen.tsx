'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Note, NoteScope, NoteStatus, NoteCategory, Intervention, Zone, Trade, Company } from '@/types/database'

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES: { value: NoteCategory; label: string; icon: string; color: string }[] = [
  { value: 'info',     label: 'Info',     icon: 'ℹ',  color: '#2152C8' },
  { value: 'demande',  label: 'Demande',  icon: '?',  color: '#7C3AED' },
  { value: 'reserve',  label: 'Réserve',  icon: '!',  color: '#EA580C' },
  { value: 'incident', label: 'Incident', icon: '⚠', color: '#DC2626' },
  { value: 'rappel',   label: 'Rappel',   icon: '⏰', color: '#D97706' },
]

const STATUSES: { value: NoteStatus; label: string; color: string; bg: string }[] = [
  { value: 'ouvert',   label: 'Ouvert',    color: '#2152C8', bg: '#EEF2FC' },
  { value: 'en_cours', label: 'En cours',  color: '#D97706', bg: '#FEF3C7' },
  { value: 'resolu',   label: 'Résolu',    color: '#16A34A', bg: '#DCFCE7' },
  { value: 'clos',     label: 'Clos',      color: '#6B6860', bg: '#EFEDE8' },
]

const SCOPES: { value: 'all' | NoteScope; label: string }[] = [
  { value: 'all',          label: 'Toutes' },
  { value: 'intervention', label: 'Liées au planning' },
  { value: 'libre',        label: 'Libres' },
]

function catMeta(c: NoteCategory | null) {
  return CATEGORIES.find(x => x.value === c) ?? { value: 'info' as NoteCategory, label: '—', icon: '·', color: '#6B6860' }
}
function statusMeta(s: NoteStatus) {
  return STATUSES.find(x => x.value === s) ?? STATUSES[0]
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'à l’instant'
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `il y a ${d} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function fmtDue(ds: string | null): { txt: string; late: boolean } | null {
  if (!ds) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(ds + 'T00:00:00')
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const late = diff < 0
  const txt = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  return { txt, late }
}

// ─── Main screen ───────────────────────────────────────────────────────────

interface Props {
  interventions: Intervention[]
  zones: Zone[]
  trades: Trade[]
  companies: Company[]
  authorName: string
  userRole?: 'admin' | 'company'
  userCompany?: string
}

export default function NotesScreen({ interventions, zones, trades, companies, authorName, userRole, userCompany }: Props) {
  const [notes,     setNotes]     = useState<Note[]>([])
  const [loading,   setLoading]   = useState(true)
  const [scopeFilt, setScopeFilt] = useState<'all' | NoteScope>('all')
  const [statusFilt,setStatusFilt]= useState<NoteStatus | 'all'>('all')
  const [catFilt,   setCatFilt]   = useState<NoteCategory | 'all'>('all')
  const [coFilt,    setCoFilt]    = useState<string[]>([])
  const [trFilt,    setTrFilt]    = useState<string[]>([])
  const [zoneFilt,  setZoneFilt]  = useState<string[]>([])
  const [query,     setQuery]     = useState('')
  const [showForm,  setShowForm]  = useState<{ mode: 'libre' | 'intervention'; iv?: Intervention } | null>(null)
  const [selected,  setSelected]  = useState<string | null>(null)

  // Load + realtime
  useEffect(() => {
    let mounted = true
    supabase.from('notes').select('*').order('updated_at', { ascending: false }).then(({ data, error }) => {
      if (!mounted) return
      if (error) console.error('notes load', error)
      setNotes((data ?? []) as Note[])
      setLoading(false)
    })

    const ch = supabase.channel('notes-rt-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, payload => {
        if (!mounted) return
        if (payload.eventType === 'INSERT')        setNotes(prev => [payload.new as Note, ...prev.filter(n => n.id !== (payload.new as Note).id)])
        else if (payload.eventType === 'UPDATE')   setNotes(prev => prev.map(n => n.id === (payload.new as Note).id ? payload.new as Note : n))
        else if (payload.eventType === 'DELETE')   setNotes(prev => prev.filter(n => n.id !== (payload.old as Note).id))
      })
      .subscribe()

    return () => { mounted = false; supabase.removeChannel(ch) }
  }, [])

  // Top-level notes only in list (replies appear inside their thread)
  const topNotes = useMemo(() => notes.filter(n => !n.parent_id), [notes])

  // Reply counts grouped by parent
  const replyCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of notes) if (n.parent_id) map.set(n.parent_id, (map.get(n.parent_id) ?? 0) + 1)
    return map
  }, [notes])

  // Filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return topNotes.filter(n => {
      if (scopeFilt !== 'all' && n.scope !== scopeFilt) return false
      if (statusFilt !== 'all' && n.status !== statusFilt) return false
      if (catFilt !== 'all'    && n.category !== catFilt) return false
      if (coFilt.length   && !n.company_codes.some(c => coFilt.includes(c))) return false
      if (trFilt.length   && !n.trade_codes.some(t => trFilt.includes(t))) return false
      if (zoneFilt.length && !n.zone_ids.some(z => zoneFilt.includes(z))) return false
      if (q && !(n.content.toLowerCase().includes(q) || (n.title ?? '').toLowerCase().includes(q) || n.author_name.toLowerCase().includes(q))) return false
      // Subcontractor view: hide notes that don't concern me
      if (userRole === 'company' && userCompany) {
        if (!n.company_codes.includes(userCompany)) return false
      }
      return true
    }).sort((a, b) => {
      // Late (overdue + not resolved/clos) first
      const aLate = !!a.due_date && a.due_date < new Date().toISOString().slice(0, 10) && a.status !== 'resolu' && a.status !== 'clos'
      const bLate = !!b.due_date && b.due_date < new Date().toISOString().slice(0, 10) && b.status !== 'resolu' && b.status !== 'clos'
      if (aLate !== bLate) return aLate ? -1 : 1
      return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
    })
  }, [topNotes, scopeFilt, statusFilt, catFilt, coFilt, trFilt, zoneFilt, query, userRole, userCompany])

  const selectedNote = selected ? notes.find(n => n.id === selected) ?? null : null
  const selectedThread = selectedNote ? notes.filter(n => n.parent_id === selectedNote.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : []

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{ padding: '10px 12px 6px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', flex: 1 }}>Notes</div>
          <button onClick={() => setShowForm({ mode: 'libre' })} style={{
            padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)',
            color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nouvelle note
          </button>
        </div>

        {/* Search + scope */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Recherche…"
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12,
              fontFamily: "'DM Sans', sans-serif",
            }}
          />
          <div style={{ display: 'flex', gap: 3 }}>
            {SCOPES.map(s => (
              <button key={s.value} onClick={() => setScopeFilt(s.value)} style={{
                padding: '5px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${scopeFilt === s.value ? 'var(--primary)' : 'var(--border)'}`,
                background: scopeFilt === s.value ? 'var(--primary-l)' : 'var(--surface-2)',
                color: scopeFilt === s.value ? 'var(--primary)' : 'var(--muted)',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* Status + category filters */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setStatusFilt('all')} style={chipBtn(statusFilt === 'all')}>Tous statuts</button>
          {STATUSES.map(s => (
            <button key={s.value} onClick={() => setStatusFilt(s.value)} style={chipBtn(statusFilt === s.value, s.color, s.bg)}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, display: 'inline-block', marginRight: 4 }} />
              {s.label}
            </button>
          ))}
          <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 3px' }} />
          <button onClick={() => setCatFilt('all')} style={chipBtn(catFilt === 'all')}>Toutes catégories</button>
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setCatFilt(c.value)} style={chipBtn(catFilt === c.value, c.color)}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 80px', background: 'var(--surface-2)' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 13 }}>Chargement…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
            Aucune note pour ces filtres.
          </div>
        ) : (
          filtered.map(n => (
            <NoteCard
              key={n.id}
              note={n}
              zones={zones}
              companies={companies}
              trades={trades}
              interventions={interventions}
              replyCount={replyCount.get(n.id) ?? 0}
              onClick={() => setSelected(n.id)}
            />
          ))
        )}
      </div>

      {/* Creation modal */}
      {showForm && (
        <NoteFormModal
          mode={showForm.mode}
          iv={showForm.iv}
          zones={zones}
          trades={trades}
          companies={companies}
          authorName={authorName}
          onClose={() => setShowForm(null)}
        />
      )}

      {/* Detail */}
      {selectedNote && (
        <NoteDetail
          note={selectedNote}
          thread={selectedThread}
          zones={zones}
          trades={trades}
          companies={companies}
          interventions={interventions}
          authorName={authorName}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function chipBtn(active: boolean, c?: string, bg?: string): React.CSSProperties {
  return {
    padding: '4px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active && c ? c : active ? 'var(--primary)' : 'var(--border)'}`,
    background: active ? (bg ?? 'var(--primary-l)') : 'var(--surface-2)',
    color:      active ? (c  ?? 'var(--primary)') : 'var(--muted)',
    display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
  }
}

// ─── Note card ──────────────────────────────────────────────────────────────

function NoteCard({ note, zones, companies, trades, interventions, replyCount, onClick }: {
  note: Note; zones: Zone[]; companies: Company[]; trades: Trade[]; interventions: Intervention[]; replyCount: number; onClick: () => void
}) {
  const cat  = catMeta(note.category)
  const stat = statusMeta(note.status)
  const due  = fmtDue(note.due_date)
  const ivLink = note.intervention_id ? interventions.find(i => i.id === note.intervention_id) : null
  const zoneList = note.zone_ids.map(id => zones.find(z => z.id === id)?.short ?? id).filter(Boolean)
  const coList   = note.company_codes
  const trList   = note.trade_codes.map(id => trades.find(t => t.id === id)?.short ?? id)

  return (
    <div onClick={onClick} style={{
      background: 'var(--surface)', borderRadius: 10, marginBottom: 8, padding: '10px 12px',
      border: '1px solid var(--border)', cursor: 'pointer',
      boxShadow: due?.late ? '0 0 0 2px rgba(220,38,38,.18)' : undefined,
    }}>
      {/* Top row: category + status + scope icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{
          padding: '2px 7px', borderRadius: 4, fontSize: 9.5, fontWeight: 800, color: cat.color,
          background: cat.color + '15', textTransform: 'uppercase', letterSpacing: '.04em',
        }}>{cat.icon} {cat.label}</span>
        <span style={{
          padding: '2px 7px', borderRadius: 4, fontSize: 9.5, fontWeight: 700, color: stat.color, background: stat.bg,
        }}>● {stat.label}</span>
        <span style={{ fontSize: 11, color: 'var(--xmuted)' }}>
          {note.scope === 'intervention' ? '📅' : '📌'}
        </span>
        {due && (
          <span style={{
            marginLeft: 'auto', fontSize: 10, fontWeight: 700,
            color: due.late ? '#DC2626' : 'var(--muted)',
            padding: '2px 6px', borderRadius: 4,
            background: due.late ? 'rgba(220,38,38,.10)' : 'transparent',
          }}>
            ⏰ {due.txt}
          </span>
        )}
      </div>

      {/* Title or content excerpt */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3, lineHeight: 1.3 }}>
        {note.title || note.content.slice(0, 80) + (note.content.length > 80 ? '…' : '')}
      </div>
      {note.title && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {note.content}
        </div>
      )}

      {/* Anchors */}
      {(coList.length > 0 || trList.length > 0 || zoneList.length > 0 || ivLink) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 5, marginTop: 2 }}>
          {coList.length > 0  && <span style={anchorStyle}>🏢 {coList.join(', ')}</span>}
          {trList.length > 0  && <span style={anchorStyle}>📐 {trList.join(', ')}</span>}
          {zoneList.length > 0 && <span style={anchorStyle}>📍 {zoneList.join(', ')}</span>}
          {ivLink && <span style={anchorStyle}>🔗 {ivLink.task_number || ivLink.task?.slice(0, 25)}</span>}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: 'var(--xmuted)' }}>
        <span>👤 {note.author_name}</span>
        <span>· {timeAgo(note.updated_at ?? note.created_at)}</span>
        {note.attachments.length > 0 && <span>· 📎 {note.attachments.length}</span>}
        {replyCount > 0 && <span style={{ color: 'var(--primary)', fontWeight: 700 }}>· 💬 {replyCount} {replyCount > 1 ? 'réponses' : 'réponse'}</span>}
      </div>
    </div>
  )
}

const anchorStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--muted)', background: 'var(--surface-2)',
  padding: '2px 6px', borderRadius: 4, fontWeight: 600,
}

// ─── Form modal (create note) ───────────────────────────────────────────────

export function NoteFormModal({ mode, iv, zones, trades, companies, authorName, onClose }: {
  mode: 'libre' | 'intervention'
  iv?: Intervention
  zones: Zone[]; trades: Trade[]; companies: Company[]
  authorName: string
  onClose: () => void
}) {
  const [title,    setTitle]    = useState('')
  const [content,  setContent]  = useState('')
  const [cat,      setCat]      = useState<NoteCategory>('info')
  const [dueDate,  setDueDate]  = useState<string>('')
  const [coCodes,  setCoCodes]  = useState<string[]>(iv?.company ? [iv.company] : [])
  const [trCodes,  setTrCodes]  = useState<string[]>(iv?.trade   ? [iv.trade]   : [])
  const [zoneIds,  setZoneIds]  = useState<string[]>(iv?.zone    ? [iv.zone]    : [])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function submit() {
    if (!content.trim()) { setError('Le contenu est requis.'); return }
    const hasAnchor = mode === 'intervention' || coCodes.length > 0 || trCodes.length > 0 || zoneIds.length > 0
    if (!hasAnchor) { setError('Au moins un ancrage (entreprise, métier ou zone) est requis.'); return }

    setSaving(true)
    setError(null)
    const payload = {
      author_name: authorName,
      title: title.trim() || null,
      content: content.trim(),
      intervention_id: iv?.id ?? null,
      zone_ids:      zoneIds,
      company_codes: coCodes,
      trade_codes:   trCodes,
      scope:    mode,
      category: cat,
      status:   'ouvert' as NoteStatus,
      due_date: dueDate || null,
      parent_id: null,
      attachments: [],
    }
    const { error: err } = await supabase.from('notes').insert([payload])
    setSaving(false)
    if (err) { setError(err.message); return }
    onClose()
  }

  return (
    <>
      <div onClick={onClose} style={modalBackdrop} />
      <div style={modalSheet}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 16px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {mode === 'intervention' ? `Note sur « ${iv?.task?.slice(0, 30) ?? '—'} »` : 'Nouvelle note libre'}
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--surface-2)', cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title (optional) */}
          <div>
            <label style={lbl}>Titre <span style={{ color: 'var(--xmuted)', fontWeight: 400 }}>(optionnel)</span></label>
            <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="ex. Demande de prise électrique sup." />
          </div>

          {/* Content */}
          <div>
            <label style={lbl}>Contenu <span style={{ color: 'var(--danger)' }}>*</span></label>
            <textarea
              value={content} onChange={e => setContent(e.target.value)}
              rows={4} autoFocus
              style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="Décrivez la note…"
            />
          </div>

          {/* Category */}
          <div>
            <label style={lbl}>Catégorie</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setCat(c.value)} style={{
                  ...chipBtn(cat === c.value, c.color),
                  padding: '6px 10px', fontSize: 11.5,
                }}>{c.icon} {c.label}</button>
              ))}
            </div>
          </div>

          {/* Anchors — required for libre mode, pre-filled for intervention */}
          <div>
            <label style={lbl}>Entreprises {mode === 'libre' && coCodes.length === 0 && trCodes.length === 0 && zoneIds.length === 0 && <span style={{ color: 'var(--danger)' }}>*</span>}</label>
            <MultiPick options={companies.map(c => ({ value: c.name, label: c.name }))} selected={coCodes} onChange={setCoCodes} placeholder="Sélectionner…" />
          </div>
          <div>
            <label style={lbl}>Corps de métier</label>
            <MultiPick options={trades.map(t => ({ value: t.id, label: t.name }))} selected={trCodes} onChange={setTrCodes} placeholder="Sélectionner…" />
          </div>
          <div>
            <label style={lbl}>Zones</label>
            <MultiPick options={zones.map(z => ({ value: z.id, label: `${z.short} – ${z.name}` }))} selected={zoneIds} onChange={setZoneIds} placeholder="Sélectionner…" />
          </div>

          {/* Due date */}
          <div>
            <label style={lbl}>Échéance <span style={{ color: 'var(--xmuted)', fontWeight: 400 }}>(optionnel)</span></label>
            <input type="date" style={inp} value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid rgba(220,38,38,.3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#DC2626' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 16px 24px', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Annuler</button>
          <button onClick={submit} disabled={saving} style={{
            flex: 2, padding: '11px 0', borderRadius: 10, border: 'none',
            background: saving ? 'var(--border)' : 'var(--primary)',
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
          }}>{saving ? 'Création…' : 'Créer la note'}</button>
        </div>
      </div>
    </>
  )
}

// ─── Multi-pick (companies/trades/zones) ────────────────────────────────────

function MultiPick({ options, selected, onChange, placeholder }: {
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [q,    setQ]    = useState('')
  const ql = q.trim().toLowerCase()
  const visible = options.filter(o => !ql || o.label.toLowerCase().includes(ql))

  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => setOpen(true)} style={{
        ...inp, minHeight: 36, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', cursor: 'text', padding: '5px 8px',
      }}>
        {selected.map(v => {
          const opt = options.find(o => o.value === v)
          return (
            <span key={v} style={{
              padding: '2px 6px 2px 8px', borderRadius: 999, background: 'var(--primary-l)',
              color: 'var(--primary)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {opt?.label ?? v}
              <button onClick={e => { e.stopPropagation(); onChange(selected.filter(x => x !== v)) }} style={{
                border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1,
              }}>×</button>
            </span>
          )
        })}
        {selected.length === 0 && <span style={{ color: 'var(--xmuted)', fontSize: 12 }}>{placeholder}</span>}
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: 'var(--shadow-md)', zIndex: 201, maxHeight: 220, overflowY: 'auto', padding: 4,
          }}>
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Rechercher…"
              style={{ ...inp, marginBottom: 4, padding: '6px 8px', fontSize: 12 }}
            />
            {visible.length === 0 ? (
              <div style={{ padding: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>Aucun résultat</div>
            ) : visible.map(o => {
              const isSel = selected.includes(o.value)
              return (
                <div key={o.value} onClick={() => onChange(isSel ? selected.filter(x => x !== o.value) : [...selected, o.value])} style={{
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
                  background: isSel ? 'var(--primary-l)' : 'transparent',
                  color: isSel ? 'var(--primary)' : 'var(--text)',
                  fontWeight: isSel ? 700 : 500,
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`,
                    background: isSel ? 'var(--primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSel && <span style={{ color: '#fff', fontSize: 9 }}>✓</span>}
                  </span>
                  {o.label}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Detail panel (note + thread) ───────────────────────────────────────────

function NoteDetail({ note, thread, zones, trades, companies, interventions, authorName, onClose }: {
  note: Note; thread: Note[]
  zones: Zone[]; trades: Trade[]; companies: Company[]; interventions: Intervention[]
  authorName: string
  onClose: () => void
}) {
  const [reply,  setReply]  = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<NoteStatus>(note.status)
  const cat   = catMeta(note.category)
  const stat  = statusMeta(status)
  const due   = fmtDue(note.due_date)
  const ivLink = note.intervention_id ? interventions.find(i => i.id === note.intervention_id) : null

  async function postReply() {
    if (!reply.trim()) return
    setSaving(true)
    const payload = {
      author_name: authorName,
      content: reply.trim(),
      parent_id: note.id,
      scope: 'libre' as NoteScope,
      intervention_id: note.intervention_id,
      zone_ids: [],
      company_codes: [],
      trade_codes: [],
      attachments: [],
    }
    const { error: err } = await supabase.from('notes').insert([payload])
    setSaving(false)
    if (err) { alert(err.message); return }
    setReply('')
    // Bump parent updated_at for sort
    await supabase.from('notes').update({ updated_at: new Date().toISOString() }).eq('id', note.id)
  }

  async function changeStatus(newStatus: NoteStatus) {
    setStatus(newStatus)
    await supabase.from('notes').update({ status: newStatus }).eq('id', note.id)
  }

  return (
    <>
      <div onClick={onClose} style={modalBackdrop} />
      <div style={{ ...modalSheet, maxHeight: '92vh' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div style={{ padding: '0 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{
              padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, color: cat.color,
              background: cat.color + '15', textTransform: 'uppercase', letterSpacing: '.04em',
            }}>{cat.icon} {cat.label}</span>
            <span style={{ fontSize: 11, color: 'var(--xmuted)' }}>{note.scope === 'intervention' ? '📅 Liée au planning' : '📌 Libre'}</span>
            <button onClick={onClose} style={{
              marginLeft: 'auto', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--surface-2)', cursor: 'pointer', fontSize: 14,
            }}>✕</button>
          </div>
          {note.title && <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>{note.title}</div>}
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{note.content}</div>

          {/* Anchors */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
            {note.company_codes.length > 0 && <span style={anchorStyle}>🏢 {note.company_codes.join(', ')}</span>}
            {note.trade_codes.length > 0 && <span style={anchorStyle}>📐 {note.trade_codes.map(t => trades.find(x => x.id === t)?.name ?? t).join(', ')}</span>}
            {note.zone_ids.length > 0 && <span style={anchorStyle}>📍 {note.zone_ids.map(z => zones.find(x => x.id === z)?.short ?? z).join(', ')}</span>}
            {ivLink && <span style={anchorStyle}>🔗 {ivLink.task_number || ivLink.task?.slice(0, 30)}</span>}
            {due && <span style={{ ...anchorStyle, color: due.late ? '#DC2626' : undefined, background: due.late ? 'rgba(220,38,38,.10)' : undefined }}>⏰ {due.txt}</span>}
          </div>

          {/* Author + status changer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--xmuted)' }}>👤 {note.author_name} · {timeAgo(note.created_at)}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
              {STATUSES.map(s => (
                <button key={s.value} onClick={() => changeStatus(s.value)} style={{
                  ...chipBtn(status === s.value, s.color, s.bg),
                  padding: '4px 8px', fontSize: 10,
                }}>{s.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 100, maxHeight: '40vh' }}>
          {thread.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--xmuted)', fontSize: 11, padding: '12px 0' }}>Aucune réponse pour l’instant.</div>
          ) : thread.map(r => (
            <div key={r.id} style={{ marginBottom: 10, paddingLeft: 10, borderLeft: '2px solid var(--border)' }}>
              <div style={{ fontSize: 10.5, color: 'var(--xmuted)', marginBottom: 2 }}>
                <strong style={{ color: 'var(--text)' }}>{r.author_name}</strong> · {timeAgo(r.created_at)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{r.content}</div>
            </div>
          ))}
        </div>

        {/* Reply box */}
        <div style={{ padding: '10px 16px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <input
            value={reply} onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postReply() } }}
            placeholder="Répondre…"
            style={{ ...inp, flex: 1, padding: '9px 10px', fontSize: 12.5 }}
          />
          <button onClick={postReply} disabled={saving || !reply.trim()} style={{
            padding: '0 14px', borderRadius: 8, border: 'none',
            background: !reply.trim() || saving ? 'var(--border)' : 'var(--primary)',
            color: '#fff', fontSize: 12, fontWeight: 700, cursor: !reply.trim() || saving ? 'default' : 'pointer',
          }}>Envoyer</button>
        </div>
      </div>
    </>
  )
}

// ─── Shared styles ──────────────────────────────────────────────────────────

const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  zIndex: 100, animation: 'fadeIn .15s ease',
}

const modalSheet: React.CSSProperties = {
  position: 'fixed', bottom: 0, left: 0, right: 0,
  background: 'var(--surface)', borderRadius: '16px 16px 0 0',
  zIndex: 101, animation: 'slideUp .22s ease',
  maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
}

const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--muted)',
  textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5, display: 'block',
}

const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--surface-2)', color: 'var(--text)', padding: '8px 10px', fontSize: 13,
  fontFamily: "'DM Sans', sans-serif",
}
