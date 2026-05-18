'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Note, Company } from '@/types/database'
import { PRINT_STYLES, PrintToolbar, PageHeader, NoteBlock, getWeekRange } from '../shared'

export default function CRExportPage() {
  const [notes,     setNotes]     = useState<Note[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading,   setLoading]   = useState(true)
  const [weekOffset,setWeekOffset]= useState(0)

  const week = getWeekRange(weekOffset)

  useEffect(() => {
    Promise.all([
      supabase.from('notes').select('*').is('parent_id', null).gte('updated_at', week.start).lte('updated_at', week.end + 'T23:59:59'),
      supabase.from('companies').select('*').order('display_order'),
    ]).then(([n, c]) => {
      setNotes(((n.data ?? []) as Note[]).filter(x => !x.deleted_at))
      setCompanies((c.data ?? []) as Company[])
      setLoading(false)
    })
  }, [week.start, week.end])

  if (loading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6860' }}>Chargement…</div>

  // Group notes by primary company (first in company_codes, fallback to "Sans destinataire")
  const groups = new Map<string, Note[]>()
  for (const n of notes) {
    const keys = n.company_codes.length > 0 ? n.company_codes : ['— Sans destinataire —']
    for (const k of keys) {
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(n)
    }
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const printedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <PrintToolbar title="CR de réunion hebdo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: .45, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Semaine</span>
          <button onClick={() => setWeekOffset(o => o - 1)} style={navBtn}>‹</button>
          <span style={{ fontSize: 11, opacity: .7, minWidth: 90, textAlign: 'center' }}>
            {weekOffset === 0 ? 'Actuelle' : weekOffset < 0 ? `${weekOffset}` : `+${weekOffset}`}
          </span>
          <button onClick={() => setWeekOffset(o => o + 1)} style={navBtn}>›</button>
        </div>
      </PrintToolbar>

      <div style={{ padding: '24px 20px 48px', background: '#ECEAE5', minHeight: 'calc(100vh - 50px)' }}>
        <div className="print-page">
          <PageHeader
            title="Compte-rendu hebdomadaire"
            subtitle={week.label}
            right={`Imprimé le ${printedAt}\n${notes.length} note${notes.length > 1 ? 's' : ''} · ${sortedGroups.length} destinataire${sortedGroups.length > 1 ? 's' : ''}`}
          />
          {sortedGroups.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#6B6860', fontSize: 13 }}>
              Aucune note publiée cette semaine.
            </div>
          ) : sortedGroups.map(([company, list]) => (
            <div key={company} style={{ borderBottom: '2px solid #1A1A1A30', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <div style={{
                background: '#F4F2EC', padding: '8px 16px',
                borderLeft: '4px solid #2152C8',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#1A1A1A' }}>🏢 {company}</span>
                <span style={{ fontSize: 10, color: '#6B6860', fontWeight: 600 }}>{list.length} note{list.length > 1 ? 's' : ''}</span>
              </div>
              {list.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).map(n => <NoteBlock key={n.id} note={n} />)}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

const navBtn: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
  background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.7)', fontSize: 14, fontWeight: 700,
}
