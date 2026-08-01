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
  /** Extra daily packs from swaps (normalized ≥0). */
  dailySwaps: number
  /** openingAccounts + dailySwaps — effective packs opened per day. */
  effectiveDailyOpens: number
  packsNeeded: number
  dailyGain: number
  /** null when no effective opens and rating remains. */
  daysRemaining: number | null
  atTarget: boolean
  progressRatio: number
}

/** Normalize daily-swap count: whole numbers ≥0; invalid → 0. */
export function normalizeDailySwaps(value: number | undefined | null): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

function clampRating(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

/** Keep ≥1 with one decimal for estimate math; invalid values fall back to the default. */
export function normalizeRatingPerPack(value: number | undefined | null): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PACK_RATING_INCREMENT
  return Math.round(n * 10) / 10
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
  tracker: Pick<PackTracker, 'accounts'> & { ratingPerPack?: number; dailySwaps?: number },
  target: number = ICONIC_RATING_TARGET,
): PackProgressEstimate {
  const totalRating = sumAccountRatings(tracker.accounts)
  const remaining = Math.max(0, target - totalRating)
  const ratingPerPack = normalizeRatingPerPack(tracker.ratingPerPack)
  const openingAccounts = countOpeningAccounts(tracker.accounts)
  const dailySwaps = normalizeDailySwaps(tracker.dailySwaps)
  const effectiveDailyOpens = openingAccounts + dailySwaps
  const packsNeeded = remaining === 0 ? 0 : Math.ceil(remaining / ratingPerPack)
  const dailyGain = effectiveDailyOpens * ratingPerPack
  const daysRemaining =
    remaining === 0 ? 0 : dailyGain <= 0 ? null : Math.ceil(remaining / dailyGain)
  const progressRatio = target <= 0 ? 1 : Math.min(1, totalRating / target)

  return {
    totalRating,
    remaining,
    ratingPerPack,
    openingAccounts,
    dailySwaps,
    effectiveDailyOpens,
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

/** True when a row looks like an empty placeholder (no username, no progress). */
export function isBlankPackAccountPlaceholder(account: PackTrackerAccount): boolean {
  if (packUsernameKey(account.username)) return false
  if (clampRating(account.rating) > 0) return false
  if (account.lastImportedAt || account.ownershipStatus || account.rarityLabel) return false
  const name = account.name.trim()
  return name === '' || /^account\s*\d*$/i.test(name)
}

/** Seed pack-tracker rows from shared account templates (rating starts at 0). */
export function accountsFromPackTemplates(
  templates: PackAccountTemplate[],
  createId: (prefix: string) => string,
): PackTrackerAccount[] {
  return templates
    .filter((template) => Boolean(normalizePackUsername(template.username)))
    .map((template) => {
      const username = normalizePackUsername(template.username)
      return {
        id: createId('pacc'),
        name: templateDisplayName(template),
        username,
        rating: 0,
        opensPacks: template.opensPacks,
      }
    })
}

export type ApplyPackTemplatesResult = {
  accounts: PackTrackerAccount[]
  added: number
  updated: number
  removed: number
  renamed: number
}

export type RenamePackUsernameResult = {
  accounts: PackTrackerAccount[]
  renamed: number
  merged: number
}

/** True for close renames like truf → trufff (prefix, small length delta). */
export function isLikelyPackUsernameRename(a: string, b: string): boolean {
  const left = packUsernameKey(a)
  const right = packUsernameKey(b)
  if (!left || !right || left === right) return left === right && Boolean(left)
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (shorter.length < 3) return false
  return longer.startsWith(shorter) && longer.length - shorter.length <= 3
}

function preferPackAccount(a: PackTrackerAccount, b: PackTrackerAccount): PackTrackerAccount {
  const aRating = clampRating(a.rating)
  const bRating = clampRating(b.rating)
  if (aRating !== bRating) return aRating >= bRating ? a : b
  if (Boolean(a.lastImportedAt) !== Boolean(b.lastImportedAt)) {
    return a.lastImportedAt ? a : b
  }
  return a
}

function mergePackAccountDetails(
  survivor: PackTrackerAccount,
  donor: PackTrackerAccount,
  username: string,
): PackTrackerAccount {
  const preferred = preferPackAccount(survivor, donor)
  return {
    ...preferred,
    id: survivor.id,
    username: normalizePackUsername(username) || preferred.username,
    name: survivor.name.trim() ? survivor.name : donor.name,
    opensPacks: survivor.opensPacks || donor.opensPacks,
    rating: Math.max(clampRating(survivor.rating), clampRating(donor.rating)),
    rarityLabel: survivor.rarityLabel || donor.rarityLabel,
    lastImportedAt: survivor.lastImportedAt || donor.lastImportedAt,
    ownershipStatus: survivor.ownershipStatus ?? donor.ownershipStatus,
    ignoredMissing: survivor.ignoredMissing ?? donor.ignoredMissing,
  }
}

function accountIdentityKey(account: PackTrackerAccount): string {
  return packUsernameKey(account.username) || packUsernameKey(account.name)
}

/**
 * Renames a Real username on tracker rows. If both old and new already exist on
 * the same tracker, keeps the richer row (higher rating / import metadata) under
 * the new username and drops the duplicate.
 */
export function renamePackUsernameInAccounts(
  accounts: PackTrackerAccount[],
  fromUsername: string,
  toUsername: string,
): RenamePackUsernameResult {
  const fromKey = packUsernameKey(fromUsername)
  const toUser = normalizePackUsername(toUsername)
  const toKey = toUser.toLowerCase()
  if (!fromKey || !toKey || fromKey === toKey) {
    return { accounts, renamed: 0, merged: 0 }
  }

  const fromIndexes: number[] = []
  let toIndex = -1
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]!
    const key = accountIdentityKey(account)
    if (key === fromKey) fromIndexes.push(i)
    if (packUsernameKey(account.username) === toKey) toIndex = i
  }
  if (fromIndexes.length === 0) {
    return { accounts, renamed: 0, merged: 0 }
  }

  const next = [...accounts]
  let renamed = 0
  let merged = 0

  for (const fromIndex of fromIndexes.sort((a, b) => b - a)) {
    const fromAccount = next[fromIndex]!
    if (toIndex >= 0 && toIndex !== fromIndex) {
      next[toIndex] = mergePackAccountDetails(next[toIndex]!, fromAccount, toUser)
      next.splice(fromIndex, 1)
      if (fromIndex < toIndex) toIndex -= 1
      merged += 1
      continue
    }

    next[fromIndex] = {
      ...fromAccount,
      username: toUser,
    }
    toIndex = fromIndex
    renamed += 1
  }

  return { accounts: next, renamed, merged }
}

