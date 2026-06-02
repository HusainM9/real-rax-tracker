import { afterEach, describe, expect, it } from 'vitest'
import {
  createAdminSessionToken,
  verifyAdminSessionToken,
} from './adminAuth'

describe('adminAuth', () => {
  const originalAdminPassword = process.env.ADMIN_PASSWORD
  const originalAuthSecret = process.env.AUTH_SESSION_SECRET

  afterEach(() => {
    process.env.ADMIN_PASSWORD = originalAdminPassword
    process.env.AUTH_SESSION_SECRET = originalAuthSecret
  })

  it('creates and verifies an admin session token', async () => {
    process.env.ADMIN_PASSWORD = 'admin-test-password'
    delete process.env.AUTH_SESSION_SECRET

    const token = await createAdminSessionToken()
    expect(token).toBeTruthy()
    await expect(verifyAdminSessionToken(token)).resolves.toBe(true)
    await expect(verifyAdminSessionToken('invalid.token')).resolves.toBe(false)
  })
})
