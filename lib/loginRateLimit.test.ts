import { afterEach, describe, expect, it } from 'vitest'
import {
  checkLoginRateLimit,
  clearLoginRateLimitHeaders,
  getRateLimitCookieName,
  LOGIN_RATE_LIMIT,
  recordFailedLoginAttempt,
} from './loginRateLimit'

describe('loginRateLimit', () => {
  afterEach(() => {
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.AUTH_SESSION_SECRET
  })

  it('allows login when no rate-limit cookie is present', async () => {
    process.env.AUTH_SESSION_SECRET = 'session-secret'
    const request = new Request('https://example.com/api/auth/login', { method: 'POST' })

    await expect(checkLoginRateLimit(request)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
  })

  it('blocks after max failed attempts in the current window', async () => {
    process.env.AUTH_SESSION_SECRET = 'session-secret'
    let cookieHeader = ''

    for (let attempt = 0; attempt < LOGIN_RATE_LIMIT.maxAttempts; attempt += 1) {
      const request = new Request('https://example.com/api/auth/login', {
        method: 'POST',
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      })
      const result = await recordFailedLoginAttempt(request)
      cookieHeader = result.headers['Set-Cookie'] ?? cookieHeader
    }

    const blockedRequest = new Request('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    await expect(checkLoginRateLimit(blockedRequest)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    })
  })

  it('clears the rate-limit cookie on successful login flow', () => {
    expect(clearLoginRateLimitHeaders()['Set-Cookie']).toContain(`${getRateLimitCookieName()}=`)
  })
})
