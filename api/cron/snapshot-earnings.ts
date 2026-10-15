import { methodNotAllowed } from '../../lib/httpResponses'

import {
  currentRealEarningsDay,
  reconstructPublicDailyEarnings,
} from '../../lib/publicDailyEarnings.js'
import {
  listTrackedEarningsUsernames,
  readPublicEarningsSnapshot,
  savePublicEarningsSnapshot,
} from '../../lib/publicEarningsStore.js'
import {
  RealApiError,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi.js'
import {
  nodeApiHandler,
  type NodeRequest,
  type NodeResponse,
} from '../../lib/nodeApiHandler.js'

// Vercel gives this route 300 seconds. Leave a full minute for response flush and
// platform overhead while allowing one invocation to cover the complete account list.
const SNAPSHOT_SOFT_BUDGET_MS = 240_000
const SNAPSHOT_RETRY_RESERVE_MS = 15_000
const SNAPSHOT_RETRY_MIN_DELAY_MS = 2_500
const SNAPSHOT_RETRY_JITTER_MS = 2_500

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

export function isEasternSnapshotTime(now: Date): boolean {
  const parts = easternParts(now)
  const hour = Number(parts.hour)
  // Hobby cron delivery can be delayed. Keep every idempotent snapshot attempt
  // eligible throughout the complete pre-reset recovery window.
  return hour >= 4 && hour <= 6
}

export function isEasternFinalCheckTime(now: Date): boolean {
  return Number(easternParts(now).hour) === 6
}

export function isScheduledSnapshotRouteTime(_pathname: string, now: Date): boolean {
  // Hobby cron delivery can be delayed well past the minute in vercel.json. Every
  // snapshot route is idempotent, so accept any configured attempt throughout the
  // recovery window instead of rejecting a valid delayed EDT/EST invocation.
  return isEasternSnapshotTime(now)
}

export function isAuthorizedSnapshotRequest(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const secret = process.env.CRON_SECRET?.trim()
  if (secret) return request.headers.get('authorization') === `Bearer ${secret}`
  return request.headers.get('user-agent') === 'vercel-cron/1.0'
}

export function isSnapshotRateLimit(error: unknown): boolean {
  if (error instanceof RealApiError) {
    return error.kind === 'rate_limited' || error.status === 429
  }
  if (!error || typeof error !== 'object') return false
  const candidate = error as { kind?: unknown; status?: unknown }
  return candidate.kind === 'rate_limited' || candidate.status === 429
}

export function snapshotRetryDelayMs(random: () => number = Math.random): number {
  const sample = Math.min(1, Math.max(0, random()))
  return SNAPSHOT_RETRY_MIN_DELAY_MS + Math.floor(sample * SNAPSHOT_RETRY_JITTER_MS)
}

export function hasSnapshotTimeBudget(
  startedAt: number,
  now: number,
  delayMs = 0,
  budgetMs = SNAPSHOT_SOFT_BUDGET_MS,
): boolean {
  return now - startedAt + delayMs + SNAPSHOT_RETRY_RESERVE_MS < budgetMs
}

export function orderSnapshotUsernames(
  usernames: string[],
  prioritizeTail = false,
): string[] {
  return prioritizeTail ? [...usernames].reverse() : [...usernames]
}

export function missingSnapshotUsernames(
  usernames: string[],
  completedUsernames: string[],
  skippedUsernames: string[],
): string[] {
  const fetched = new Set(
    [...completedUsernames, ...skippedUsernames].map((username) => username.toLowerCase()),
  )
  return usernames.filter((username) => !fetched.has(username.toLowerCase()))
}

function waitForSnapshotRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function handleSnapshot(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return methodNotAllowed()
  }
  if (!isAuthorizedSnapshotRequest(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const force = process.env.NODE_ENV === 'development' && url.searchParams.get('force') === '1'
  const now = new Date()
  if (!force && !isScheduledSnapshotRouteTime(url.pathname, now)) {
    return Response.json({ ok: true, skipped: true, reason: 'Outside this route\'s 4:00-6:59 AM Eastern snapshot window.' })
  }

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    return Response.json({ error: 'The Real API transport session is not configured.' }, { status: 503 })
  }
  // Alternating fallbacks start from the opposite end of the account list.
  // Successful account/day snapshots are skipped below, so this prevents an
  // account near the end (such as @twinchenzo) from repeatedly being deferred
  // when the earlier run hits Real's rate limit or our soft time budget.
  const prioritizeTail = url.pathname.includes('snapshot-earnings-after-six')
    || url.pathname.includes('snapshot-earnings-final-check')
  const usernames = orderSnapshotUsernames(
    await listTrackedEarningsUsernames(),
    prioritizeTail,
  )
  const day = url.searchParams.get('day') ?? currentRealEarningsDay(now)
  const startedAt = Date.now()
  const snapshotSignal = force
    ? request.signal
    : AbortSignal.any([request.signal, AbortSignal.timeout(SNAPSHOT_SOFT_BUDGET_MS)])
  const completed: Array<{ username: string; total: number }> = []
  const skipped: string[] = []
  const retried: string[] = []
  const rateLimited: Array<{ username: string; error: string }> = []
  const deferred: string[] = []
  const errors: Array<{ username: string; error: string }> = []

  for (let accountIndex = 0; accountIndex < usernames.length; accountIndex += 1) {
    const username = usernames[accountIndex]
    if (!force && !hasSnapshotTimeBudget(startedAt, Date.now())) {
      deferred.push(...usernames.slice(accountIndex))
      break
    }

    if (!force) {
      try {
        if (await readPublicEarningsSnapshot(username, day)) {
          skipped.push(username)
          continue
        }
      } catch (error) {
        errors.push({
          username,
          error: error instanceof Error ? error.message : 'Could not check the saved snapshot.',
        })
        continue
      }
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const context: RealApiContext = {
          config: realConfig,
          signal: snapshotSignal,
          publicCacheNamespace: `snapshot:${day}:${now.toISOString()}:${username}:attempt:${attempt + 1}`,
          forceFreshBoxScores: true,
        }
        const result = await reconstructPublicDailyEarnings(username, day, context)
        await savePublicEarningsSnapshot(result)
        completed.push({ username: result.username, total: result.dailyTotal })
        break
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown snapshot error.'
        if (!force && snapshotSignal.aborted && !request.signal.aborted) {
          deferred.push(...usernames.slice(accountIndex))
          accountIndex = usernames.length
          break
        }
        if (!isSnapshotRateLimit(error)) {
          errors.push({ username, error: message })
          break
        }

        const retryDelayMs = snapshotRetryDelayMs()
        const canRetry = attempt === 0 && (
          force || hasSnapshotTimeBudget(startedAt, Date.now(), retryDelayMs)
        )
        if (canRetry) {
          retried.push(username)
          try {
            await waitForSnapshotRetry(retryDelayMs, snapshotSignal)
          } catch (retryError) {
            if (!force && snapshotSignal.aborted && !request.signal.aborted) {
              deferred.push(...usernames.slice(accountIndex))
              accountIndex = usernames.length
            } else {
              errors.push({
                username,
                error: retryError instanceof Error ? retryError.message : 'Snapshot retry was interrupted.',
              })
            }
            break
          }
          continue
        }

        rateLimited.push({ username, error: message })
        // A final 429 is usually shared across the session. Stop sending more requests and
        // let the later cron invocation retry every account that still has no saved snapshot.
        deferred.push(...usernames.slice(accountIndex + 1))
        accountIndex = usernames.length
        break
      }
    }
  }

  // A soft-budget exit can occur before the loop re-checks snapshots saved by an
  // earlier invocation. Verify every unresolved username against KV so the coverage
  // report never labels an already-saved account as missing.
  const verifiedSaved = new Set([
    ...completed.map(({ username }) => username.toLowerCase()),
    ...skipped.map((username) => username.toLowerCase()),
  ])
  for (const username of usernames) {
    if (verifiedSaved.has(username.toLowerCase())) continue
    try {
      if (await readPublicEarningsSnapshot(username, day)) {
        verifiedSaved.add(username.toLowerCase())
      }
    } catch (error) {
      errors.push({
        username,
        error: error instanceof Error ? error.message : 'Could not verify the saved snapshot.',
      })
    }
  }
  const missingAccounts = usernames.filter(
    (username) => !verifiedSaved.has(username.toLowerCase()),
  )
  const finalCheck = !force && isEasternFinalCheckTime(now)
  const hasIncompleteAccounts = missingAccounts.length > 0
  console.info('earnings-snapshot completed', {
    route: url.pathname,
    day,
    totalAccounts: usernames.length,
    completedAccounts: completed.length,
    previouslySavedAccounts: verifiedSaved.size - completed.length,
    missingAccounts: missingAccounts.length,
    rateLimitedAccounts: rateLimited.length,
    deferredAccounts: deferred.length,
    errors: errors.length,
    elapsedMs: Date.now() - startedAt,
  })
  return Response.json({
    ok: !hasIncompleteAccounts,
    day,
    completed,
    skipped,
    retried,
    rateLimited,
    deferred,
    fallback: hasIncompleteAccounts
      ? finalCheck
        ? 'The final 6:00 AM check found accounts without a saved earnings snapshot.'
        : 'Missing account snapshots will be retried by the next scheduled invocation.'
      : null,
    verification: finalCheck
      ? {
          allAccountsFetched: missingAccounts.length === 0,
          fetchedAccounts: usernames.length - missingAccounts.length,
          totalAccounts: usernames.length,
          missingAccounts,
        }
      : null,
    errors,
  }, { status: hasIncompleteAccounts ? 207 : 200 })
}

const handleNodeRequest = nodeApiHandler(handleSnapshot)

export default async function handler(
  request: Request | NodeRequest,
  response?: NodeResponse,
): Promise<Response | void> {
  if (!response) return handleSnapshot(request as Request)
  await handleNodeRequest(request as NodeRequest, response)
}
