import { kv } from '@vercel/kv'
import { adminStorageConfigured } from './adminEventStore.js'
import { normalizeRealUsernameInput } from './realApi.js'
import type { PublicDailyEarningsResult } from './publicDailyEarnings.js'

const TRACKED_USERS_KEY = 'rax:public-earnings:usernames'
const SNAPSHOT_PREFIX = 'rax:public-earnings:snapshot:'
const SNAPSHOT_DAYS_PREFIX = 'rax:public-earnings:days:'

function normalizedKey(username: string): string {
  return normalizeRealUsernameInput(username).toLowerCase()
}

function snapshotKey(username: string, day: string): string {
  return `${SNAPSHOT_PREFIX}${normalizedKey(username)}:${day}`
}

function snapshotDaysKey(username: string): string {
  return `${SNAPSHOT_DAYS_PREFIX}${normalizedKey(username)}`
}

/** Replaces the scheduled account set with the usernames currently linked in the UI. */
export async function syncTrackedEarningsUsernames(usernames: string[]): Promise<string[]> {
  const desired = [...new Set(usernames.map(normalizedKey).filter(Boolean))].sort()
  if (!adminStorageConfigured()) return desired
  const existing = await kv.smembers(TRACKED_USERS_KEY)
  for (const username of existing) {
    if (!desired.includes(username)) await kv.srem(TRACKED_USERS_KEY, username)
  }
  for (const username of desired) await kv.sadd(TRACKED_USERS_KEY, username)
  return desired
}

export async function listTrackedEarningsUsernames(): Promise<string[]> {
  if (!adminStorageConfigured()) return []
  return (await kv.smembers(TRACKED_USERS_KEY)).sort()
}

export async function readPublicEarningsSnapshot(
  username: string,
  day: string,
): Promise<PublicDailyEarningsResult | null> {
  if (!adminStorageConfigured()) return null
  return (await kv.get<PublicDailyEarningsResult>(snapshotKey(username, day))) ?? null
}

export async function savePublicEarningsSnapshot(
  result: PublicDailyEarningsResult,
): Promise<void> {
  if (!adminStorageConfigured()) return
  await kv.set(snapshotKey(result.username, result.day), result)
  await kv.sadd(snapshotDaysKey(result.username), result.day)
}

export async function listPublicEarningsSnapshots(
  usernames: string[],
  limitPerAccount = 90,
): Promise<PublicDailyEarningsResult[]> {
  if (!adminStorageConfigured()) return []
  const snapshots: PublicDailyEarningsResult[] = []
  for (const username of [...new Set(usernames.map(normalizedKey).filter(Boolean))]) {
    const days = (await kv.smembers(snapshotDaysKey(username)))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, Math.max(1, limitPerAccount))
    const rows = await Promise.all(days.map((day) => readPublicEarningsSnapshot(username, day)))
    snapshots.push(...rows.filter((row): row is PublicDailyEarningsResult => row !== null))
  }
  return snapshots.sort(
    (a, b) => a.day.localeCompare(b.day) || a.username.localeCompare(b.username),
  )
}
