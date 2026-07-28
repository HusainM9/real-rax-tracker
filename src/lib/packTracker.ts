import type { PackTracker, PackTrackerAccount } from '../types/rax'

/** Rating needed to reach Iconic. */
export const ICONIC_RATING_TARGET = 3380

/** Minimum rating a daily player pack grants — used only for remaining-pack estimates. */
export const DEFAULT_PACK_RATING_INCREMENT = 10

export type PackProgressEstimate = {
  totalRating: number
  remaining: number
  ratingPerPack: number
  openingAccounts: number
  packsNeeded: number
  dailyGain: number
  /** null when no accounts open packs and rating remains. */
  daysRemaining: number | null
  atTarget: boolean
  progressRatio: number
}

function clampRating(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

export function sumAccountRatings(accounts: PackTrackerAccount[]): number {
  return accounts.reduce((sum, account) => sum + clampRating(account.rating), 0)
}

export function countOpeningAccounts(accounts: PackTrackerAccount[]): number {
  return accounts.filter((account) => account.opensPacks).length
}

export function estimatePackProgress(
  tracker: Pick<PackTracker, 'accounts'> & { ratingPerPack?: number },
  target: number = ICONIC_RATING_TARGET,
): PackProgressEstimate {
  const totalRating = sumAccountRatings(tracker.accounts)
  const remaining = Math.max(0, target - totalRating)
  const ratingPerPack = DEFAULT_PACK_RATING_INCREMENT
  const openingAccounts = countOpeningAccounts(tracker.accounts)
  const packsNeeded = remaining === 0 ? 0 : Math.ceil(remaining / ratingPerPack)
  const dailyGain = openingAccounts * ratingPerPack
  const daysRemaining =
    remaining === 0 ? 0 : dailyGain <= 0 ? null : Math.ceil(remaining / dailyGain)
  const progressRatio = target <= 0 ? 1 : Math.min(1, totalRating / target)

  return {
    totalRating,
    remaining,
    ratingPerPack,
    openingAccounts,
    packsNeeded,
    dailyGain,
    daysRemaining,
    atTarget: remaining === 0,
    progressRatio,
  }
}

/** Add whole calendar days to a local date (preserves local timezone). */
export function addCalendarDays(from: Date, days: number): Date {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  next.setDate(next.getDate() + days)
  return next
}

/** Projected finish date from days remaining, or null when unknown. */
export function projectedFinishDate(
  daysRemaining: number | null,
  from: Date = new Date(),
): Date | null {
  if (daysRemaining === null) return null
  return addCalendarDays(from, daysRemaining)
}

export function formatProjectedFinishDate(
  daysRemaining: number | null,
  from: Date = new Date(),
): string {
  if (daysRemaining === null) return '—'
  if (daysRemaining === 0) return 'Done'
  const date = projectedFinishDate(daysRemaining, from)
  if (!date) return '—'
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
