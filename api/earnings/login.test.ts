import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import handler from './login'

describe('earnings login API', () => {
  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET = 'earnings-test-secret'
    delete process.env.EARNINGS_ACCESS_PASSWORD
  })

  afterEach(() => {
    delete process.env.AUTH_SESSION_SECRET
    delete process.env.EARNINGS_ACCESS_PASSWORD
  })

  it('unlocks Earnings with the default mate password', async () => {
    const response = await handler(new Request('http://localhost/api/earnings/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'mate' }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('rax_earnings_access=')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('rejects an incorrect Earnings password', async () => {
    const response = await handler(new Request('http://localhost/api/earnings/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Incorrect earnings password.' })
  })
})
