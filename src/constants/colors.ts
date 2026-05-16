export type TradeColorKey =
  | 'crimson' | 'orange' | 'amber' | 'brown' | 'forest' | 'lime'
  | 'navy' | 'sky' | 'violet' | 'pink' | 'slate' | 'blue' | 'green' | 'gold' | 'teal'

export interface TradeColor {
  b: string   // border / accent
  bg: string  // background light
  bgD: string // background dark
  t: string   // text
}

export const TRADE_COLORS: Record<TradeColorKey, TradeColor> = {
  crimson: { b: '#B91C1C', bg: '#FEF2F2', bgD: 'rgba(185,28,28,.18)',   t: '#7F1D1D' },
  orange:  { b: '#F97316', bg: '#FFF7ED', bgD: 'rgba(249,115,22,.18)',  t: '#7C2D12' },
  amber:   { b: '#D97706', bg: '#FFFBEB', bgD: 'rgba(217,119,6,.18)',   t: '#78350F' },
  brown:   { b: '#92400E', bg: '#FEF3C7', bgD: 'rgba(146,64,14,.18)',   t: '#451A03' },
  forest:  { b: '#166534', bg: '#F0FDF4', bgD: 'rgba(22,101,52,.18)',   t: '#14532D' },
  lime:    { b: '#4ADE80', bg: '#F0FDF4', bgD: 'rgba(74,222,128,.18)',  t: '#166534' },
  navy:    { b: '#1E3A8A', bg: '#EFF6FF', bgD: 'rgba(30,58,138,.18)',   t: '#172554' },
  sky:     { b: '#38BDF8', bg: '#F0F9FF', bgD: 'rgba(56,189,248,.18)',  t: '#0C4A6E' },
  violet:  { b: '#7C3AED', bg: '#F5F3FF', bgD: 'rgba(124,58,237,.18)', t: '#4C1D95' },
  pink:    { b: '#EC4899', bg: '#FDF2F8', bgD: 'rgba(236,72,153,.18)',  t: '#831843' },
  slate:   { b: '#475569', bg: '#F8FAFC', bgD: 'rgba(71,85,105,.18)',   t: '#1E293B' },
  blue:    { b: '#3B82F6', bg: '#EFF6FF', bgD: 'rgba(59,130,246,.18)',  t: '#1E3A5F' },
  green:   { b: '#16A34A', bg: '#F0FDF4', bgD: 'rgba(22,163,74,.18)',   t: '#14532D' },
  gold:    { b: '#CA8A04', bg: '#FEFCE8', bgD: 'rgba(202,138,4,.18)',   t: '#713F12' },
  teal:    { b: '#0D9488', bg: '#F0FDFA', bgD: 'rgba(13,148,136,.18)',  t: '#134E4A' },
}

export const FLOOR_COLORS: Record<string, string> = {
  'R+3': '#2152C8',
  'R+2': '#0D9488',
  'R+1': '#8B5CF6',
  'R+4': '#F49E0B',
  'TTN': '#EB24D0',
  'RDC': '#40EDAF',
}

export function hexToRgb(hex: string) {
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean
  if (full.length !== 6) return { r: 59, g: 130, b: 246 }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

export function rgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

export function getTradeColor(colorId: string, dark = false): TradeColor & { text?: string; mutedText?: string; border?: string } {
  const base = TRADE_COLORS[colorId as TradeColorKey] ?? TRADE_COLORS.blue
  if (!dark) return base
  return {
    ...base,
    bg: rgba(base.b, 0.18),
    bgD: rgba(base.b, 0.24),
    t: '#F8FAFC',
    text: '#F8FAFC',
    mutedText: '#CBD5E1',
    border: rgba(base.b, 0.58),
  }
}

export function getZoneFloorColor(zones: { floor: string; floor_color: string }[], floor: string): string {
  const match = zones.find(z => z.floor === floor && /^#[0-9A-Fa-f]{6}$/.test(z.floor_color))
  return match?.floor_color ?? FLOOR_COLORS[floor] ?? '#9CA3AF'
}
