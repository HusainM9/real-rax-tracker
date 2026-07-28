// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'
import { REAL_EARNINGS_PASSES_MAX_REQUEST } from '../../lib/realEarningsShared'
import handler from './real-earnings'

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

function earningsRequest(passes: unknown): Request {
  return new Request('https://example.com/api/import/real-earnings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passes }),
  })
}

const samplePass = {
  externalKey: '551|2025|FC',
  entityId: 551,
  passKind: 'player',
  sportRaw: 'fc',
  seasonYear: 2025,
  seasonLabel: '2025-26',
  name: 'Anthony Gordon',
  rarityLabel: 'Legendary 1',
}

describe('POST /api/import/real-earnings', () => {
  beforeEach(() => {
    for (const key of [...REAL_ENV_KEYS, 'BASIC_AUTH_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      savedEnv.set(key, process.env[key])
    }
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
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

  it('rejects oversized batches (chunk contract)', async () => {
    const passes = Array.from({ length: REAL_EARNINGS_PASSES_MAX_REQUEST + 1 }, (_, index) => ({
      ...samplePass,
      externalKey: `${index}|2025|FC`,
      entityId: index + 1,
    }))
    const response = await handler(earningsRequest(passes))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(`max ${REAL_EARNINGS_PASSES_MAX_REQUEST}`),
    })
  })

  it('returns 503 when the bot credentials are not configured', async () => {
    delete process.env.REAL_AUTH_INFO
    const response = await handler(earningsRequest([samplePass]))
    expect(response.status).toBe(503)
  })

  it('fetches Real earnings and returns a gzip pass payload', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/userpassearnings/soccer/season/2025/entity/player/551')
      expect(url).not.toContain('level=')
      return Response.json({
        earnings: [
          { day: '2025-01-10', earnings: 12, playerBoxScoreIds: [42] },
          { day: '2025-01-17', earnings: 8, playerBoxScoreIds: [43] },
        ],
        info: { total: 20, seasonLabel: '2025-26' },
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const response = await handler(earningsRequest([samplePass]))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      stats: { upstreamRequests: number; fetched: number; cacheHits: number }
      passesEncoding: string
      passesPayload: string
      failures: unknown[]
    }
    expect(body.ok).toBe(true)
    expect(body.passesEncoding).toBe('gzip-base64')
    expect(body.stats).toMatchObject({
      upstreamRequests: 1,
      fetched: 1,
      cacheHits: 0,
    })
    expect(body.failures).toEqual([])

    const passes = (await gunzipBase64ToJson(body.passesPayload)) as Array<{
      externalKey: string
      source: string
      rows: Array<{ claimDay: string; baseRaxEarned: number }>
    }>
    expect(passes).toHaveLength(1)
    expect(passes[0]).toMatchObject({
      externalKey: samplePass.externalKey,
      source: 'real',
      rows: [
        { claimDay: '2025-01-10', baseRaxEarned: 12 },
        { claimDay: '2025-01-17', baseRaxEarned: 8 },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
