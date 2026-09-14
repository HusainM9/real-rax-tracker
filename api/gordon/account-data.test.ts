// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccountSessionToken, getAccountCookieName } from '../../lib/accountAuth'
import handler from './account-data'
import { getAccountProfileForSession } from '../../lib/trackerProfileStore'

const ENV_KEYS = ['NODE_ENV', 'AUTH_SESSION_SECRET', 'BASIC_AUTH_PASSWORD'] as const

vi.mock('../../lib/trackerProfileStore', () => ({
  accountsConfigured: vi.fn(() => true),
  getAccountProfileForSession: vi.fn(),
}))

vi.mock('../../lib/accountCredentialsStore', () => ({
  accountSessionIsRevoked: vi.fn(async () => false),
}))

const savedEnv = new Map<string, string | undefined>()

async function dataRequest(username: string, target = 'alice'): Promise<Request> {
  process.env.AUTH_SESSION_SECRET = 'session-secret'
  const token = await createAccountSessionToken(username)
  return new Request(
    `https://example.com/api/gordon/account-data?username=${encodeURIComponent(target)}`,
    {
      method: 'GET',
      headers: {
        cookie: `${getAccountCookieName()}=${encodeURIComponent(token ?? '')}`,
      },
    },
  )
}

describe('GET /api/gordon/account-data', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])
    process.env.NODE_ENV = 'development'
    process.env.AUTH_SESSION_SECRET = 'session-secret'
    delete process.env.BASIC_AUTH_PASSWORD
    vi.mocked(getAccountProfileForSession).mockReset()
  })

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    savedEnv.clear()
  })

  it('allows localhost local-browser data to load another account', async () => {
    vi.mocked(getAccountProfileForSession).mockResolvedValue({
      transfer: {
        username: 'alice',
        updatedAt: '2026-09-14T00:00:00.000Z',
        cardCount: 2,
        performanceCount: 4,
        data: { cards: [], performances: [] },
      },
      storageConfigured: true,
      notFound: false,
    })

    const response = await handler(
      new Request('https://example.com/api/gordon/account-data?username=alice'),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, username: 'alice' })
  })

  it('requires an account session outside development', async () => {
    process.env.NODE_ENV = 'production'
    const response = await handler(
      new Request('https://example.com/api/gordon/account-data?username=alice'),
    )
    expect(response.status).toBe(401)
  })

  it('rejects non-gordon accounts', async () => {
    const response = await handler(await dataRequest('alice', 'gordon'))
    expect(response.status).toBe(403)
  })

  it('requires a username', async () => {
    process.env.AUTH_SESSION_SECRET = 'session-secret'
    const token = await createAccountSessionToken('gordon')
    const response = await handler(
      new Request('https://example.com/api/gordon/account-data', {
        headers: { cookie: `${getAccountCookieName()}=${encodeURIComponent(token ?? '')}` },
      }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Username is required.' })
  })

  it('returns another account collection for gordon', async () => {
    vi.mocked(getAccountProfileForSession).mockResolvedValue({
      transfer: {
        username: 'alice',
        updatedAt: '2026-09-14T00:00:00.000Z',
        cardCount: 2,
        performanceCount: 4,
        data: { cards: [], performances: [] },
      },
      storageConfigured: true,
      notFound: false,
    })

    const response = await handler(await dataRequest('gordon', '@Alice'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      username: 'alice',
      cardCount: 2,
      performanceCount: 4,
      data: { cards: [], performances: [] },
    })
    expect(getAccountProfileForSession).toHaveBeenCalledWith('alice')
  })

  it('returns 404 when the account does not exist', async () => {
    vi.mocked(getAccountProfileForSession).mockResolvedValue({
      transfer: null,
      storageConfigured: true,
      notFound: true,
    })

    const response = await handler(await dataRequest('gordon', 'missing'))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: 'No account found for @missing.',
    })
  })
})
