import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSessionCookieHeader,
  createSessionToken,
  getSessionCookieName,
  verifySessionToken,
} from './authCookie'

describe('authCookie', () => {
  afterEach(() => {
    delete process.env.BASIC_AUTH_USER
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.AUTH_SESSION_SECRET
  })

  it('creates and verifies a signed session token', async () => {
    process.env.BASIC_AUTH_USER = 'rax'
    process.env.BASIC_AUTH_PASSWORD = 'test-password'
    process.env.AUTH_SESSION_SECRET = 'session-secret'

    const token = await createSessionToken()
    expect(token).toBeTruthy()
    await expect(verifySessionToken(token)).resolves.toBe(true)
    await expect(verifySessionToken(`${token}tampered`)).resolves.toBe(false)
  })

  it('builds an httpOnly session cookie header', () => {
    process.env.BASIC_AUTH_PASSWORD = 'test-password'
    const header = buildSessionCookieHeader('token-value')
    expect(header).toContain(`${getSessionCookieName()}=token-value`)
    expect(header).toContain('HttpOnly')
  })
})
