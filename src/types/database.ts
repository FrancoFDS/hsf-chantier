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
