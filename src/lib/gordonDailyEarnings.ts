import { normalizeRealUsername } from '../../lib/importOwnershipTypes'
import { validateAccountUsername } from '../../lib/accountPasswordRules'
import { parseFetchJson } from './readResponseJson'
import { fetchRealUserPasses } from './realPassImport'
import { fetchDailyRaxRows } from './realEarningsImport'
import {
  dailyRowsFromTrackerCard,
  filterCurrentSeasonPasses,
  seasonDailyAccountError,
  seasonDailyPassFromReal,
  seasonDailyPassesFromTrackerData,
  summarizeSeasonDailyAccount,
  summarizeTodayPass,
  type SeasonDailyAccountSummary,
  type SeasonDailyPassInput,
} from './seasonDailyEarnings'
import { todayIsoLocal } from './format'
import type { RaxTrackerData } from '../types/rax'
import type { EarningsBackfillDailyRow, EarningsBackfillPass } from '../../lib/realEarningsShared'

export const GORDON_DAILY_ACCOUNTS_STORAGE_KEY = 'real-rax-tracker:gordon-daily-accounts:v1'
export const MAX_GORDON_DAILY_ACCOUNTS = 20

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

function toBackfillPass(pass: SeasonDailyPassInput): EarningsBackfillPass | null {
  if (pass.entityId <= 0) return null
  return {
    externalKey: pass.externalKey,
    entityId: pass.entityId,
    passKind: pass.passKind,
    sportRaw: pass.sportRaw,
    seasonYear: pass.seasonYear,
    seasonLabel: pass.seasonLabel,
    name: pass.name,
    rarityLabel: pass.rarityLabel,
    avatar: pass.avatar,
  }
}

async function loadSeasonDailyRows(
  current: SeasonDailyPassInput[],
  localData: RaxTrackerData | undefined,
  onProgress?: (progress: SeasonDailyProgress) => void,
  signal?: AbortSignal,
): Promise<Map<string, EarningsBackfillDailyRow[]>> {
  const rowsByKey = new Map<string, EarningsBackfillDailyRow[]>()

  if (localData) {
    const cardsById = new Map(localData.cards.map((card) => [card.id, card]))
    for (const pass of current) {
      if (!pass.cardId) continue
      const card = cardsById.get(pass.cardId)
      if (!card) continue
      rowsByKey.set(pass.externalKey, dailyRowsFromTrackerCard(localData, pass.cardId, card))
    }
    return rowsByKey
  }

  const backfill = current.map(toBackfillPass).filter((pass): pass is EarningsBackfillPass => pass != null)
  if (backfill.length === 0) return rowsByKey

  const result = await fetchDailyRaxRows(backfill, {
    signal,
    onProgress: (progress) =>
      onProgress?.({
        phase: 'earnings',
        current: progress.completed,
        total: progress.total,
        label: `Today’s performances ${progress.completed}/${progress.total}`,
      }),
  })
  for (const [key, rows] of result.rowsByExternalKey) {
    rowsByKey.set(key, rows)
  }
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
  const today = options.today ?? todayIsoLocal()

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

    const rowsByKey = await loadSeasonDailyRows(
      current,
      options.localData,
      options.onProgress,
      options.signal,
    )
    const summaries = current
      .map((pass) => summarizeTodayPass(pass, rowsByKey.get(pass.externalKey) ?? [], today))
      .filter((summary): summary is NonNullable<typeof summary> => summary != null)
    return summarizeSeasonDailyAccount(normalized, today, summaries, current.length, skipped)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not calculate daily earnings.'
    return seasonDailyAccountError(normalized, message, today)
  }
}