/**
 * Ensures each template with a username exists on the tracker.
 * Shared-template usernames are the source of truth on Apply: missing ones are
 * added or renamed onto existing rows; usernames not in the shared list are
 * removed (with rating folded into a likely renamed survivor when possible).
 */
export function applyPackTemplatesToAccounts(
  accounts: PackTrackerAccount[],
  templates: PackAccountTemplate[],
  createId: (prefix: string) => string,
): ApplyPackTemplatesResult {
  let added = 0
  let updated = 0
  let renamed = 0
  const next = [...accounts]
  let appliedUsernameTemplate = false

  const templateUsernames = new Set(
    templates
      .map((template) => packUsernameKey(template.username))
      .filter((key): key is string => Boolean(key)),
  )

  for (const template of templates) {
    const username = normalizePackUsername(template.username)
    const key = username.toLowerCase()
    if (!key) continue
    appliedUsernameTemplate = true

    const name = templateDisplayName(template)
    let index = next.findIndex((account) => packUsernameKey(account.username) === key)

    if (index < 0) {
      // Same shared display name, but username no longer in the shared list.
      index = next.findIndex((account) => {
        if (account.name.trim().toLowerCase() !== name.toLowerCase()) return false
        const accountKey = packUsernameKey(account.username)
        return !accountKey || !templateUsernames.has(accountKey)
      })
      if (index >= 0) renamed += 1
    }

    if (index < 0) {
      // Close rename (truf → trufff), including rows where sync set name ≈ username.
      index = next.findIndex((account) => {
        const accountKey = accountIdentityKey(account)
        if (!accountKey || templateUsernames.has(accountKey)) return false
        return isLikelyPackUsernameRename(accountKey, key)
      })
      if (index >= 0) renamed += 1
    }

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

  let removed = 0
  let resolved = next
  if (appliedUsernameTemplate) {
    const working = [...next]
    for (let i = working.length - 1; i >= 0; i--) {
      const account = working[i]!
      if (isBlankPackAccountPlaceholder(account)) {
        working.splice(i, 1)
        removed += 1
        continue
      }
      const accountKey = packUsernameKey(account.username)
      // Keep manual rows with no username; drop any username not in shared list.
      if (!accountKey) continue
      if (templateUsernames.has(accountKey)) continue

      const accountName = account.name.trim().toLowerCase()
      let survivorIndex = working.findIndex((candidate, candidateIndex) => {
        if (candidateIndex === i) return false
        if (!templateUsernames.has(packUsernameKey(candidate.username))) return false
        return candidate.name.trim().toLowerCase() === accountName
      })
      if (survivorIndex < 0) {
        survivorIndex = working.findIndex((candidate, candidateIndex) => {
          if (candidateIndex === i) return false
          const survivorKey = packUsernameKey(candidate.username)
          if (!survivorKey || !templateUsernames.has(survivorKey)) return false
          return isLikelyPackUsernameRename(accountKey, survivorKey)
        })
      }
      if (survivorIndex >= 0) {
        const survivor = working[survivorIndex]!
        working[survivorIndex] = mergePackAccountDetails(
          survivor,
          account,
          survivor.username || accountKey,
        )
      }
      working.splice(i, 1)
      removed += 1
    }
    // Never leave a tracker with zero accounts after pruning.
    resolved = working.length > 0 ? working : next
    if (working.length === 0) removed = 0
  }

  return { accounts: resolved, added, updated, removed, renamed }
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

export type RemoveFinishedPlannedPassResult = {
  plannedPasses: PlannedPass[]
  packTrackers: PackTracker[]
}

/**
 * Mark a planned pass finished: drop it from Plan and remove any pack tracker
 * linked by `plannedPassId` (not externalKey).
 */
export function removeFinishedPlannedPass(
  plannedPasses: PlannedPass[],
  packTrackers: PackTracker[],
  plannedPassId: string,
): RemoveFinishedPlannedPassResult {
  return {
    plannedPasses: plannedPasses.filter((pass) => pass.id !== plannedPassId),
    packTrackers: packTrackers.filter((tracker) => tracker.plannedPassId !== plannedPassId),
  }
}

export function formatMarkPackFinishedConfirmMessage(passName: string): string {
  const label = passName.trim() || 'this pass'
  return `Mark “${label}” as finished? This removes it from Packs and your purchase plan.`
}
