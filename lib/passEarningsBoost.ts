/**
 * Extra RAX from a one-day booster card. Real's pass `boostValue` / `boostValueDisplay`
 * are play rating (often thousands), not this. 0 means no booster addend.
 */

const MAX_EARNINGS_BOOST_MULTIPLIER = 250

export function parseExplicitMultiplier(value: string | null | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*x$/i.exec((value ?? '').trim())
  if (!match) return null
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_EARNINGS_BOOST_MULTIPLIER) return null
  return parsed
}

/** @returns booster multiplier when the string is like `15x`; otherwise 1 (none). */
export function parsePassBoostMultiplier(
  _boostValue?: number | string | null,
  boostValueDisplay?: string | null,
): number {
  if (typeof _boostValue === 'string') {
    const fromValue = parseExplicitMultiplier(_boostValue)
    if (fromValue != null && fromValue > 1) return fromValue
  }
  const fromDisplay = parseExplicitMultiplier(boostValueDisplay)
  if (fromDisplay != null && fromDisplay > 1) return fromDisplay
  return 1
}

/** Amount added to the rarity multiplier. No booster → 0, not 1. */
export function boostAddend(multiplier: number): number {
  return Number.isFinite(multiplier) && multiplier > 1 ? multiplier : 0
}

export function parseBoosterCardMultiplier(info: unknown): number {
  if (typeof info === 'string') {
    const parsed = parseExplicitMultiplier(info)
    return parsed != null && parsed > 1 ? parsed : 0
  }
  if (!info || typeof info !== 'object') return 0
  const rec = info as Record<string, unknown>
  for (const key of ['multiplier', 'boostValueDisplay', 'boostDisplay', 'valueDisplay']) {
    const raw = rec[key]
    const parsed =
      typeof raw === 'string' || typeof raw === 'number' ? parseExplicitMultiplier(String(raw)) : null
    if (parsed != null && parsed > 1) return parsed
  }
  if (rec.boostInfo && rec.boostInfo !== info) return parseBoosterCardMultiplier(rec.boostInfo)
  if (rec.card && rec.card !== info) return parseBoosterCardMultiplier(rec.card)
  return 0
}

/** Reads Real `boostInfo.multiplier` strings like `150x`. */
export function parseRarityMultiplierLabel(label?: string | null): number | null {
  const match = /(\d+(?:\.\d+)?)\s*x/i.exec((label ?? '').trim())
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
