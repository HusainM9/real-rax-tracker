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

const SNAPSHOT_SOFT_BUDGET_MS = 48_000
const SNAPSHOT_RETRY_RESERVE_MS = 8_000
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
  const minute = Number(parts.minute)
  // Prefer 5:30 AM Eastern. The 6 AM hour is a fallback for imprecise Hobby cron starts,
  // and existing account/day snapshots prevent it from replacing a successful 5:30 run.
  return (hour === 5 && minute >= 30) || hour === 6
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
    return new Response('Method Not Allowed', { status: 405 })
  }
  if (!isAuthorizedSnapshotRequest(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const force = process.env.NODE_ENV === 'development' && url.searchParams.get('force') === '1'
  const now = new Date()
  if (!force && !isEasternSnapshotTime(now)) {
    return Response.json({ ok: true, skipped: true, reason: 'Outside the 5:30-6:59 AM Eastern snapshot window.' })
  }

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    return Response.json({ error: 'The Real API transport session is not configured.' }, { status: 503 })
  }
  // The first 6 AM fallback starts from the opposite end of the account list.
  // Successful account/day snapshots are skipped below, so this prevents an
  // account near the end (such as @twinchenzo) from repeatedly being deferred
  // when the earlier run hits Real's rate limit or our soft time budget.
  const prioritizeTail = url.pathname.includes('snapshot-earnings-after-six')
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

  const hasIncompleteAccounts = errors.length > 0 || rateLimited.length > 0 || deferred.length > 0
  return Response.json({
    ok: !hasIncompleteAccounts,
    day,
    completed,
    skipped,
    retried,
    rateLimited,
    deferred,
    fallback: hasIncompleteAccounts
      ? 'Missing account snapshots will be retried by the next scheduled invocation.'
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
