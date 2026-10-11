import { readResponseJson } from './readResponseJson'

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

export type EarningsTrackingResult = {
  tracked: string[]
  snapshots: DailyEarningsResult[]
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
  signal?: AbortSignal,
): Promise<DailyEarningsResult> {
  const response = await fetch('/api/account/earnings', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, day, before: 0 }),
    signal,
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
  const response = await fetch('/api/account/earnings-tracking', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames }),
    signal,
  })
  const data = await readResponseJson<EarningsTrackingResult & { error?: string }>(response)
  if (!response.ok) throw new Error(data.error || `Tracking request failed (${response.status}).`)
  return data
}
