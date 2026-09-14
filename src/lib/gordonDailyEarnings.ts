import { normalizeRealUsername } from '../../lib/importOwnershipTypes'
import { validateAccountUsername } from '../../lib/accountPasswordRules'
import { parseFetchJson } from './readResponseJson'
import { fetchRealUserPasses } from './realPassImport'
import {
  filterCurrentSeasonPasses,
  seasonDailyAccountError,
  seasonDailyPassFromReal,
  seasonDailyPassesFromTrackerData,
  summarizeSeasonDailyAccount,
  summarizeTodayPass,
  realDailyGameDay,
  type SeasonDailyAccountSummary,
  type SeasonDailyPassInput,
} from './seasonDailyEarnings'
import type { RaxTrackerData } from '../types/rax'
import type { EarningsBackfillDailyRow } from '../../lib/realEarningsShared'

export const GORDON_DAILY_ACCOUNTS_STORAGE_KEY = 'real-rax-tracker:gordon-daily-accounts:v1'
export const MAX_GORDON_DAILY_ACCOUNTS = 20
export const GORDON_DAILY_LIVE_ENDPOINT = '/api/gordon/daily-live'

export type GordonAccountProfileSummary = {
  username: string
  updatedAt: string
  cardCount: number
  performanceCount: number
}

export type SeasonDailyProgress = {
  phase: 'resolving' | 'earnings'
  current: number
  total: number
  label: string
}

export {
  seasonDailyAccountError,
  type SeasonDailyAccountSummary,
} from './seasonDailyEarnings'

export function normalizeGordonDailyUsernames(
  values: Iterable<string>,
  ownUsername: string,
): string[] {
  const own = normalizeRealUsername(ownUsername)
  const seen = new Set<string>()
  const result: string[] = []
  if (own) {
    seen.add(own)
    result.push(own)
  }
  for (const value of values) {
    const username = normalizeRealUsername(value)
    if (!username || seen.has(username)) continue
    seen.add(username)
    result.push(username)
    if (result.length >= MAX_GORDON_DAILY_ACCOUNTS) break
  }
  return result
}

export function parseGordonDailyUsernameInput(value: string): { ok: true; username: string } | { ok: false; error: string } {
  return validateAccountUsername(value)
}

export function loadSelectedGordonDailyAccounts(ownUsername: string): string[] {
  const own = normalizeRealUsername(ownUsername)
  if (typeof window === 'undefined') return own ? [own] : []
  try {
    const raw = window.localStorage.getItem(GORDON_DAILY_ACCOUNTS_STORAGE_KEY)
    if (!raw) return own ? [own] : []
    const parsed = JSON.parse(raw) as unknown
    const values = Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
    return normalizeGordonDailyUsernames(values, ownUsername)
  } catch {
    return own ? [own] : []
  }
}

export function saveSelectedGordonDailyAccounts(usernames: string[], ownUsername: string): string[] {
  const normalized = normalizeGordonDailyUsernames(usernames, ownUsername)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(GORDON_DAILY_ACCOUNTS_STORAGE_KEY, JSON.stringify(normalized))
  }
  return normalized
}

export async function fetchGordonAccountList(): Promise<GordonAccountProfileSummary[]> {
  const response = await fetch('/api/gordon/accounts', { credentials: 'include' })
  const payload = await parseFetchJson<{ profiles?: GordonAccountProfileSummary[] }>(
    response,
    'Could not load accounts',
  )
  return Array.isArray(payload.profiles) ? payload.profiles : []
}

async function loadLiveDailyRows(
  current: SeasonDailyPassInput[],
  claimDay: string,
  onProgress?: (progress: SeasonDailyProgress) => void,
  signal?: AbortSignal,
): Promise<Map<string, EarningsBackfillDailyRow[]>> {
  const rowsByKey = new Map<string, EarningsBackfillDailyRow[]>()
  if (current.length === 0) return rowsByKey

  onProgress?.({
    phase: 'earnings',
    current: 0,
    total: current.length,
    label: 'Loading live game RAX',
  })

  const response = await fetch(GORDON_DAILY_LIVE_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      day: claimDay,
      passes: current.map((pass) => ({
        externalKey: pass.externalKey,
        entityId: pass.entityId,
        sportRaw: pass.sportRaw,
        seasonYear: pass.seasonYear,
        passKind: pass.passKind,
        teamId: pass.teamId,
      })),
    }),
    signal,
  })
  const payload = await parseFetchJson<{
    rows?: Array<{ externalKey?: string; claimDay?: string; baseRaxEarned?: number }>
  }>(response, 'Could not load live daily RAX')

  for (const row of payload.rows ?? []) {
    const key = typeof row.externalKey === 'string' ? row.externalKey : ''
    const day = typeof row.claimDay === 'string' ? row.claimDay : claimDay
    const earned = Number(row.baseRaxEarned)
    if (!key || !Number.isFinite(earned) || earned <= 0) continue
    rowsByKey.set(key, [{ claimDay: day, baseRaxEarned: earned }])
  }

  onProgress?.({
    phase: 'earnings',
    current: current.length,
    total: current.length,
    label: `Live RAX for ${rowsByKey.size} pass${rowsByKey.size === 1 ? '' : 'es'}`,
  })
  return rowsByKey
}

export async function calculateSeasonDailyForUsername(
  username: string,
  options: {
    localData?: RaxTrackerData
    today?: string
    signal?: AbortSignal
    onProgress?: (progress: SeasonDailyProgress) => void
  } = {},
): Promise<SeasonDailyAccountSummary> {
  const normalized = normalizeRealUsername(username)
  const today = options.today ?? realDailyGameDay()

  try {
    options.onProgress?.({
      phase: 'resolving',
      current: 0,
      total: 1,
      label: options.localData ? 'Using local collection' : `Loading @${normalized} passes`,
    })

    let inputs: SeasonDailyPassInput[]
    if (options.localData) {
      inputs = seasonDailyPassesFromTrackerData(options.localData)
    } else {
      const resolved = await fetchRealUserPasses(normalized, options.signal)
      inputs = [...resolved.playerPasses, ...resolved.teamPasses]
        .map(seasonDailyPassFromReal)
        .filter((pass): pass is SeasonDailyPassInput => pass != null)
    }

    const { current, skipped } = filterCurrentSeasonPasses(inputs, today)
    options.onProgress?.({
      phase: 'earnings',
      current: 0,
      total: current.length,
      label: `${current.length} current-season passes`,
    })

    const rowsByKey = await loadLiveDailyRows(current, today, options.onProgress, options.signal)
    const summaries = current
      .map((pass) => summarizeTodayPass(pass, rowsByKey.get(pass.externalKey) ?? [], today))
      .filter((summary): summary is NonNullable<typeof summary> => summary != null)

    return summarizeSeasonDailyAccount(normalized, today, summaries, current.length, skipped)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not calculate daily earnings.'
    return seasonDailyAccountError(normalized, message, today)
  }
}
