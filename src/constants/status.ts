import type { Status } from '@/types/database'

export interface StatusMeta {
  label: string
  dot: string
  text: string
  bg: string
  pill: string
}

export const STATUS_META: Record<Status, StatusMeta> = {
  arealis:   { label: 'À réaliser', dot: '#9CA3AF', text: '#4B5563', bg: 'rgba(156,163,175,.13)', pill: '#6B7280' },
  encours:   { label: 'En cours',   dot: '#2563EB', text: '#1D4ED8', bg: 'rgba(37,99,235,.12)',   pill: '#2563EB' },
  termine:   { label: 'Terminé',    dot: '#16A34A', text: '#065F46', bg: 'rgba(22,163,74,.12)',   pill: '#16A34A' },
  bloque:    { label: 'Bloqué',     dot: '#DC2626', text: '#991B1B', bg: 'rgba(220,38,38,.12)',   pill: '#DC2626' },
  en_retard: { label: 'En retard',  dot: '#EA580C', text: '#9A3412', bg: 'rgba(234,88,12,.13)',   pill: '#EA580C' },
}

export const STATUS_OPTIONS: Status[] = ['arealis', 'encours', 'termine', 'bloque', 'en_retard']
