import type { Company } from '@/types/database'

export function companyTradeIds(co: Pick<Company, 'trade_id' | 'trade_ids'> | null | undefined): string[] {
  if (!co) return []
  if (co.trade_ids && co.trade_ids.length > 0) return co.trade_ids
  return co.trade_id ? [co.trade_id] : []
}

export function primaryTradeId(co: Pick<Company, 'trade_id' | 'trade_ids'> | null | undefined): string | null {
  return companyTradeIds(co)[0] ?? null
}

export function displayTradeId(
  co: Pick<Company, 'trade_id' | 'trade_ids'> | null | undefined,
  ivTrade?: string | null,
): string | null {
  const ids = companyTradeIds(co)
  if (ivTrade && ids.includes(ivTrade)) return ivTrade
  return ids[0] ?? ivTrade ?? null
}
