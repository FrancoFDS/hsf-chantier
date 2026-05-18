'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Note, Zone } from '@/types/database'
import { PRINT_STYLES, PrintToolbar, PageHeader, NoteBlock, getStatusForNote } from '../shared'

export default function ReservesExportPage() {
  const [notes,   setNotes]   = useState<Note[]>([])
  const [zones,   setZones]   = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<'zone' | 'company'>('zone')

  useEffect(() => {
    Promise.all([
      supabase.from('notes').select('*').is('parent_id', null).eq('category', 'reserve'),
      supabase.from('zones').select('*').order('display_order'),
    ]).then(([n, z]) => {
      const open = ((n.data ?? []) as Note[]).filter(x => {
        if (x.deleted_at) return false
        const s = getStatusForNote(x)
        return s === 'ouvert' || s === 'en_cours' || s === 'en_retard'
      })
      setNotes(open)
      setZones((z.data ?? []) as Zone[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6860' }}>Chargement…</div>

  const groups = new Map<string, Note[]>()
  for (const n of notes) {
    const keys = groupBy === 'zone'
      ? (n.zone_ids.length > 0 ? n.zone_ids.map(id => zones.find(z => z.id === id)?.short ?? id) : ['— Sans zone —'])
      : (n.company_codes.length > 0 ? n.company_codes : ['— Sans entreprise —'])
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
      <PrintToolbar title="Cahier de réserves">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: .45, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Grouper par</span>
          {(['zone', 'company'] as const).map(g => (
            <button key={g} onClick={() => setGroupBy(g)} style={{
              padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              background: groupBy === g ? '#2152C8' : 'rgba(255,255,255,.1)',
              color: groupBy === g ? '#fff' : 'rgba(255,255,255,.5)',
            }}>{g === 'zone' ? 'Zone' : 'Entreprise'}</button>
          ))}
        </div>
      </PrintToolbar>

      <div style={{ padding: '24px 20px 48px', background: '#ECEAE5', minHeight: 'calc(100vh - 50px)' }}>
        <div className="print-page">
          <PageHeader
            title="Cahier de réserves (ouvertes)"
            subtitle={`${notes.length} réserve${notes.length > 1 ? 's' : ''} en cours`}
            right={`Imprimé le ${printedAt}\nRegroupement : ${groupBy === 'zone' ? 'par zone' : 'par entreprise'}`}
          />
          {sortedGroups.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#6B6860', fontSize: 13 }}>
              Aucune réserve ouverte. 🎉
            </div>
          ) : sortedGroups.map(([key, list]) => (
            <div key={key} style={{ borderBottom: '2px solid #1A1A1A30', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <div style={{
                background: '#FEF3C7', padding: '8px 16px',
                borderLeft: '4px solid #EA580C',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#7C2D12' }}>{groupBy === 'zone' ? '📍' : '🏢'} {key}</span>
                <span style={{ fontSize: 10, color: '#7C2D12', fontWeight: 600 }}>{list.length} réserve{list.length > 1 ? 's' : ''}</span>
              </div>
              {list.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).map(n => <NoteBlock key={n.id + key} note={n} />)}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
