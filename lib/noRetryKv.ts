import { createClient, type VercelKV } from '@vercel/kv'

let client: VercelKV | undefined

/** Ordinary internal storage, not a Real provider circuit breaker.
 * Explicit zero avoids the installed SDK's retry:false two-attempt behavior. */
export function getNoRetryKv(): VercelKV {
  if (!client) {
    const url = process.env.KV_REST_API_URL?.trim()
    const token = process.env.KV_REST_API_TOKEN?.trim()
    if (!url || !token) throw new Error('Account storage is not configured.')
    client = createClient({
      url, token, retry: { retries: 0 }, enableAutoPipelining: false,
      responseEncoding: false, enableTelemetry: false,
      signal: () => AbortSignal.timeout(15000),
    })
  }
  return client
}

export const kv = new Proxy({} as VercelKV, {
  get: (_target, property) => Reflect.get(getNoRetryKv(), property),
})
