-- =====================================================
-- Notes v4 — historique des envois (notifs + WhatsApp)
-- À exécuter dans Supabase SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS note_send_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id             uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('cloche', 'whatsapp')),
  recipient_label     text NOT NULL,           -- "ELPHITEC" ou "Karim (STD)" ou "MOE externe"
  recipient_company   text,                    -- nom d'entreprise si lié à une entreprise connue
  recipient_phone     text,                    -- numéro nettoyé (digits) si whatsapp
  status              text DEFAULT 'sent' CHECK (status IN ('sent', 'skipped', 'failed')),
  reason              text,                    -- "pas de tel", "opt-out", etc. (si status != sent)
  sent_by             text NOT NULL,           -- author_name de celui qui a déclenché
  sent_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_send_log_note ON note_send_log(note_id);
CREATE INDEX IF NOT EXISTS idx_send_log_sent_at ON note_send_log(sent_at DESC);

ALTER TABLE note_send_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on note_send_log" ON note_send_log;
CREATE POLICY "Allow all on note_send_log" ON note_send_log
  FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE note_send_log;
