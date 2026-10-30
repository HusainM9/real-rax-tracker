import { isHttp5xx, RequestSafetyError } from './httpFailurePolicy.js'
import { requestSafetyStore, type RequestSafetyStore } from './requestSafetyStore.js'

const tails = new Map<string, Promise<void>>()
const keyHashes = new Map<string, Promise<string>>()
const failedFamilies = new Map<string, RequestSafetyError>()
const activeFamilies = new Map<string, number>()
const persistedFailures = new Set<string>()

async function catalogOperation(url: string): Promise<string> {
  const query = new URL(url).searchParams
  query.sort()
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(query.toString()))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Only fixed diagnostic categories leave the transport; exception text can contain secrets. */
function transportReason(error: unknown, signal?: AbortSignal | null): string {
  if (signal?.aborted) return 'aborted'
  const detail = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null
  if (detail?.name === 'AbortError') return 'aborted'
  if (detail?.name === 'TimeoutError') return 'timeout'
  const code = detail?.cause?.code ?? detail?.code
  switch (code) {
    case 'ECONNRESET': return 'connection_reset'
    case 'ECONNREFUSED': return 'connection_refused'
    case 'ENOTFOUND': case 'EAI_AGAIN': return 'dns_failure'
    case 'ETIMEDOUT': case 'UND_ERR_CONNECT_TIMEOUT': case 'UND_ERR_HEADERS_TIMEOUT': return 'timeout'
    case 'CERT_HAS_EXPIRED': case 'DEPTH_ZERO_SELF_SIGNED_CERT': case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE': return 'tls_failure'
    default: return 'transport_failure'
  }
}

function reference(incidentId?: string): string {
  return incidentId && /^[a-f0-9-]{36}$/i.test(incidentId) ? ` Reference: ${incidentId}.` : ''
}

async function familyKey(provider: string, url: string, method: string): Promise<string> {
  const parsed = new URL(url)
  // Ignore query/filter/date/session variants; never store credentials or private URLs.
  const scope = `${provider}:${method.toUpperCase()}:${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`
  let pending = keyHashes.get(scope)
  if (!pending) {
    pending = crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope)).then((hash) =>
      `request-safety:v1:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`)
    if (keyHashes.size >= 512) keyHashes.delete(keyHashes.keys().next().value!)
    keyHashes.set(scope, pending)
  }
  return pending
}

/** Catalog reads serialize identical queries; other providers keep family serialization. */
async function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  tails.set(key, tail)
  await previous
  try { return await work() } finally {
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}

async function trackedFamily<T>(key: string, work: () => Promise<T>): Promise<T> {
  activeFamilies.set(key, (activeFamilies.get(key) ?? 0) + 1)
  try { return await work() } finally {
    const remaining = activeFamilies.get(key)! - 1
    if (remaining) activeFamilies.set(key, remaining)
    else {
      activeFamilies.delete(key)
      // Drain already-started admissions before relying on durable state alone.
      // Failed persistence keeps the warm-instance block without an expiry.
      if (persistedFailures.delete(key)) failedFamilies.delete(key)
    }
  }
}

/** Durable preflight. Never retry 5xx or an unknown outcome, including in later invocations. */
export async function guardedUpstreamFetch(
  provider: string,
  url: string,
  init: RequestInit = {},
  store: RequestSafetyStore = requestSafetyStore,
): Promise<Response> {
  if (provider === 'real' && /\/home\/ufc\/day\/?$/i.test(new URL(url).pathname)) {
    throw new RequestSafetyError('UFC home-day requests are blocked after a recorded HTTP 500. No request was sent.', 'known_upstream_failure', 500)
  }
  const method = (init.method ?? 'GET').toUpperCase()
  const key = await familyKey(provider, url, method)
  const operation = provider === 'supabase-catalog' && method === 'GET' ? await catalogOperation(url) : undefined
  return trackedFamily(key, () => serialized(operation ? `${key}:${operation}` : key, async () => {
    const familyFailure = failedFamilies.get(key)
    if (familyFailure) throw familyFailure
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Aborted', 'AbortError')
    const owner = crypto.randomUUID()
    let existing
    try { existing = await store.reserve(key, owner, operation) } catch {
      throw new RequestSafetyError('Request stopped: durable safety storage is unavailable. No upstream request was sent.', 'safety_storage_unavailable')
    }
    if (existing) {
      const failed = existing.status !== undefined || existing.outcome === 'transport_unknown'
      throw new RequestSafetyError(
        `${failed ? 'This endpoint is paused after a failed or uncertain request. Operator review is required; no request was sent.' : 'Another request to this endpoint is pending or uncertain. No upstream request was sent.'}${reference(existing.incidentId)}`,
        failed ? 'request_blocked' : 'request_pending', existing.status, !failed,
      )
    }
    const finish = (status?: number, context?: Parameters<RequestSafetyStore['finish']>[3]) => operation
      ? store.finish(key, owner, status, context, operation)
      : store.finish(key, owner, status, context)
    // Another query can return 5xx while this one's durable admission is pending.
    // Release only the unused reservation; never issue that newly-blocked HTTP.
    const admittedFailure = failedFamilies.get(key)
    if (admittedFailure) {
      try { await finish() } catch { /* keep unused reservation fail-closed */ }
      throw admittedFailure
    }
    // Admission storage can take time. Cancellation here is provably before dispatch,
    // so release only this owner's unused reservation, never an already-sent request.
    if (init.signal?.aborted) {
      try { await finish() } catch {
        throw new RequestSafetyError('Cancelled before sending, but safety storage could not confirm release. Operator review is required.', 'safety_storage_unavailable')
      }
      throw init.signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    let response: Response
    try {
      // Redirects cannot silently make an unguarded second upstream request.
      response = await fetch(url, { ...init, redirect: 'error' })
    } catch (error) {
      const context = { provider, method: (init.method ?? 'GET').toUpperCase(), recordedAt: new Date().toISOString(), outcome: 'transport_unknown' as const, reason: transportReason(error, init.signal), incidentId: owner }
      // Log before storage IO; keep the reservation even if incident finalization fails.
      console.error('request-safety incident', { source: 'server', ...context, endpointKey: key, action: 'paused_until_review' })
      try { await finish(undefined, context) } catch { /* pending still blocks reissue */ }
      throw new RequestSafetyError(`Request outcome is uncertain. Import or operation paused for operator review; this endpoint will not be retried.${reference(owner)}`, 'request_outcome_unknown')
    }
    if (isHttp5xx(response.status)) {
      const context = { provider, method: (init.method ?? 'GET').toUpperCase(), recordedAt: new Date().toISOString(), outcome: 'http_5xx' as const, incidentId: owner }
      // Log before any further IO. The existing reservation already prevents reissue,
      // even if storing the confirmed failure details itself fails.
      console.error('request-safety incident', { source: 'server', ...context, endpointKey: key, status: response.status, action: 'paused_until_review' })
      const failure = new RequestSafetyError(`Upstream returned HTTP ${response.status}. Stopped; this endpoint will not be retried.${reference(owner)}`, 'upstream_5xx', response.status)
      if (!failedFamilies.has(key)) failedFamilies.set(key, failure)
      try {
        await finish(response.status, context)
        persistedFailures.add(key)
      } catch { /* pending blocks reissue; warm family latch also remains */ }
      throw failure
    }
    try { await finish() } catch {
      throw new RequestSafetyError('Request completed but safety storage could not confirm release. Further requests are deferred.', 'safety_storage_unavailable')
    }
    return response
  }))
}
