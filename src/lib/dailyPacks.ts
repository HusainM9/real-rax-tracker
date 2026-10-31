export { safeAccountAvatarUrl } from '../../lib/accountAvatar'
export type PackRatingTarget = 380 | 1380 | 3380
export type PackObservation = {
  username: string
  day: string
  baselineRating: number
  baselineAt: string
  lastRating: number
  lastCheckedAt: string
  comparisons: number
  likelyOpenedAt?: string
}
export type PackScanMetadata = { fetchedAt?: string; startedAt?: string; avatarUrl?: string }
export type AccountProfile = { username: string; avatarUrl?: string }

const easternClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
})
export function packDay(now = new Date()): string {
  const parts = Object.fromEntries(easternClock.formatToParts(now).map(part => [part.type, part.value]))
  return new Date(Date.UTC(+parts.year!, +parts.month! - 1, +parts.day! - (+parts.hour! < 7 ? 1 : 0))).toISOString().slice(0, 10)
}
export function normalizePackRatingTarget(value: unknown): PackRatingTarget {
  return value === 380 || value === 1380 ? value : 3380
}
export function hydratePackObservation(value: unknown): PackObservation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as PackObservation
  const baseline = Date.parse(item.baselineAt), checked = Date.parse(item.lastCheckedAt)
  if (typeof item.username !== 'string' || !item.username.trim() || !Number.isFinite(baseline)
    || !Number.isFinite(checked) || checked < baseline || item.day !== packDay(new Date(checked))
    || item.day !== packDay(new Date(baseline)) || !Number.isFinite(item.baselineRating) || item.baselineRating < 0
    || !Number.isFinite(item.lastRating) || item.lastRating < 0 || !Number.isInteger(item.comparisons) || item.comparisons < 0) return undefined
  const opened = item.likelyOpenedAt ? Date.parse(item.likelyOpenedAt) : undefined
  if (opened !== undefined && (!Number.isFinite(opened) || opened < baseline || opened > checked)) return undefined
  return { username: item.username.trim().toLowerCase(), day: item.day, baselineRating: item.baselineRating,
    baselineAt: item.baselineAt, lastRating: item.lastRating, lastCheckedAt: item.lastCheckedAt,
    comparisons: item.comparisons, likelyOpenedAt: item.likelyOpenedAt }
}
export function observePackRating(previous: PackObservation | undefined, reading: PackScanMetadata & { rating: number; username: string }): PackObservation | undefined {
  const stamp = Date.parse(reading.fetchedAt ?? ''), start = Date.parse(reading.startedAt ?? '')
  if (!Number.isFinite(stamp) || !Number.isFinite(reading.rating) || reading.rating < 0) return previous
  const username = reading.username.trim().replace(/^@/, '').toLowerCase()
  if (!username) return previous
  const sameUser = previous?.username === username
  if (sameUser && stamp <= Date.parse(previous.lastCheckedAt)) return previous
  const day = packDay(new Date(stamp))
  const spansReset = !Number.isFinite(start) || start > stamp || packDay(new Date(start)) !== day
  if (sameUser && previous.day === day && spansReset) return previous
  if (!sameUser || previous.day !== day || spansReset) return {
    username, day, baselineRating: reading.rating, baselineAt: reading.fetchedAt!,
    lastRating: reading.rating, lastCheckedAt: reading.fetchedAt!, comparisons: 0,
  }
  return { ...previous, lastRating: reading.rating, lastCheckedAt: reading.fetchedAt!, comparisons: previous.comparisons + 1,
    likelyOpenedAt: previous.likelyOpenedAt ?? (reading.rating > previous.lastRating ? reading.fetchedAt : undefined) }
}
export function openingStatus(observation: PackObservation | undefined, username: string, now = new Date()): 'unknown' | 'not-detected' | 'likely-opened' {
  if (!observation || observation.username !== username.trim().replace(/^@/, '').toLowerCase()
    || observation.day !== packDay(now) || Date.parse(observation.lastCheckedAt) > +now) return 'unknown'
  return observation.likelyOpenedAt ? 'likely-opened' : observation.comparisons > 0 ? 'not-detected' : 'unknown'
}
