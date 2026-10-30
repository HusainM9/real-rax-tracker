import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'
import { safeImportFetch } from './safeImportFetch'
import { failureStatus, isTerminalRequestFailure, isPendingRequest } from '../../lib/httpFailurePolicy'
import {
  REAL_EARNINGS_BATCH_CONCURRENCY,
  REAL_EARNINGS_PASSES_MAX_REQUEST,
  REAL_EARNINGS_CACHE_MAX_REQUEST,
  type EarningsBackfillDailyRow,
  type EarningsBackfillFailure,
  type EarningsBackfillPass,
  type EarningsBackfillPassResult,
  type EarningsBackfillStats,
} from '../../lib/realEarningsShared'

export const REAL_EARNINGS_ENDPOINT = '/api/import/real-earnings'

/** Client-side retries when the batch route itself returns 429 (per-pass retries happen server-side). */
const BATCH_RATE_LIMIT_MAX_RETRIES = 4
const BATCH_RATE_LIMIT_BASE_MS = 1000
const BATCH_RATE_LIMIT_MAX_MS = 20_000

export type { EarningsBackfillDailyRow, EarningsBackfillPass }

export type DailyRaxBackfillProgress = {
  /** Passes resolved so far (cache hits included). */
  completed: number
  total: number
}

export type DailyRaxBackfillResult = {
  rowsByExternalKey: Map<string, EarningsBackfillDailyRow[]>
  sourceByExternalKey: Map<string, 'cache' | 'real'>
  failures: EarningsBackfillFailure[]
  stats: {
    requested: number
    cacheHits: number
    fetched: number
    upstreamRequests: number
    rowsReturned: number
    /** False when Supabase is not configured, so nothing was cached for the next import. */
    cacheConfigured: boolean
  }
}

type RealEarningsResponse = {
  ok?: boolean
  error?: string
  code?: string
  stats?: EarningsBackfillStats
  failures?: EarningsBackfillFailure[]
  passes?: EarningsBackfillPassResult[]
  passesEncoding?: 'gzip-base64'
  passesPayload?: string
}

export type DailyRaxBackfillOptions = {
  signal?: AbortSignal
  onProgress?: (progress: DailyRaxBackfillProgress) => void
  batchSize?: number
  concurrency?: number
  forceRefresh?: boolean
  /** Probe fresh shared history in larger read-only batches before refreshing misses. */
  cacheFirst?: boolean
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function batchRetryDelayMs(attempt: number): number {
  const exp = Math.min(BATCH_RATE_LIMIT_MAX_MS, BATCH_RATE_LIMIT_BASE_MS * 2 ** attempt)
  return Math.min(BATCH_RATE_LIMIT_MAX_MS, Math.floor(Math.random() * (exp + 1)))
}

/** Batch-level failures that mean every later batch would fail too. */
class DailyRaxBackfillFatalError extends Error {}

class DailyRaxBatchRateLimitedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DailyRaxBatchRateLimitedError'
  }
}

type BatchOutcome = {
  batch: EarningsBackfillPass[]
  result?: Awaited<ReturnType<typeof fetchEarningsBatchOnce>>
  error?: Error
  deferred?: boolean
}

