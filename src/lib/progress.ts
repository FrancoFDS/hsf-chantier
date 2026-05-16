import type { Intervention, Zone } from '@/types/database'
import type { Status } from '@/types/database'

export function effectiveStatus(iv: Intervention): Status {
  if (iv.status === 'termine')   return 'termine'
  if (iv.status === 'bloque')    return 'bloque'
  if (iv.status === 'en_retard') return 'en_retard'
  const rawDate = iv.end_date ?? iv.start_date
  if (!rawDate) return iv.status
  const due = new Date(rawDate + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return due < today ? 'en_retard' : iv.status
}

export interface TaskProgress {
  pct: number
  theoretical: number
  manual: number
  method: string
  confidence: number
}

export function computeTaskProgress(iv: Intervention): TaskProgress {
  if (iv.status === 'termine') {
    return { pct: 100, theoretical: 100, manual: iv.progress ?? 100, method: 'done', confidence: 1 }
  }

  const today  = new Date(); today.setHours(0, 0, 0, 0)
  const startD = iv.start_date ? new Date(iv.start_date + 'T00:00:00') : null
  const endD   = iv.end_date   ? new Date(iv.end_date   + 'T00:00:00') : startD ? new Date(startD) : null

  const totalDays = startD && endD ? Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 86400000) + 1) : 1
  const elapsed   = startD ? Math.max(0, Math.round((today.getTime() - startD.getTime()) / 86400000)) : 0

  let theoretical = 0
  if (startD && today >= startD) {
    theoretical = Math.min(100, Math.round(elapsed / totalDays * 100))
    if (iv.status === 'encours' || effectiveStatus(iv) === 'en_retard') {
      theoretical = Math.max(10, Math.min(95, theoretical))
    }
  }

  const manual = typeof iv.progress === 'number'
    ? Math.min(100, Math.max(0, iv.progress))
    : null

  if (iv.status === 'bloque') {
    const frozen = manual !== null ? manual : Math.max(5, theoretical)
    return { pct: frozen, theoretical, manual: manual ?? 0, method: 'blocked_frozen', confidence: 0.5 }
  }

  if (!startD || today < startD) {
    const manualFuture = manual !== null && manual > 0 ? manual : 0
    return { pct: manualFuture, theoretical: 0, manual: manual ?? 0, method: 'not_started', confidence: 0.9 }
  }

  let finalPct = manual !== null ? Math.max(theoretical, manual) : theoretical
  finalPct = Math.min(95, Math.max(0, finalPct))

  const es = effectiveStatus(iv)
  const confidence = es === 'en_retard' ? 0.6 : es === 'encours' ? 0.85 : 0.75

  return { pct: finalPct, theoretical, manual: manual ?? 0, method: 'temporal', confidence }
}

export interface ProjectHealth {
  avancementReel: number
  cadenceCible: number
  derive: number
  fiabilite: number
  projectionDays: number | null
  riskyZones: RiskyZone[]
  alertes: Alerte[]
}

export interface RiskyZone {
  zone: Zone
  risk: number
  derive: number
  blocked: number
  late: number
  avancement: number
  cadence: number
}

export interface Alerte {
  type: 'danger' | 'warning'
  msg: string
}

