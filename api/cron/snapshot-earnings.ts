import {
  currentRealEarningsDay,
  reconstructPublicDailyEarnings,
} from '../../lib/publicDailyEarnings'
import {
  listTrackedEarningsUsernames,
  savePublicEarningsSnapshot,
} from '../../lib/publicEarningsStore'
import { resolveRealApiConfig, type RealApiContext } from '../../lib/realApi'

export const config = { runtime: 'edge', maxDuration: 60 }

function easternParts(now: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
}

export function previousEasternDay(now = new Date()): string {
  const parts = easternParts(now)
  const date = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1),
  )
  return date.toISOString().slice(0, 10)
}

function isEasternSnapshotTime(now: Date): boolean {
  const parts = easternParts(now)
  // Vercel may start a cron a few minutes late. The whole 6 AM hour is still before Real's
  // roughly 7 AM reset; the UTC schedule prevents more than one matching run.
  return parts.hour === '06'
}

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const secret = process.env.CRON_SECRET?.trim()
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`)
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  if (!isAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const force = process.env.NODE_ENV === 'development' && url.searchParams.get('force') === '1'
  const now = new Date()
  if (!force && !isEasternSnapshotTime(now)) {
    return Response.json({ ok: true, skipped: true, reason: 'Outside the 6 AM Eastern snapshot window.' })
  }

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    return Response.json({ error: 'The Real API transport session is not configured.' }, { status: 503 })
  }
  const usernames = await listTrackedEarningsUsernames()
  const day = url.searchParams.get('day') ?? currentRealEarningsDay(now)
  const completed: Array<{ username: string; total: number }> = []
  const errors: Array<{ username: string; error: string }> = []

  for (const username of usernames) {
    try {
      const context: RealApiContext = { config: realConfig, signal: request.signal }
      const result = await reconstructPublicDailyEarnings(username, day, context)
      await savePublicEarningsSnapshot(result)
      completed.push({ username: result.username, total: result.dailyTotal })
    } catch (error) {
      errors.push({
        username,
        error: error instanceof Error ? error.message : 'Unknown snapshot error.',
      })
    }
  }

  return Response.json({ ok: errors.length === 0, day, completed, errors }, { status: errors.length ? 207 : 200 })
}
