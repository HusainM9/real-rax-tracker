// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccountSessionToken, getAccountCookieName } from '../../lib/accountAuth'
import handler from './accounts'

const ENV_KEYS = ['NODE_ENV', 'AUTH_SESSION_SECRET', 'BASIC_AUTH_PASSWORD'] as const

vi.mock('../../lib/trackerProfileStore', () => ({
  profileSyncConfigured: vi.fn(() => true),
  listTrackerProfilesForAdmin: vi.fn(async () => ({
    profiles: [
      { username: 'gordon', updatedAt: '2026-09-14T00:00:00.000Z', cardCount: 12, performanceCount: 40 },
      { username: 'alice', updatedAt: '2026-09-13T00:00:00.000Z', cardCount: 3, performanceCount: 8 },
    ],
    storageConfigured: true,
  })),
}))

vi.mock('../../lib/accountCredentialsStore', () => ({
  accountSessionIsRevoked: vi.fn(async () => false),
}))

const savedEnv = new Map<string, string | undefined>()

async function gordonRequest(username: string, method = 'GET'): Promise<Request> {
  process.env.AUTH_SESSION_SECRET = 'session-secret'
  const token = await createAccountSessionToken(username)
  return new Request('https://example.com/api/gordon/accounts', {
    method,
    headers: {
      cookie: `${getAccountCookieName()}=${encodeURIComponent(token ?? '')}`,
    },
  })
}

describe('GET /api/gordon/accounts', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])
    process.env.NODE_ENV = 'development'
    process.env.AUTH_SESSION_SECRET = 'session-secret'
    delete process.env.BASIC_AUTH_PASSWORD
  })

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    savedEnv.clear()
    vi.clearAllMocks()
  })

  it('allows localhost local-browser data with no account cookie', async () => {
    const response = await handler(new Request('https://example.com/api/gordon/accounts'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      storageConfigured: true,
    })
  })

  it('still requires an account session outside development', async () => {
    process.env.NODE_ENV = 'production'
    const response = await handler(new Request('https://example.com/api/gordon/accounts'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Account login required' })
  })

  it('rejects non-gordon accounts without using admin auth', async () => {
    const response = await handler(await gordonRequest('alice'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Not available for this account.',
    })
  })

  it('lists tracker accounts for gordon', async () => {
    const response = await handler(await gordonRequest('@Gordon'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      storageConfigured: true,
      profiles: [
        { username: 'gordon', cardCount: 12, performanceCount: 40 },
        { username: 'alice', cardCount: 3, performanceCount: 8 },
      ],
    })
  })

  it('rejects non-GET methods', async () => {
    const response = await handler(await gordonRequest('gordon', 'POST'))
    expect(response.status).toBe(405)
  })
})
