import type { Intervention } from '@/types/database'

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function fmtDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function localStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayStr(): string {
  return localStr(new Date())
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return localStr(d)
}

export function daysBetween(fromStr: string, toStr: string): number {
  const a = new Date(fromStr + 'T12:00:00').getTime()
  const b = new Date(toStr   + 'T12:00:00').getTime()
  return Math.round((b - a) / 86400000)
}

// Returns the 7 days of the week containing offset (0 = current week), starting Monday
export function weekDays(offset = 0): string[] {
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return localStr(d)
  })
}

export function isTaskActiveOn(iv: Intervention, dateStr: string): boolean {
  if (!iv.start_date) return false
  if (iv.off_days?.includes(dateStr)) return false
  const start = iv.start_date
  const end   = iv.end_date ?? iv.start_date
  return dateStr >= start && dateStr <= end
}

export function daysOverdue(iv: Intervention): number {
  const ref = iv.end_date ?? iv.start_date
  if (!ref) return 0
  const endD = new Date(ref + 'T00:00:00')
  const now  = new Date(); now.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((now.getTime() - endD.getTime()) / 86400000))
}
