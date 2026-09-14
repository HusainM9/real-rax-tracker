// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'
import type { RealPassPayload } from '../../lib/realPassScan'
import handler from './real-passes'

const REAL_ENV_KEYS = [
  'REAL_IMPORT_ENABLED',
  'REAL_AUTH_INFO',
  'REAL_SESSION_TOKEN',
  'REAL_DEVICE_UUID',
  'REAL_BASE_URL',
] as const

const originalFetch = globalThis.fetch
const savedEnv = new Map<string, string | undefined>()

function configureRealEnv(): void {
  process.env.REAL_IMPORT_ENABLED = 'true'
  process.env.REAL_AUTH_INFO = 'test-user!test-token!test-device'
  process.env.REAL_SESSION_TOKEN = '0123456789abcdef'
  process.env.REAL_DEVICE_UUID = '00000000-0000-4000-8000-000000000000'
  process.env.REAL_BASE_URL = 'https://web.realapp.test'
}

function passesRequest(username: unknown = 'gordon'): Request {
  return new Request('https://example.com/api/import/real-passes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  })
}

const samplePass = {
  entityType: 'player',
  entityId: 551,
  sport: 'soccer',
  label: 'Anthony Gordon',
  seasonDisplay: '2025-26',
  season: 2025,
  id: 14112194,
  serialNumber: 1,
  isRefunded: false,
  earned: 20905,
  boostInfo: { rarityLabel: 'Iconic 1', multiplier: '150x' },
}

const sampleTeamPass = {
  ...samplePass,
  entityType: 'team',
  entityId: 900,
  sport: 'nba',
  season: 2026,
  label: 'LAL Lakers',
  id: 14112195,
  boostInfo: { rarityLabel: 'LEGENDARY 2' },
}

type FetchLogEntry = { url: string; headers: Record<string, string> }

function mockRealFetch(
  responses: { user?: Response; passes?: Response } = {},
): { log: FetchLogEntry[] } {
  const log: FetchLogEntry[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    log.push({ url, headers })

    if (url.includes('/user/')) {
      return (
        responses.user?.clone() ??
        Response.json({ user: { id: 'jvbKVyL3', userName: 'gordon' } }, { status: 200 })
      )
    }
    if (url.includes('/passes')) {
      return (
        responses.passes?.clone() ??
        Response.json({ passes: [samplePass, sampleTeamPass] }, { status: 200 })
      )
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  return { log }
}

describe('POST /api/import/real-passes', () => {
  beforeEach(() => {
    for (const key of [...REAL_ENV_KEYS, 'BASIC_AUTH_PASSWORD']) {
      savedEnv.set(key, process.env[key])
    }
    // Keep the app-session gate open: unconfigured auth allows the request through.
    delete process.env.BASIC_AUTH_PASSWORD
    configureRealEnv()
  })

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    savedEnv.clear()
    globalThis.fetch = originalFetch
  })

  it('rejects non-POST requests', async () => {
    const response = await handler(
      new Request('https://example.com/api/import/real-passes', { method: 'GET' }),
    )
    expect(response.status).toBe(405)
  })

  it('returns 503 when the bot credentials are not configured', async () => {
    delete process.env.REAL_AUTH_INFO
    const response = await handler(passesRequest())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('not configured'),
    })
  })

  it('returns 400 without a username', async () => {
    const response = await handler(passesRequest('  '))
    expect(response.status).toBe(400)
  })

  it('returns the normalized gzip payload for a username', async () => {
    const { log } = mockRealFetch()
    const response = await handler(passesRequest('@gordon'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      username: string
      userId: string
      strategy: string
      requests: number
      rawPassCount: number
      passesEncoding: string
      passesPayload: string
    }
    expect(body).toMatchObject({
      username: 'gordon',
      userId: 'jvbKVyL3',
      strategy: 'single',
      requests: 1,
      rawPassCount: 2,
      passesEncoding: 'gzip-base64',
    })

    const payload = (await gunzipBase64ToJson(body.passesPayload)) as RealPassPayload
    expect(payload.playerPasses).toEqual([
      {
        entityId: 551,
        season: 2025,
        sportRaw: 'fc',
        pair: '551:2025:fc',
        passKind: 'player',
        rarityLabel: 'Iconic 1',
        playerName: 'Anthony Gordon',
        seasonLabel: '2025-26',
        earned: 20905,
        rarityMultiplierLabel: '150x',
      },
    ])
    expect(payload.teamPasses[0]?.passKind).toBe('team')
    expect(payload.rarities).toEqual({
      '551-2025-fc': ['Iconic 1'],
      '900-2026-nba': ['Legendary 2'],
    })

    expect(log[0]?.url).toBe('https://web.realapp.test/user/gordon')
    // One unfiltered collection request: no entityType/season/sport query params.
    expect(log[1]?.url).toBe('https://web.realapp.test/userpasses/jvbKVyL3/passes')
    expect(log[1]?.headers['real-auth-info']).toBe('test-user!test-token!test-device')
    expect(log[1]?.headers['real-device-type']).toBe('desktop_web')
    expect(log[1]?.headers['real-request-token']).toMatch(/^[A-Za-z0-9]{16,}$/)
  })

  it('reports an expired bot session distinctly from other failures', async () => {
    mockRealFetch({
      user: Response.json({ error: 'Authentication required.' }, { status: 401 }),
    })
    const response = await handler(passesRequest())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      code: 'real_session_expired',
      error: expect.stringContaining('needs refreshing'),
    })
  })

  it('returns 404 when the collection has no usable passes', async () => {
    mockRealFetch({ passes: Response.json({ passes: [] }, { status: 200 }) })
    const response = await handler(passesRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'real_no_passes' })
  })

  it('surfaces upstream failures as 502', async () => {
    mockRealFetch({ passes: new Response('boom', { status: 500 }) })
    const response = await handler(passesRequest())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ code: 'real_upstream' })
  })
})
