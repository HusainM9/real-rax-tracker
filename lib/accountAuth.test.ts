import { afterEach, describe, expect, it } from 'vitest'
import {
  buildAccountSessionCookieHeader,
  createAccountSessionToken,
  getAccountCookieName,
  sessionMatchesCredentials,
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
      credentialsUpdatedAt: '',
    })
    await expect(verifyAccountSessionToken(`${token}tampered`)).resolves.toEqual({ ok: false })
  })

  it('embeds credentialsUpdatedAt so password resets can invalidate older sessions', async () => {
    process.env.AUTH_SESSION_SECRET = 'session-secret'
    const credentialsUpdatedAt = '2026-08-19T20:00:00.000Z'

    const token = await createAccountSessionToken('@TestUser', credentialsUpdatedAt)
    await expect(verifyAccountSessionToken(token)).resolves.toEqual({
      ok: true,
      username: 'testuser',
      credentialsUpdatedAt,
    })
  })

  it('builds an httpOnly account cookie with 30-day max age', () => {
    const header = buildAccountSessionCookieHeader('token-value')
    expect(header).toContain(`${getAccountCookieName()}=token-value`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`)
  })
})

describe('sessionMatchesCredentials', () => {
  it('accepts legacy sessions until a password change has been stored', () => {
    expect(sessionMatchesCredentials('', '')).toBe(true)
    expect(sessionMatchesCredentials(undefined, undefined)).toBe(true)
  })

  it('rejects sessions issued before a stored password reset', () => {
    expect(sessionMatchesCredentials('', '2026-08-19T20:00:00.000Z')).toBe(false)
    expect(sessionMatchesCredentials('2026-08-19T19:00:00.000Z', '2026-08-19T20:00:00.000Z')).toBe(
      false,
    )
  })

  it('accepts sessions issued for the current password generation', () => {
    expect(sessionMatchesCredentials('2026-08-19T20:00:00.000Z', '2026-08-19T20:00:00.000Z')).toBe(
      true,
    )
  })
})
