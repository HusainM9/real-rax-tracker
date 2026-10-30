import { safeFetch } from "./safeImportFetch"
import { readResponseJson } from './readResponseJson'
import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'

export type DailyEarningsRow = {
  id: string
  totalEarnings: number
  pass: {
    id: string
    label: string
    sport: string
    season: string
    entityType: string
    avatar: string
    rarityLabel: string
  }
  infos: Array<{ id: string; type: string; label: string; value: string }>
}

export type DailyEarningsResult = {
  source?: 'public_reconstruction'
  capturedAt?: string
  username: string
  day: string
  dayDisplay: string
  emptyMessage: string
  earnings: DailyEarningsRow[]
  dailyTotal: number
}

export type DailyEarningsResultCache = Record<string, DailyEarningsResult>

function earningsCacheKey(username: string): string {
  return username.replace(/^@/, '').trim().toLowerCase()
}

function datedEarningsCacheKey(username: string, day: string): string {
  return `${earningsCacheKey(username)}|${day}`
}

export function cacheDailyEarningsResult(
  current: DailyEarningsResultCache,
  result: DailyEarningsResult,
): DailyEarningsResultCache {
  return { ...current, [datedEarningsCacheKey(result.username, result.day)]: result }
}

export function cacheDailyEarningsResults(current: DailyEarningsResultCache, results: DailyEarningsResult[]): DailyEarningsResultCache {
  const next = { ...current }
  for (const result of results) next[datedEarningsCacheKey(result.username, result.day)] = result
  return next
}

export function readCachedDailyEarningsResults(
  cache: DailyEarningsResultCache,
  usernames: string[],
  day: string,
): DailyEarningsResult[] {
  return usernames.flatMap((username) => {
    const result = cache[datedEarningsCacheKey(username, day)]
    return result ? [result] : []
  })
}

export type EarningsTrackingResult = {
  tracked: string[]
  snapshots: DailyEarningsResult[]
  historyLimitPerAccount?: number
}

export class DailyEarningsRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code = '') {
    super(message)
    this.name = 'DailyEarningsRequestError'
    this.status = status
    this.code = code
  }
}

export async function fetchAccountDailyEarnings(
  username: string,
  day: string,
  options: { signal?: AbortSignal; refreshId?: string } = {},
): Promise<DailyEarningsResult> {
  const response = await safeFetch('/api/account/earnings', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, day, before: 0, refreshId: options.refreshId }),
    signal: options.signal,
  })
  const data = await readResponseJson<DailyEarningsResult & { error?: string; code?: string }>(response)
  if (!response.ok) {
    throw new DailyEarningsRequestError(
      data.error || `Earnings request failed (${response.status}).`,
      response.status,
      data.code,
    )
  }
  return data
}

export async function syncLinkedEarningsTracking(
  usernames: string[],
  signal?: AbortSignal,
): Promise<EarningsTrackingResult> {
  const response = await safeFetch('/api/account/earnings-tracking', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames, compressed: true }),
    signal,
  })
  const data = await readResponseJson<EarningsTrackingResult & { error?: string; snapshotsEncoding?: string; snapshotsPayload?: string }>(response)
  if (!response.ok) throw new Error(data.error || `Tracking request failed (${response.status}).`)
  if (data.snapshotsEncoding === 'gzip-base64' && data.snapshotsPayload) {
    const decoded = await gunzipBase64ToJson(data.snapshotsPayload)
    if (!Array.isArray(decoded)) throw new Error('Invalid earnings history response.')
    data.snapshots = decoded as DailyEarningsResult[]
  }
  return data
}
