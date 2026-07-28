import type {
  PackAccountTemplate,
  PackTracker,
  PackTrackerAccount,
  PlannedPass,
} from '../types/rax'

/** Rating needed to reach Iconic. */
export const ICONIC_RATING_TARGET = 3380

/** Default estimate divisor when a tracker has no saved rating-per-pack. */
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

/** Floor to ≥1 for estimate math; invalid values fall back to the default. */
export function normalizeRatingPerPack(value: number | undefined | null): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PACK_RATING_INCREMENT
  return Math.floor(n)
}

export function sumAccountRatings(accounts: PackTrackerAccount[]): number {
  return accounts.reduce((sum, account) => sum + clampRating(account.rating), 0)
}

/**
 * Whether an account counts toward daily pack opens for estimates.
 * Non-ignored missing ownership is treated as not opening, even if the checkbox is on.
 */
export function accountCountsAsOpeningPacks(account: PackTrackerAccount): boolean {
  if (!account.opensPacks) return false
  if (account.ownershipStatus === 'missing' && account.ignoredMissing !== true) return false
  return true
}

export function countOpeningAccounts(accounts: PackTrackerAccount[]): number {
  return accounts.filter(accountCountsAsOpeningPacks).length
}

export function estimatePackProgress(
  tracker: Pick<PackTracker, 'accounts'> & { ratingPerPack?: number },
  target: number = ICONIC_RATING_TARGET,
): PackProgressEstimate {
  const totalRating = sumAccountRatings(tracker.accounts)
  const remaining = Math.max(0, target - totalRating)
  const ratingPerPack = normalizeRatingPerPack(tracker.ratingPerPack)
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

export function normalizePackUsername(raw: string | undefined): string {
  return (raw ?? '').replace(/^@/, '').trim()
}

export function packUsernameKey(raw: string | undefined): string {
  return normalizePackUsername(raw).toLowerCase()
}

function templateDisplayName(template: Pick<PackAccountTemplate, 'name' | 'username'>): string {
  const name = template.name.trim()
  if (name) return name
  return normalizePackUsername(template.username) || 'Account'
}

/** Seed pack-tracker rows from shared account templates (rating starts at 0). */
export function accountsFromPackTemplates(
  templates: PackAccountTemplate[],
  createId: (prefix: string) => string,
): PackTrackerAccount[] {
  return templates.map((template) => {
    const username = normalizePackUsername(template.username)
    return {
      id: createId('pacc'),
      name: templateDisplayName(template),
      username: username || undefined,
      rating: 0,
      opensPacks: template.opensPacks,
    }
  })
}

export type ApplyPackTemplatesResult = {
  accounts: PackTrackerAccount[]
  added: number
  updated: number
}

/**
 * Ensures each template with a username exists on the tracker.
 * Matches by username (case-insensitive). Updates name / username / opensPacks
 * without wiping rating or import metadata. Adds missing rows at rating 0.
 */
export function applyPackTemplatesToAccounts(
  accounts: PackTrackerAccount[],
  templates: PackAccountTemplate[],
  createId: (prefix: string) => string,
): ApplyPackTemplatesResult {
  let added = 0
  let updated = 0
  const next = [...accounts]

  for (const template of templates) {
    const username = normalizePackUsername(template.username)
    const key = username.toLowerCase()
    if (!key) continue

    const name = templateDisplayName(template)
    const index = next.findIndex((account) => packUsernameKey(account.username) === key)

    if (index >= 0) {
      const existing = next[index]!
      if (
        existing.name !== name ||
        normalizePackUsername(existing.username) !== username ||
        existing.opensPacks !== template.opensPacks
      ) {
        next[index] = {
          ...existing,
          name,
          username,
          opensPacks: template.opensPacks,
        }
        updated += 1
      }
      continue
    }

    next.push({
      id: createId('pacc'),
      name,
      username,
      rating: 0,
      opensPacks: template.opensPacks,
    })
    added += 1
  }

  return { accounts: next, added, updated }
}

/** One tracked pass row for a single Real account across pack trackers. */
export type AccountPackTrackerRow = {
  plannedPassId: string
  passName: string
  sport: string
  season: string
  accountRating: number
  opensPacks: boolean
  ownershipStatus?: PackTrackerAccount['ownershipStatus']
  rarityLabel?: string
  ignoredMissing?: boolean
  trackerTotal: number
  daysRemaining: number | null
  atTarget: boolean
  progressRatio: number
}

/**
 * Account-centric pack view: every tracker row matching `username`
 * (case-insensitive), joined to planned pass labels when available.
 */
export function summarizeAccountAcrossPacks(
  username: string,
  plannedPasses: PlannedPass[],
  packTrackers: PackTracker[],
): AccountPackTrackerRow[] {
  const key = packUsernameKey(username)
  if (!key) return []

  const passById = new Map(plannedPasses.map((pass) => [pass.id, pass]))
  const rows: AccountPackTrackerRow[] = []

  for (const tracker of packTrackers) {
    const estimate = estimatePackProgress(tracker)
    const pass = passById.get(tracker.plannedPassId)
    for (const account of tracker.accounts) {
      if (packUsernameKey(account.username) !== key) continue
      rows.push({
        plannedPassId: tracker.plannedPassId,
        passName: pass?.name?.trim() || 'Tracked pass',
        sport: pass?.sport ?? '—',
        season: pass?.season ?? '—',
        accountRating: clampRating(account.rating),
        opensPacks: account.opensPacks,
        ownershipStatus: account.ownershipStatus,
        rarityLabel: account.rarityLabel,
        ignoredMissing: account.ignoredMissing,
        trackerTotal: estimate.totalRating,
        daysRemaining: estimate.daysRemaining,
        atTarget: estimate.atTarget,
        progressRatio: estimate.progressRatio,
      })
    }
  }

  return rows.sort((a, b) => {
    if (a.atTarget !== b.atTarget) return a.atTarget ? 1 : -1
    if (a.daysRemaining === null && b.daysRemaining === null) {
      return a.passName.localeCompare(b.passName)
    }
    if (a.daysRemaining === null) return 1
    if (b.daysRemaining === null) return -1
    if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining
    return a.passName.localeCompare(b.passName)
  })
}
