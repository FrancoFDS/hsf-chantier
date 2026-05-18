export type Database = Record<string, unknown>

export type Status   = 'arealis' | 'encours' | 'termine' | 'bloque' | 'en_retard'
export type Priority = 1 | 2 | 3

export interface Zone {
  id: string
  name: string
  short: string
  deadline: string | null
  floor: string
  floor_color: string
  display_order?: number
  created_at?: string
  updated_at?: string
}

export interface Trade {
  id: string
  name: string
  short: string
  color: string
  display_order?: number
  created_at?: string
  updated_at?: string
}

export interface Intervention {
  id: string
  trade: string
  company: string
  task: string
  task_number: string
  zone: string
  start_date: string | null
  end_date: string | null
  status: Status
  priority: Priority
  prereq: string
  notes: string
  predecessor_id: string | null
  predecessor_ids: string[]
  successor_ids: string[]
  off_days: string[]
  attachments: string[]
  progress: number              // colonne Supabase (= progress_manual dans l'ancien HTML)
  prereq_company: string | null
  company_edit_allowed: boolean
  staff?: number
  delay?: number
  impact?: string
  company_edit_start_min?: string | null
  company_edit_end_max?: string | null
  created_at?: string
  updated_at?: string
}

export interface Company {
  id: string
  name: string
  trade_id: string | null
  contact: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  contacts: { name: string; phone: string; email: string }[]
  active: boolean
  display_order?: number
}

export interface TaskLog {
  id: string
  intervention_id: string
  field: string
  old_value: string | null
  new_value: string | null
  author: string
  created_at: string
}

export interface Notification {
  id: string
  company: string
  message: string
  type: string
  read: boolean
  created_at: string
}

export interface ExternalContact {
  id: string
  name: string
  role: string | null
  phone: string | null
  created_at?: string
}

export type NoteScope    = 'intervention' | 'libre'
export type NoteStatus   = 'ouvert' | 'en_cours' | 'en_retard' | 'resolu' | 'termine'
export type NoteCategory = 'info' | 'demande' | 'reserve' | 'incident' | 'rappel'

export interface NoteAttachment {
  url: string
  name: string
  type: string
  size: number
}

export interface Note {
  id: string
  created_at: string
  updated_at: string
  author_id: string | null
  author_name: string

  title: string | null
  content: string

  intervention_id: string | null
  zone_ids:        string[]
  company_codes:   string[]
  trade_codes:     string[]

  scope:    NoteScope
  category: NoteCategory | null

  status:   NoteStatus
  due_date: string | null

  parent_id:   string | null
  attachments: NoteAttachment[]

  // v3
  deleted_at?:          string | null
  read_by?:             string[]
  proof_url?:           string | null
  proof_comment?:       string | null
  mentioned_companies?: string[]
}

export interface CompanyNotifPrefs {
  company_name:    string
  email_digest:    boolean
  email_immediate: boolean
  updated_at?: string
}

export type NoteSendChannel = 'cloche' | 'whatsapp'
export type NoteSendStatus  = 'sent' | 'skipped' | 'failed'

export interface NoteSendLog {
  id: string
  note_id: string
  channel: NoteSendChannel
  recipient_label: string
  recipient_company: string | null
  recipient_phone: string | null
  status: NoteSendStatus
  reason: string | null
  sent_by: string
  sent_at: string
}
