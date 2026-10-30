import { failureStatus, isHttp5xx, isTerminalRequestFailure, isPendingRequest, RequestSafetyError } from '../../lib/httpFailurePolicy'

const PREFIX = 'rax:request-safety:'

function storageKeys(input: string, method: string): { key: string; legacy: string } {
  const url = new URL(input, window.location.origin)
  const path = `${url.origin}${url.pathname.toLowerCase().replace(/\/+$/, '')}`
  return { key: `${PREFIX}v2:${method.toUpperCase()}:${path}`, legacy: `${PREFIX}v1:${path}` }
}

function remember(key: string, status: number): void {
  const record = { upstreamStatus: status, recordedAt: new Date().toISOString(), action: 'paused_until_review' }
  try { localStorage.setItem(key, JSON.stringify(record)) } catch {
    // Preserve the in-memory block if browser persistence is unavailable.
  }
  blocked.set(key, status)
  console.error('request-safety incident', { source: 'browser', status, recordedAt: record.recordedAt, action: record.action })
}

const blocked = new Map<string, number>()

function savedBlock(key: string, legacy = false): { blocked: boolean; status?: number } {
  const saved = localStorage.getItem(key)
  if (!saved) return { blocked: false }
  try {
    const record: unknown = JSON.parse(saved)
    if (!record || typeof record !== 'object' || Array.isArray(record)) return { blocked: true }
    const status = (record as { upstreamStatus?: unknown }).upstreamStatus
    if (status !== undefined && typeof status !== 'number') return { blocked: true }
    if (isHttp5xx(status)) return { blocked: true, status }
    // Old unknown markers are evidence, not proof of HTTP 5xx. Leave them stored;
    // the durable server guard still controls access to the affected provider.
    return { blocked: !legacy }
  } catch { return { blocked: true } }
}

/** Test seam, never used by product UI; there is deliberately no user reset/force override. */
export function resetImportSafetyForTests(): void {
  blocked.clear()
  if (typeof localStorage === 'undefined') return
  for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
}

/** No automatic retries; persist confirmed 5xx, not normal page cancellations. */
export async function safeImportFetch(input: string, init?: RequestInit): Promise<Response> {
  const { key, legacy } = storageKeys(input, init?.method ?? 'GET')
  let currentBlock: { blocked: boolean; status?: number }
  let legacyBlock: { blocked: boolean; status?: number }
  try { currentBlock = savedBlock(key); legacyBlock = savedBlock(legacy, true) } catch {
    throw new RequestSafetyError('Cannot verify saved request-safety state. Import was not started.', 'safety_storage_unavailable')
  }
  if (currentBlock.blocked || legacyBlock.blocked || blocked.has(key)) {
    throw new RequestSafetyError('This request is blocked by a confirmed HTTP 5xx or an unreadable safety record. Operator review is required; no request was sent.', 'request_blocked', currentBlock.status ?? legacyBlock.status ?? blocked.get(key))
  }
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  let response: Response
  try { response = await fetch(input, init) } catch (error) {
    if (init?.signal?.aborted || (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) {
      throw new DOMException('Request cancelled.', 'AbortError')
    }
    console.error('request-safety incident', { source: 'browser', outcome: 'transport_unknown', recordedAt: new Date().toISOString(), action: 'stopped_current_request' })
    throw new RequestSafetyError('The response was not received. This operation stopped without retrying; provider safety checks remain in force.', 'request_outcome_unknown', undefined, true)
  }
  if (isHttp5xx(response.status)) {
    remember(key, response.status)
    const detail = await response.clone().json().catch(() => null) as null | { error?: string }
    throw new RequestSafetyError(`${detail?.error || `Request returned HTTP ${response.status}.`} Stopped; do not retry.`, 'upstream_5xx', response.status)
  }
  const body = await response.clone().json().catch(() => null) as null | { retryable?: boolean; upstreamStatus?: number; error?: string; failures?: unknown[]; errors?: unknown[] }
  const embedded = [...(Array.isArray(body?.failures) ? body.failures : []), ...(Array.isArray(body?.errors) ? body.errors : [])]
  const terminal = isTerminalRequestFailure(body) ? body : embedded.find(isTerminalRequestFailure)
  if (terminal) {
    const status = failureStatus(terminal)
    const pending = isPendingRequest(terminal)
    if (isHttp5xx(status)) remember(key, status)
    if (!response.ok || body === terminal) throw new RequestSafetyError(body?.error ?? 'Upstream request stopped for safety.', pending ? 'request_pending' : 'request_blocked', status, pending)
    // Let the caller retain successful passes from a partial result, but latch later requests.
  }
  return response
}

/** Shared by all browser API requests, not just collection imports. */
export const safeFetch = safeImportFetch