async function fetchEarningsBatchOnce(
  passes: EarningsBackfillPass[],
  signal?: AbortSignal,
  forceRefresh = false,
  cacheOnly = false,
): Promise<{
  passes: EarningsBackfillPassResult[]
  failures: EarningsBackfillFailure[]
  stats?: EarningsBackfillStats
}> {
  const response = await safeImportFetch(REAL_EARNINGS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passes, forceRefresh, ...(cacheOnly ? { cacheOnly: true } : {}) }),
    signal,
  })

  const text = await response.text()
  let body: RealEarningsResponse | null = null
  if (text.trim()) {
    try {
      body = JSON.parse(text) as RealEarningsResponse
    } catch {
      const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 160)
      throw new Error(
        response.ok
          ? `Daily RAX backfill returned invalid JSON: ${snippet}`
          : `Daily RAX backfill failed (${response.status}): ${snippet}`,
      )
    }
  }

  if (!response.ok) {
    const message = body?.error || `Daily RAX backfill failed (${response.status}).`
    if ([401, 403, 503].includes(response.status) || body?.code === 'real_session_expired') {
      throw new DailyRaxBackfillFatalError(message)
    }
    if (response.status === 429 || body?.code === 'real_rate_limited') {
      throw new DailyRaxBatchRateLimitedError(message)
    }
    throw new Error(message)
  }

  let results: EarningsBackfillPassResult[] = Array.isArray(body?.passes) ? body.passes : []
  if (results.length === 0 && body?.passesEncoding === 'gzip-base64' && body.passesPayload) {
    const decoded = (await gunzipBase64ToJson(body.passesPayload)) as
      | EarningsBackfillPassResult[]
      | null
    results = Array.isArray(decoded) ? decoded : []
  }

  return {
    passes: results,
    failures: Array.isArray(body?.failures) ? body.failures : [],
    stats: body?.stats,
  }
}

async function fetchEarningsBatch(
  passes: EarningsBackfillPass[],
  signal?: AbortSignal,
  forceRefresh = false,
): Promise<{
  passes: EarningsBackfillPassResult[]
  failures: EarningsBackfillFailure[]
  stats?: EarningsBackfillStats
}> {
  let lastError: Error | null = null
  const maxAttempts = BATCH_RATE_LIMIT_MAX_RETRIES + 1

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(batchRetryDelayMs(attempt - 1), signal)
    }
    try {
      return await fetchEarningsBatchOnce(passes, signal, forceRefresh)
    } catch (error) {
      if (error instanceof DailyRaxBackfillFatalError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (error instanceof DailyRaxBatchRateLimitedError) {
        lastError = error
        continue
      }
      throw error
    }
  }

  throw lastError ?? new DailyRaxBatchRateLimitedError('Daily RAX backfill rate limited.')
}

/**
 * Fetches per-day base RAX for the given passes through the batched route. The work is chunked
 * client-side rather than run as one long request because a cold cache for a large account needs
 * hundreds of upstream calls, which no single serverless invocation can finish — and batching gives
 * the progress reporting a long silent import lacks.
 *
 * A batch that fails outright degrades to per-pass failures so the rest of the import survives;
 * only a missing configuration or an expired bot session stops the whole run. Partial successes
 * inside a batch (server returns 200 with `failures`) are kept — only the listed passes need retry.
 */
