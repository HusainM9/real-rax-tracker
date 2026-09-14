import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'
import {
  REAL_EARNINGS_BATCH_CONCURRENCY,
  REAL_EARNINGS_PASSES_MAX_REQUEST,
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
}

async function fetchEarningsBatchOnce(
  passes: EarningsBackfillPass[],
  signal?: AbortSignal,
  forceRefresh = false,
): Promise<{
  passes: EarningsBackfillPassResult[]
  failures: EarningsBackfillFailure[]
  stats?: EarningsBackfillStats
}> {
  const response = await fetch(REAL_EARNINGS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passes, forceRefresh }),
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
    if (response.status === 503 || body?.code === 'real_session_expired') {
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

  const batches = chunkArray(
    passes,
    Math.min(options.batchSize ?? REAL_EARNINGS_PASSES_MAX_REQUEST, REAL_EARNINGS_PASSES_MAX_REQUEST),
  )
  const waveSize = Math.max(1, options.concurrency ?? REAL_EARNINGS_BATCH_CONCURRENCY)
  let completed = 0

  for (let waveStart = 0; waveStart < batches.length; waveStart += waveSize) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const wave = batches.slice(waveStart, waveStart + waveSize)
    const settled = await Promise.all(
      wave.map(async (batch): Promise<BatchOutcome> => {
        try {
          return {
            batch,
            result: await fetchEarningsBatch(batch, options.signal, options.forceRefresh === true),
          }
        } catch (error) {
          if (error instanceof DailyRaxBackfillFatalError) throw error
          if (error instanceof DOMException && error.name === 'AbortError') throw error
          return { batch, error: error instanceof Error ? error : new Error('Batch failed.') }
        }
      }),
    )

    for (const entry of settled) {
      completed += entry.batch.length
      if (entry.error) {
        for (const pass of entry.batch) {
          failures.push({
            externalKey: pass.externalKey,
            name: pass.name,
            message: entry.error.message,
            kind: entry.error.name === 'DailyRaxBatchRateLimitedError' ? 'rate_limited' : 'batch',
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

    options.onProgress?.({ completed: Math.min(completed, passes.length), total: passes.length })
  }

  return { rowsByExternalKey, sourceByExternalKey, failures, stats }
}
