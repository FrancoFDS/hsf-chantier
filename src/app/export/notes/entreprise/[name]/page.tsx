'use client'

import { use, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Note } from '@/types/database'
import { PRINT_STYLES, PrintToolbar, PageHeader, NoteBlock, STATUS_META } from '../../shared'

export default function CompanyExportPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params)
  const company = decodeURIComponent(name)
  const [notes,   setNotes]   = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('notes').select('*').is('parent_id', null).contains('company_codes', [company]).order('created_at', { ascending: false }).then(({ data }) => {
      setNotes(((data ?? []) as Note[]).filter(x => !x.deleted_at))
      setLoading(false)
    })
  }, [company])

  if (loading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6860' }}>Chargement…</div>

  // Group by status: open first, then resolved/closed
  const open     = notes.filter(n => n.status === 'ouvert' || n.status === 'en_cours' || n.status === 'en_retard')
  const closed   = notes.filter(n => n.status === 'resolu' || n.status === 'termine')
  const printedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
  const breakdown = (['ouvert', 'en_cours', 'en_retard', 'resolu', 'termine'] as const).map(s => ({
    s, n: notes.filter(x => x.status === s).length,
  })).filter(x => x.n > 0)

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <PrintToolbar title={`Fiche entreprise — ${company}`} />
      <div style={{ padding: '24px 20px 48px', background: '#ECEAE5', minHeight: 'calc(100vh - 50px)' }}>
        <div className="print-page">
          <PageHeader
            title="Fiche entreprise — historique notes"
            subtitle={`🏢 ${company}`}
            right={`Imprimé le ${printedAt}\n${notes.length} note${notes.length > 1 ? 's' : ''} au total`}
          />

          {/* Breakdown */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #E5E2DC', background: '#FAFAF7', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {breakdown.map(b => (
              <span key={b.s} style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                color: STATUS_META[b.s].color, background: STATUS_META[b.s].bg,
              }}>{STATUS_META[b.s].label} · {b.n}</span>
            ))}
            {notes.length === 0 && <span style={{ fontSize: 12, color: '#6B6860' }}>Aucune note pour cette entreprise.</span>}
          </div>

          {open.length > 0 && (
            <>
              <SectionHeader label="🔴 Notes ouvertes" count={open.length} bg="#FEE2E2" border="#DC2626" />
              {open.map(n => <NoteBlock key={n.id} note={n} />)}
            </>
          )}
          {closed.length > 0 && (
            <>
              <SectionHeader label="✓ Notes résolues / terminées" count={closed.length} bg="#DCFCE7" border="#16A34A" />
              {closed.map(n => <NoteBlock key={n.id} note={n} />)}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function SectionHeader({ label, count, bg, border }: { label: string; count: number; bg: string; border: string }) {
  return (
    <div style={{
      background: bg, padding: '8px 16px', borderLeft: `4px solid ${border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      breakInside: 'avoid', pageBreakInside: 'avoid',
    }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: '#1A1A1A' }}>{label}</span>
      <span style={{ fontSize: 10, color: '#1A1A1A', fontWeight: 600 }}>{count}</span>
    </div>
  )
}