export async function fetchDailyRaxRows(
  passes: EarningsBackfillPass[],
  options: DailyRaxBackfillOptions = {},
): Promise<DailyRaxBackfillResult> {
  const rowsByExternalKey = new Map<string, EarningsBackfillDailyRow[]>()
  const sourceByExternalKey = new Map<string, 'cache' | 'real'>()
  const failures: EarningsBackfillFailure[] = []
  const stats = {
    requested: passes.length,
    cacheHits: 0,
    fetched: 0,
    upstreamRequests: 0,
    rowsReturned: 0,
    cacheConfigured: true,
  }

  if (passes.length === 0) {
    return { rowsByExternalKey, sourceByExternalKey, failures, stats }
  }

  let completed = 0
  let remaining = passes
  if (options.cacheFirst && !options.forceRefresh && passes.length > REAL_EARNINGS_PASSES_MAX_REQUEST) {
    const cacheBatches = chunkArray(passes, REAL_EARNINGS_CACHE_MAX_REQUEST)
    let nextCacheBatch = 0
    let cacheStopped = false
    const cacheWorker = async () => {
      while (!cacheStopped && nextCacheBatch < cacheBatches.length) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const batch = cacheBatches[nextCacheBatch++]!
        try {
          const cached = await fetchEarningsBatchOnce(batch, options.signal, false, true)
          for (const pass of cached.passes) {
            if (pass.source !== 'cache' || rowsByExternalKey.has(pass.externalKey)) continue
            rowsByExternalKey.set(pass.externalKey, pass.rows)
            sourceByExternalKey.set(pass.externalKey, 'cache')
            stats.rowsReturned += pass.rows.length
            stats.cacheHits += 1
            completed += 1
          }
          if (cached.stats?.cacheConfigured === false) stats.cacheConfigured = false
          options.onProgress?.({ completed, total: passes.length })
        } catch (error) {
          if (
            isTerminalRequestFailure(error) || error instanceof DailyRaxBackfillFatalError ||
            (error instanceof DOMException && error.name === 'AbortError')
          ) {
            cacheStopped = true
            throw error
          }
          // Older deployments or an unavailable cache fall back to the normal bounded route.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, cacheBatches.length) }, () => cacheWorker()))
    remaining = passes.filter((pass) => !rowsByExternalKey.has(pass.externalKey))
  }

  const batches = chunkArray(
    remaining,
    Math.min(options.batchSize ?? REAL_EARNINGS_PASSES_MAX_REQUEST, REAL_EARNINGS_PASSES_MAX_REQUEST),
  )
  const workerCount = Math.min(
    batches.length,
    Math.max(1, Math.floor(options.concurrency ?? REAL_EARNINGS_BATCH_CONCURRENCY)),
  )
  let nextBatch = 0
  let stopped = false
  let terminalError: unknown = null
  const outcomes: BatchOutcome[] = new Array(batches.length)

  const worker = async () => {
    while (!stopped && nextBatch < batches.length) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const index = nextBatch++
      const batch = batches[index]!
      try {
        outcomes[index] = {
          batch,
          result: await fetchEarningsBatch(batch, options.signal, options.forceRefresh === true),
        }
        const terminal = outcomes[index]?.result?.failures.find(isTerminalRequestFailure)
        if (terminal) { stopped = true; terminalError = terminal }
      } catch (error) {
        if (isTerminalRequestFailure(error)) {
          stopped = true
          terminalError = error
        }
        if (
          error instanceof DailyRaxBackfillFatalError ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          stopped = true
          throw error
        }
        outcomes[index] = { batch, error: error instanceof Error ? error : new Error('Batch failed.') }
      }
      completed += batch.length
      options.onProgress?.({ completed: Math.min(completed, passes.length), total: passes.length })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  // Explicitly report unscheduled work; never interpret it as successful empty earnings.
  if (terminalError) for (let index = 0; index < batches.length; index += 1) {
    if (!outcomes[index]) outcomes[index] = { batch: batches[index]!, deferred: true }
  }

  // Aggregate in input order even if the requests completed out of order.
  for (const entry of outcomes) {
    if (entry.deferred) {
      for (const pass of entry.batch) failures.push({
        externalKey: pass.externalKey, name: pass.name, kind: 'deferred', retryable: true,
        message: 'Not requested: this import stopped earlier. This pass can be attempted later.',
      })
      continue
    }
    if (entry.error) {
      for (const pass of entry.batch) {
        failures.push({
          externalKey: pass.externalKey,
          name: pass.name,
          message: entry.error.message,
          kind: entry.error.name === 'DailyRaxBatchRateLimitedError' ? 'rate_limited' : 'batch',
          ...(isTerminalRequestFailure(entry.error) ? { upstreamStatus: failureStatus(entry.error), retryable: false, pending: isPendingRequest(entry.error) } : {}),
        })
      }
      continue
    }

    const result = entry.result
    if (!result) continue
    for (const passResult of result.passes) {
      rowsByExternalKey.set(passResult.externalKey, passResult.rows)
      sourceByExternalKey.set(passResult.externalKey, passResult.source)
      stats.rowsReturned += passResult.rows.length
    }
    failures.push(...result.failures)
    if (result.stats) {
      stats.cacheHits += result.stats.cacheHits
      stats.fetched += result.stats.fetched
      stats.upstreamRequests += result.stats.upstreamRequests
      if (!result.stats.cacheConfigured) stats.cacheConfigured = false
    }
  }

  return { rowsByExternalKey, sourceByExternalKey, failures, stats }
}
