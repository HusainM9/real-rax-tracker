import { webcrypto } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
vi.unmock('../../../lib/noRetryKv')
vi.unmock('@vercel/kv')

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('crypto', webcrypto)
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('KV_REST_API_URL', 'https://storage.offline.invalid')
  vi.stubEnv('KV_REST_API_TOKEN', 'fixture-token')
  vi.stubEnv('AUTH_SESSION_SECRET', 'fixture-session-secret')
})

it('handles a failed account-store dependency as a visible 503, not an unhandled login 500', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const fetcher = vi.fn().mockRejectedValue(new TypeError('private storage connection detail'))
  vi.stubGlobal('fetch', fetcher)
  const { default: handler } = await import('../../../api/account/login')
  const response = await handler(new Request('https://tracker.offline.invalid/api/account/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fixture', password: 'fixture-password' }) }))
  expect(response.status).toBe(503)
  const body = await response.json()
  expect(body.error).toMatch(/storage|temporarily|unavailable/i)
  expect(JSON.stringify(body)).not.toMatch(/fixture-token|private storage|fixture-password|request_blocked/)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
