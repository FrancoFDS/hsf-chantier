// Edge Function : notes-digest
// Envoie un email matinal par entreprise avec ses notes ouvertes
// Déclenché par cron (Supabase Database > Cron) : 0 8 * * 1-5 (lun-ven 8h)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY    = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL    = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Planify <noreply@planify.app>'
const APP_URL       = Deno.env.get('APP_URL') ?? 'https://hsf-chantier.vercel.app'

interface Note {
  id: string; created_at: string; updated_at: string
  title: string | null; content: string
  category: string | null; status: string
  due_date: string | null
  company_codes: string[]
  mentioned_companies?: string[]
  intervention_id: string | null
}

interface Company {
  id: string; name: string; email: string | null
}

interface NotifPref {
  company_name: string; email_digest: boolean
}

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const today = new Date().toISOString().slice(0, 10)

  // Notes ouvertes ou en cours (pas supprimées, pas réponses)
  const { data: notes } = await sb.from('notes')
    .select('*')
    .is('parent_id', null).is('deleted_at', null)
    .in('status', ['ouvert', 'en_cours'])

  const { data: companies } = await sb.from('companies').select('id, name, email').eq('active', true)
  const { data: prefs }     = await sb.from('company_notif_prefs').select('company_name, email_digest')

  const prefMap = new Map<string, boolean>()
  for (const p of (prefs ?? []) as NotifPref[]) prefMap.set(p.company_name, p.email_digest)

  const results: { company: string; sent: boolean; reason?: string }[] = []

  for (const co of (companies ?? []) as Company[]) {
    if (prefMap.has(co.name) && !prefMap.get(co.name)) {
      results.push({ company: co.name, sent: false, reason: 'opted out' })
      continue
    }
    if (!co.email) { results.push({ company: co.name, sent: false, reason: 'no email' }); continue }
    const concerning = ((notes ?? []) as Note[]).filter(n =>
      n.company_codes.includes(co.name) || (n.mentioned_companies ?? []).includes(co.name)
    )
    if (concerning.length === 0) { results.push({ company: co.name, sent: false, reason: 'no notes' }); continue }

    const lateCount = concerning.filter(n => n.due_date && n.due_date < today).length

    const html = renderDigestEmail(co.name, concerning, lateCount, APP_URL)
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to:   co.email,
        subject: `Planify — ${concerning.length} note${concerning.length > 1 ? 's' : ''} en cours${lateCount > 0 ? ` (${lateCount} en retard)` : ''}`,
        html,
      }),
    })
    results.push({ company: co.name, sent: r.ok, reason: r.ok ? undefined : `HTTP ${r.status}` })
  }

  return new Response(JSON.stringify({ today, results }, null, 2), {
    headers: { 'content-type': 'application/json' },
  })
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderDigestEmail(companyName: string, notes: Note[], lateCount: number, appUrl: string): string {
  const items = notes.map(n => {
    const cat = n.category ?? 'info'
    const late = n.due_date && n.due_date < new Date().toISOString().slice(0, 10)
    return `
      <tr><td style="padding:10px 12px;border-bottom:1px solid #E5E2DC;">
        <div style="font-size:11px;color:#6B6860;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">
          ${cat}${n.due_date ? ` · échéance ${n.due_date}${late ? ' <strong style="color:#DC2626;">EN RETARD</strong>' : ''}` : ''}
        </div>
        ${n.title ? `<div style="font-size:14px;font-weight:700;color:#1A1A1A;margin-bottom:4px;">${escapeHtml(n.title)}</div>` : ''}
        <div style="font-size:13px;color:#2A2A2A;line-height:1.4;">${escapeHtml(n.content.slice(0, 200))}${n.content.length > 200 ? '…' : ''}</div>
      </td></tr>
    `
  }).join('')

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#F4F2EC;margin:0;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5E2DC;">
      <div style="background:#1A1A1A;color:#fff;padding:18px 22px;">
        <div style="font-size:11px;opacity:.5;letter-spacing:.1em;font-weight:800;">PLANIFY</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;">Bonjour ${escapeHtml(companyName)} 👋</div>
      </div>
      <div style="padding:18px 22px;font-size:14px;color:#2A2A2A;">
        Vous avez <strong>${notes.length} note${notes.length > 1 ? 's' : ''} en cours</strong>${lateCount > 0 ? `, dont <strong style="color:#DC2626;">${lateCount} en retard</strong>` : ''}.
      </div>
      <table style="width:100%;border-collapse:collapse;">${items}</table>
      <div style="padding:18px 22px;text-align:center;">
        <a href="${appUrl}" style="display:inline-block;padding:10px 22px;background:#2152C8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">Voir dans Planify →</a>
      </div>
      <div style="padding:12px 22px;font-size:10.5px;color:#9A9690;border-top:1px solid #E5E2DC;text-align:center;">
        Pour désactiver ces digests, contacter votre PM.
      </div>
    </div>
  </body></html>`
}
