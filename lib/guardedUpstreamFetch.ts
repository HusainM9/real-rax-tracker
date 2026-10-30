import { RequestSafetyError } from './httpFailurePolicy.js'
import { requestSafetyStore, type RequestSafetyStore } from './requestSafetyStore.js'

const tails = new Map<string, Promise<void>>()
const failedToPersist = new Map<string, RequestSafetyError>()
const keyHashes = new Map<string, Promise<string>>()

async function familyKey(url: string, method: string): Promise<string> {
  const parsed = new URL(url)
  const scope = `real:${method.toUpperCase()}:${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`
  let key = keyHashes.get(scope)
  if (!key) {
    key = crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope)).then(hash => `request-safety:v1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`)
    if (keyHashes.size >= 512) keyHashes.delete(keyHashes.keys().next().value!)
    keyHashes.set(scope, key)
  }
  return key
}

async function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const tail = previous.then(() => current)
  tails.set(key, tail)
  await previous
  try { return await work() } finally {
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}

function paused(incidentId?: string): RequestSafetyError {
  const reference = incidentId && /^[a-f0-9-]{36}$/i.test(incidentId) ? ` Reference: ${incidentId}.` : ''
  return new RequestSafetyError(`Real returned HTTP 500. This endpoint is paused and will not be repeated.${reference}`, 'real_http_500', 500, false, 'real')
}

function refuseRedirect(response: Response): Response {
  if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') {
    throw new Error('Upstream redirect was not followed. This operation stopped without retrying.')
  }
  return response
}

/** Only confirmed Real HTTP 500 is durable. Other services have no circuit latch. */
export async function guardedUpstreamFetch(provider: string, url: string, init: RequestInit = {}, store: RequestSafetyStore = requestSafetyStore): Promise<Response> {
  // Vercel Edge rejects redirect:"error" before dispatch. Manual mode prevents a
  // follow-up request (or credential forwarding); inspect and reject 3xx ourselves.
  if (provider !== 'real') return refuseRedirect(await fetch(url, { ...init, redirect: 'manual' }))
  if (/\/home\/ufc\/day\/?$/i.test(new URL(url).pathname)) throw paused()
  const method = (init.method ?? 'GET').toUpperCase()
  const key = await familyKey(url, method)
  return serialized(key, async () => {
    const local = failedToPersist.get(key)
    if (local) throw local
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Aborted', 'AbortError')
    let existing
    try { existing = await store.getFailure(key) } catch {
      throw new Error('Unable to check recorded Real HTTP 500 failures. This operation was not started; try again later.')
    }
    if (existing) throw paused(existing.incidentId)
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Aborted', 'AbortError')

    // One dispatch only. Unknown responses and other statuses never become permanent bans.
    let response: Response
    try { response = await fetch(url, { ...init, redirect: 'manual' }) } catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new DOMException('Request cancelled.', 'AbortError')
      throw new Error('The Real response was not received. This operation stopped without retrying.')
    }
    refuseRedirect(response)
    if (response.status !== 500) return response
    const owner = crypto.randomUUID()
    const record = { owner, provider: 'real', method, status: 500, outcome: 'http_500' as const, incidentId: owner, recordedAt: new Date().toISOString() }
    const error = paused(owner)
    failedToPersist.set(key, error)
    console.error('request-safety incident', { source: 'server', ...record, endpointKey: key, action: 'real_endpoint_paused' })
    try {
      await store.recordFailure(key, record)
      failedToPersist.delete(key)
    } catch {
      console.error('request-safety persistence failed', { provider: 'real', status: 500, incidentId: owner, recordedAt: record.recordedAt, action: 'warm_instance_block_preserved' })
    }
    throw error
  })
}
