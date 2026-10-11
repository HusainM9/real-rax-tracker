import { afterEach, describe, expect, it } from 'vitest'
import {
  buildEarningsCookieHeader,
  createEarningsSessionToken,
  earningsPasswordMatches,
  getEarningsCookieName,
  verifyEarningsSessionToken,
} from './earningsAuth'

describe('earningsAuth', () => {
  afterEach(() => {
    delete process.env.AUTH_SESSION_SECRET
    delete process.env.EARNINGS_ACCESS_PASSWORD
  })

  it('uses mate as the default earnings-only password', () => {
    expect(earningsPasswordMatches('mate')).toBe(true)
    expect(earningsPasswordMatches('wrong')).toBe(false)
  })

  it('creates a separate signed earnings session', async () => {
    process.env.AUTH_SESSION_SECRET = 'session-secret'
    const token = await createEarningsSessionToken()
    expect(token).toBeTruthy()
    await expect(verifyEarningsSessionToken(token)).resolves.toBe(true)
    await expect(verifyEarningsSessionToken(`${token}tampered`)).resolves.toBe(false)
  })

  it('builds a dedicated httpOnly cookie', () => {
    const header = buildEarningsCookieHeader('token')
    expect(header).toContain(`${getEarningsCookieName()}=token`)
    expect(header).toContain('HttpOnly')
  })
})
