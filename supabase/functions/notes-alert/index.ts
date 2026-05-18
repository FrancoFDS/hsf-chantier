// Edge Function : notes-alert
// Envoie un email immédiat quand une note est créée et concerne une entreprise
// Déclenché par Database Webhook (INSERT sur notes) ou appel direct depuis l'app

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY    = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL    = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Planify <noreply@planify.app>'
const APP_URL       = Deno.env.get('APP_URL') ?? 'https://hsf-chantier.vercel.app'

interface Payload {
  // Supabase webhook format
  type?: 'INSERT' | 'UPDATE' | 'DELETE'
  record?: {
    id: string; title: string | null; content: string; author_name: string
    category: string | null; due_date: string | null
    company_codes: string[]
    mentioned_companies?: string[]
    parent_id: string | null
    deleted_at: string | null
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const payload = await req.json() as Payload
  const rec = payload.record
  if (!rec || rec.parent_id || rec.deleted_at) {
    return new Response(JSON.stringify({ skip: 'reply or deleted' }), { headers: { 'content-type': 'application/json' } })
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const concerned = new Set<string>([...(rec.company_codes ?? []), ...(rec.mentioned_companies ?? [])])
  if (concerned.size === 0) return new Response(JSON.stringify({ skip: 'no concerns' }), { headers: { 'content-type': 'application/json' } })

  const { data: companies } = await sb.from('companies').select('name, email').in('name', [...concerned])
  const { data: prefs }     = await sb.from('company_notif_prefs').select('company_name, email_immediate')
  const prefMap = new Map<string, boolean>()
  for (const p of (prefs ?? []) as { company_name: string; email_immediate: boolean }[]) prefMap.set(p.company_name, p.email_immediate)

  const sent: { company: string; ok: boolean; reason?: string }[] = []
  for (const co of (companies ?? []) as { name: string; email: string | null }[]) {
    if (prefMap.has(co.name) && !prefMap.get(co.name)) { sent.push({ company: co.name, ok: false, reason: 'opted out' }); continue }
    if (!co.email) { sent.push({ company: co.name, ok: false, reason: 'no email' }); continue }
    const isMention = (rec.mentioned_companies ?? []).includes(co.name)

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to:   co.email,
        subject: `${isMention ? '@' : '📝'} ${rec.author_name} : ${rec.title ?? rec.content.slice(0, 60)}`,
        html: renderAlertEmail(rec, co.name, isMention, APP_URL),
      }),
    })
    sent.push({ company: co.name, ok: r.ok, reason: r.ok ? undefined : `HTTP ${r.status}` })
  }

  return new Response(JSON.stringify({ noteId: rec.id, sent }, null, 2), {
    headers: { 'content-type': 'application/json' },
  })
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderAlertEmail(rec: NonNullable<Payload['record']>, companyName: string, isMention: boolean, appUrl: string): string {
  const cat = rec.category ?? 'info'
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#F4F2EC;margin:0;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5E2DC;">
      <div style="background:${isMention ? '#7C3AED' : '#1A1A1A'};color:#fff;padding:14px 18px;">
        <div style="font-size:10px;opacity:.6;letter-spacing:.1em;font-weight:800;">PLANIFY · ${isMention ? 'MENTION' : 'NOUVELLE NOTE'}</div>
        <div style="font-size:16px;font-weight:700;margin-top:2px;">${escapeHtml(rec.author_name)} → ${escapeHtml(companyName)}</div>
      </div>
      <div style="padding:18px 22px;">
        <div style="font-size:11px;color:#6B6860;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">
          ${cat}${rec.due_date ? ` · échéance ${rec.due_date}` : ''}
        </div>
        ${rec.title ? `<div style="font-size:16px;font-weight:700;color:#1A1A1A;margin-bottom:8px;">${escapeHtml(rec.title)}</div>` : ''}
        <div style="font-size:14px;color:#2A2A2A;line-height:1.5;white-space:pre-wrap;">${escapeHtml(rec.content)}</div>
      </div>
      <div style="padding:0 22px 22px;">
        <a href="${appUrl}" style="display:inline-block;padding:10px 22px;background:#2152C8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">Voir dans Planify →</a>
      </div>
    </div>
  </body></html>`
}
