import { kv } from '@vercel/kv'
import {
  createAdminEvent,
  filterAdminEvents,
  mergeUserSummary,
  parseAdminEvent,
  type AdminEvent,
  type AdminEventInput,
  type AdminEventType,
  type AdminUserSummary,
} from './adminEventTypes'

const EVENTS_KEY = 'rax:events'
const USERNAMES_KEY = 'rax:usernames'
const USER_STATS_PREFIX = 'rax:userstats:'
const MAX_EVENTS = 5000

export function adminStorageConfigured(): boolean {
  const url = process.env.KV_REST_API_URL?.trim() ?? ''
  const token = process.env.KV_REST_API_TOKEN?.trim() ?? ''
  const strip = (value: string) => {
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      return value.slice(1, -1).trim()
    }
    return value
  }
  return Boolean(strip(url) && strip(token))
}

function userStatsKey(realUsername: string): string {
  return `${USER_STATS_PREFIX}${realUsername}`
}

export async function appendAdminEvents(inputs: AdminEventInput[]): Promise<number> {
  if (!adminStorageConfigured() || inputs.length === 0) return 0

  const events = inputs.map((input) => createAdminEvent(input))
  for (const event of events) {
    await kv.lpush(EVENTS_KEY, JSON.stringify(event))
    await kv.sadd(USERNAMES_KEY, event.realUsername)
    const statsKey = userStatsKey(event.realUsername)
    const existing = (await kv.get<AdminUserSummary>(statsKey)) ?? null
    await kv.set(statsKey, mergeUserSummary(existing, event))
  }
  await kv.ltrim(EVENTS_KEY, 0, MAX_EVENTS - 1)
  return events.length
}

export async function listAdminEvents(options: {
  type?: AdminEventType
  username?: string
  limit?: number
  offset?: number
}): Promise<{ events: AdminEvent[]; total: number; storageConfigured: boolean }> {
  if (!adminStorageConfigured()) {
    return { events: [], total: 0, storageConfigured: false }
  }

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const offset = Math.max(options.offset ?? 0, 0)
  const raw = await kv.lrange<string>(EVENTS_KEY, 0, MAX_EVENTS - 1)
  const parsed = raw
    .map((entry) => {
      try {
        return parseAdminEvent(typeof entry === 'string' ? JSON.parse(entry) : entry)
      } catch {
        return null
      }
    })
    .filter((event): event is AdminEvent => event !== null)

  const filtered = filterAdminEvents(parsed, {
    type: options.type,
    username: options.username,
  })

  return {
    events: filtered.slice(offset, offset + limit),
    total: filtered.length,
    storageConfigured: true,
  }
}

export async function listAdminUsers(): Promise<{
  users: AdminUserSummary[]
  storageConfigured: boolean
}> {
  if (!adminStorageConfigured()) {
    return { users: [], storageConfigured: false }
  }

  const usernames = await kv.smembers(USERNAMES_KEY)
  const users = await Promise.all(
    usernames.map(async (username) => {
      const stats = await kv.get<AdminUserSummary>(userStatsKey(username))
      return (
        stats ?? {
          realUsername: username,
          lastAt: '',
          importCompleteCount: 0,
          passNoEarningsCount: 0,
          passFetchErrorCount: 0,
        }
      )
    }),
  )

  users.sort(
    (a, b) => b.lastAt.localeCompare(a.lastAt) || a.realUsername.localeCompare(b.realUsername),
  )

  return { users, storageConfigured: true }
}
