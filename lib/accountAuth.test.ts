import { afterEach, describe, expect, it } from 'vitest'
import {
  buildAccountSessionCookieHeader,
  createAccountSessionToken,
  getAccountCookieName,
  verifyAccountSessionToken,
} from './accountAuth'
import { SESSION_MAX_AGE_SECONDS } from './authCookie'

describe('accountAuth', () => {
  afterEach(() => {
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.AUTH_SESSION_SECRET
  })

  it('creates and verifies a signed account session with username', async () => {
    process.env.AUTH_SESSION_SECRET = 'session-secret'

    const token = await createAccountSessionToken('@TestUser')
    expect(token).toBeTruthy()
    await expect(verifyAccountSessionToken(token)).resolves.toEqual({
      ok: true,
      username: 'testuser',
    })
    await expect(verifyAccountSessionToken(`${token}tampered`)).resolves.toEqual({ ok: false })
  })

  it('builds an httpOnly account cookie with 30-day max age', () => {
    const header = buildAccountSessionCookieHeader('token-value')
    expect(header).toContain(`${getAccountCookieName()}=token-value`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`)
  })
})