export function computeProjectHealth(data: Intervention[], zones: Zone[]): ProjectHealth {
  const today = new Date(); today.setHours(0, 0, 0, 0)

  let totalWeight = 0, weightedProgress = 0, totalTheo = 0, theoWeight = 0
  data.forEach(iv => {
    const p = computeTaskProgress(iv)
    weightedProgress += p.pct; totalWeight++
    totalTheo += p.theoretical; theoWeight++
  })
  const avancementReel = totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : 0
  const cadenceCible   = theoWeight   > 0 ? Math.round(totalTheo      / theoWeight)   : 0
  const derive         = avancementReel - cadenceCible

  const tasksDue  = data.filter(iv => {
    const e = iv.end_date ?? iv.start_date
    return e && new Date(e + 'T00:00:00') <= today
  })
  const tasksDone = tasksDue.filter(iv => iv.status === 'termine')
  const fiabilite = tasksDue.length > 0 ? Math.round(tasksDone.length / tasksDue.length * 100) : 100

  let maxDeadline: string | null = null
  zones.forEach(z => { if (z.deadline && (!maxDeadline || z.deadline > maxDeadline)) maxDeadline = z.deadline })

  let projectionDays: number | null = null
  if (maxDeadline && avancementReel < 100) {
    const deadlineDate   = new Date(maxDeadline + 'T00:00:00')
    const daysToDeadline = Math.round((deadlineDate.getTime() - today.getTime()) / 86400000)
    const startProject   = data.reduce((min, iv) => iv.start_date && iv.start_date < min ? iv.start_date : min, '9999')
    if (startProject !== '9999') {
      const startDate        = new Date(startProject + 'T00:00:00')
      const totalProjectDays = Math.max(1, Math.round((today.getTime() - startDate.getTime()) / 86400000))
      const dailyRate        = avancementReel / totalProjectDays
      if (dailyRate > 0) projectionDays = Math.ceil((100 - avancementReel) / dailyRate) - daysToDeadline
    }
  }

  const riskyZones: RiskyZone[] = []
  zones.forEach(z => {
    const zTasks = data.filter(iv => iv.zone === z.id)
    const zDue   = zTasks.filter(iv => {
      const e = iv.end_date ?? iv.start_date
      return e && new Date(e + 'T00:00:00') <= today
    })
    const zDone = zDue.filter(iv => iv.status === 'termine')
    const zBloc = zTasks.filter(iv => iv.status === 'bloque')
    const zLate = zTasks.filter(iv => effectiveStatus(iv) === 'en_retard')
    let zAvt = 0, zTheo = 0, zW = 0
    zTasks.forEach(iv => { const p = computeTaskProgress(iv); zAvt += p.pct; zTheo += p.theoretical; zW++ })
    zAvt  = zW > 0 ? Math.round(zAvt  / zW) : 0
    zTheo = zW > 0 ? Math.round(zTheo / zW) : 0
    const zDerive = zAvt - zTheo
    let risk = 0
    if (zLate.length > 0) risk += 40
    if (zBloc.length > 0) risk += 30
    if (zDerive < -15)    risk += 20
    if (z.deadline) {
      const dj = Math.round((new Date(z.deadline + 'T00:00:00').getTime() - today.getTime()) / 86400000)
      if (dj < 0)       risk += 30
      else if (dj < 7)  risk += 20
      else if (dj < 14) risk += 10
    }
    if (risk >= 30) riskyZones.push({
      zone: z, risk: Math.min(100, risk), derive: zDerive,
      blocked: zBloc.length, late: zLate.length, avancement: zAvt, cadence: zTheo,
    })
  })
  riskyZones.sort((a, b) => b.risk - a.risk)

  const alertes: Alerte[] = []
  if (projectionDays !== null && projectionDays > 7)
    alertes.push({ type: 'danger', msg: `Livraison estimée avec +${projectionDays}j de retard au rythme actuel` })
  const critBloc = data.filter(iv => iv.status === 'bloque' && (iv.priority === 1 || iv.priority === 2))
  if (critBloc.length > 0)
    alertes.push({ type: 'danger', msg: `${critBloc.length} tâche(s) critique(s) bloquée(s) — intervention requise` })
  if (derive < -20)
    alertes.push({ type: 'warning', msg: `Dérive planning : cadence en dessous de l'objectif de ${Math.abs(derive)}%` })
  if (riskyZones.length > 0 && alertes.length < 3)
    alertes.push({ type: 'warning', msg: `Zone à risque : ${riskyZones[0].zone.short} (${riskyZones[0].late} retard(s), ${riskyZones[0].blocked} bloquée(s))` })

  return { avancementReel, cadenceCible, derive, fiabilite, projectionDays, riskyZones, alertes }
}

export function daysUntil(dateStr: string): number {
  const d   = new Date(dateStr + 'T00:00:00')
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export function deadlineColor(dateStr: string): string {
  const d = daysUntil(dateStr)
  if (d < 0)  return '#DC2626'
  if (d < 14) return '#DC2626'
  if (d < 21) return '#EA580C'
  return '#16A34A'
}
