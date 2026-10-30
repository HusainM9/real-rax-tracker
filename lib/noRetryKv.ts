import { createClient, type VercelKV } from '@vercel/kv'
import type { UpstashRequest, UpstashResponse } from '@upstash/redis'
import { isHttp5xx, RequestSafetyError } from './httpFailurePolicy.js'

let client: VercelKV | undefined
let fault: RequestSafetyError | undefined
let syncToken = ''
const uncertain = new Map<string, RequestSafetyError>()
const tails = new Map<string, Promise<void>>()

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

/** The SDK normally discards HTTP status and retry:false still attempts twice.
 * Its public middleware bypasses that HTTP implementation, not command codecs. */
async function request<T>(req: UpstashRequest, baseUrl: string, token: string): Promise<UpstashResponse<T>> {
  if (fault) throw fault
  if (req.onMessage || req.isStreaming) throw new Error('Streaming KV commands are not supported by the safety boundary.')
  const serializedBody = JSON.stringify(req.body)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([baseUrl, req.path ?? [], serializedBody])))
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return serialized(key, async () => {
    if (fault) throw fault
    const blocked = uncertain.get(key)
    if (blocked) throw blocked
    if (req.signal?.aborted) throw req.signal.reason ?? new DOMException('Aborted', 'AbortError')
    const headers = new Headers(req.headers)
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('Content-Type', 'application/json')
    headers.delete('Upstash-Encoding')
    if (syncToken) headers.set('upstash-sync-token', syncToken)
    let response: Response
    try {
      response = await fetch([baseUrl, ...(req.path ?? [])].join('/'), { method: 'POST', headers, body: serializedBody, redirect: 'error', cache: 'no-store', signal: req.signal })
    } catch {
      const incidentId = crypto.randomUUID()
      const error = new RequestSafetyError(`Storage response was not received. This command is paused in this instance; it was not retried. Reference: ${incidentId}.`, 'safety_storage_unavailable')
      uncertain.set(key, error)
      console.error('request-safety incident', { source: 'server', provider: 'kv', outcome: 'transport_unknown', endpointKey: key, incidentId, recordedAt: new Date().toISOString(), action: 'paused_until_review' })
      throw error
    }
    if (isHttp5xx(response.status)) {
      const incidentId = crypto.randomUUID()
      fault = new RequestSafetyError(`Storage returned HTTP ${response.status}. Storage HTTP is paused in this instance; no retry. Reference: ${incidentId}.`, 'safety_storage_unavailable', response.status)
      console.error('request-safety incident', { source: 'server', provider: 'kv', status: response.status, endpointKey: key, incidentId, recordedAt: new Date().toISOString(), action: 'paused_until_review' })
      throw fault
    }
    if (!response.ok) throw new RequestSafetyError(`Storage returned HTTP ${response.status}. This operation stopped without retrying.`, 'storage_http_error', response.status)
    syncToken = response.headers.get('upstash-sync-token') ?? syncToken
    let payload: unknown
    try { payload = await response.json() } catch {
      const error = new RequestSafetyError('Storage reply could not be decoded. This command is paused in this instance; no retry.', 'storage_invalid_response', response.status)
      uncertain.set(key, error)
      console.error('request-safety incident', { source: 'server', provider: 'kv', outcome: 'invalid_response', status: response.status, endpointKey: key, recordedAt: new Date().toISOString(), action: 'paused_until_review' })
      throw error
    }
    // Redis command errors are not HTTP outages. Let SDK command/pipeline handling
    // reject them without latching unrelated commands or exposing command details.
    const redact = (entry: unknown) => entry && typeof entry === 'object' && 'error' in entry && entry.error
      ? { error: 'Storage command was rejected.' } : entry
    return (Array.isArray(payload) ? payload.map(redact) : redact(payload)) as UpstashResponse<T>
  })
}

/** Only confirmed HTTP 5xx freezes storage globally in this warm instance. */
export function getNoRetryKv(): VercelKV {
  if (fault) throw fault
  if (!client) {
    const url = process.env.KV_REST_API_URL?.trim()
    const token = process.env.KV_REST_API_TOKEN?.trim()
    if (!url || !token) throw new Error('Durable request-safety storage is not configured.')
    const baseUrl = url.replace(/\/+$/, '')
    const raw = createClient({ url: baseUrl, token, retry: { retries: 0 }, enableAutoPipelining: false, responseEncoding: false, cache: 'no-store', enableTelemetry: false })
    raw.use(req => request(req, baseUrl, token))
    client = raw
  }
  return client
}

export const kv = new Proxy({} as VercelKV, {
  get: (_target, property) => Reflect.get(getNoRetryKv(), property),
})
