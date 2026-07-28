import { afterEach, describe, expect, it } from 'vitest'
import {
  SESSION_MAX_AGE_SECONDS,
  buildSessionCookieHeader,
  createSessionToken,
  getSessionCookieName,
  verifySessionToken,
} from './authCookie'

describe('authCookie', () => {
  afterEach(() => {
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.AUTH_SESSION_SECRET
  })

  it('creates and verifies a signed session token', async () => {
    process.env.BASIC_AUTH_PASSWORD = 'test-password'
    process.env.AUTH_SESSION_SECRET = 'session-secret'

    const token = await createSessionToken()
    expect(token).toBeTruthy()
    await expect(verifySessionToken(token)).resolves.toBe(true)
    await expect(verifySessionToken(`${token}tampered`)).resolves.toBe(false)
  })

  it('builds an httpOnly session cookie with 30-day max age', () => {
    process.env.BASIC_AUTH_PASSWORD = 'test-password'
    const header = buildSessionCookieHeader('token-value')
    expect(header).toContain(`${getSessionCookieName()}=token-value`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`)
  })
})
