import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRealSportEntity,
  getShopEarningsTotal,
  realApiRetryDelayMs,
  realGetJson,
  resolveRealApiConfig,
  type RealApiConfig,
} from './realApi'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function testConfig(overrides: Partial<RealApiConfig> = {}): RealApiConfig {
  return {
    baseUrl: 'https://web.realapp.com',
    authInfo: 'user!token!device',
    sessionToken: '0123456789abcdef',
    deviceUuid: 'device-uuid',
    deviceName: 'test',
    deviceType: 'desktop_web',
    version: '35',
    timeoutMs: 5_000,
    concurrency: 2,
    maxRetries: 3,
    retryBaseMs: 10,
    retryMaxMs: 50,
    ...overrides,
  }
}

describe('resolveRealApiConfig', () => {
  it('defaults concurrency and retry knobs when unset', () => {
    const config = resolveRealApiConfig({
      REAL_IMPORT_ENABLED: 'true',
      REAL_AUTH_INFO: 'a!b!c',
      REAL_SESSION_TOKEN: 'token',
      REAL_DEVICE_UUID: 'uuid',
    })
    expect(config).toMatchObject({
      concurrency: 2,
      maxRetries: 5,
      retryBaseMs: 750,
      retryMaxMs: 20_000,
    })
  })

  it('reads concurrency and retry overrides from env', () => {
    const config = resolveRealApiConfig({
      REAL_IMPORT_ENABLED: '1',
      REAL_AUTH_INFO: 'a!b!c',
      REAL_SESSION_TOKEN: 'token',
      REAL_DEVICE_UUID: 'uuid',
      REAL_IMPORT_CONCURRENCY: '1',
      REAL_IMPORT_MAX_RETRIES: '2',
      REAL_IMPORT_RETRY_BASE_MS: '100',
      REAL_IMPORT_RETRY_MAX_MS: '500',
    })
    expect(config).toMatchObject({
      concurrency: 1,
      maxRetries: 2,
      retryBaseMs: 100,
      retryMaxMs: 500,
    })
  })
})

describe('realApiRetryDelayMs', () => {
  it('stays within the exponential cap and uses full jitter', () => {
    expect(realApiRetryDelayMs(0, 100, 10_000, () => 0)).toBe(0)
    expect(realApiRetryDelayMs(0, 100, 10_000, () => 0.999)).toBe(100)
    expect(realApiRetryDelayMs(3, 100, 250, () => 1)).toBe(250)
  })
})

describe('realGetJson rate-limit retries', () => {
  it('retries on 429 and eventually succeeds', async () => {
    vi.useFakeTimers()
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls += 1
      if (calls < 3) {
        return new Response('rate limited', { status: 429 })
      }
      return Response.json({ ok: true })
    }) as unknown as typeof fetch

    const pending = realGetJson<{ ok: boolean }>('/user/test', {
      config: testConfig({ maxRetries: 4, retryBaseMs: 5, retryMaxMs: 20 }),
    })
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({ ok: true })
    expect(calls).toBe(3)
  })

  it('gives up after maxRetries and surfaces rate_limited', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 429 })) as unknown as typeof fetch

    const pending = realGetJson('/user/test', {
      config: testConfig({ maxRetries: 2, retryBaseMs: 5, retryMaxMs: 20 }),
    }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    )
    await vi.runAllTimersAsync()
    const settled = await pending
    expect(settled.ok).toBe(false)
    if (settled.ok) throw new Error('expected failure')
    expect(settled.error).toMatchObject({ kind: 'rate_limited', status: 429 })
    // initial + 2 retries
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })

  it('retries marketplace high-volume responses reported as HTTP 400', async () => {
    vi.useFakeTimers()
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return Response.json(
          { statusCode: 400, error: 'Bad Request', message: 'We are experiencing high volume.' },
          { status: 400 },
        )
      }
      return Response.json({ listings: [] })
    }) as unknown as typeof fetch

    const pending = realGetJson<{ listings: unknown[] }>('/cardmarketplacelistings', {
      config: testConfig({ maxRetries: 2, retryBaseMs: 5, retryMaxMs: 20 }),
    })
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual({ listings: [] })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not retry auth failures', async () => {
    globalThis.fetch = vi.fn(async () => new Response('auth', { status: 401 })) as unknown as typeof fetch

    await expect(
      realGetJson('/user/test', { config: testConfig({ maxRetries: 5 }) }),
    ).rejects.toMatchObject({ kind: 'auth', status: 401 })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('reuses public game responses across linked-account scans', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ content: { games: [{ id: 7 }] } })) as unknown as typeof fetch
    const context = { config: testConfig(), publicCacheNamespace: `scan-${Date.now()}` }
    const path = `/home/nba/day/next-cache-test-${Date.now()}`

    const first = await realGetJson(path, context, { day: '2026-10-12' })
    const second = await realGetJson(path, context, { day: '2026-10-12' })

    expect(second).toEqual(first)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not reuse public game responses without an explicit scan namespace', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ content: { games: [{ id: 8 }] } })) as unknown as typeof fetch
    const context = { config: testConfig() }
    const path = `/home/nba/day/next-live-test-${Date.now()}`

    await realGetJson(path, context, { day: '2026-10-12' })
    await realGetJson(path, context, { day: '2026-10-12' })

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('aborts hung fetches and returns timeout (does not wait forever)', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      })
    }) as unknown as typeof fetch

    const pending = realGetJson('/user/test', {
      config: testConfig({ timeoutMs: 100, maxRetries: 0 }),
    }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    )
    await vi.advanceTimersByTimeAsync(150)
    const settled = await pending
    expect(settled.ok).toBe(false)
    if (settled.ok) throw new Error('expected timeout')
    expect(settled.error).toMatchObject({ kind: 'timeout' })
    expect(String(settled.error.message)).toMatch(/timed out after 100ms/i)
  })
})

describe('getShopEarningsTotal', () => {
  it('requests the earningstotal shop section with before offset', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toBe(
        'https://web.realapp.com/userpassshop/ncaam/season/2026/entity/player/section/earningstotal?before=40',
      )
      return Response.json({
        items: [{ id: 1, value: '12', label: 'A', entityType: 'player', sport: 'ncaam' }],
      })
    }) as unknown as typeof fetch

    const page = await getShopEarningsTotal(
      { sport: 'ncaam', season: 2026, entityType: 'player', before: 40 },
      { config: testConfig() },
    )
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ id: 1, value: '12' })
  })
})

describe('getRealSportEntity', () => {
  it('reads nested player.avatar from /players/{id}/sport/{sport}', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://web.realapp.com/players/4600663/sport/ncaam')
      return Response.json({
        player: {
          id: 4600663,
          sport: 'ncaam',
          avatar: '248a479ac84b6273e2267b52c9f7198e',
          firstName: 'Zach',
          lastName: 'Edey',
        },
      })
    }) as unknown as typeof fetch

    const entity = await getRealSportEntity(
      { entityId: 4600663, sport: 'ncaam', entityType: 'player' },
      { config: testConfig() },
    )
    expect(entity).toMatchObject({
      id: 4600663,
      avatar: '248a479ac84b6273e2267b52c9f7198e',
    })
  })

  it('reads nested team.avatar from /teams/{id}/sport/{sport}', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://web.realapp.com/teams/150/sport/ncaam')
      return Response.json({
        team: {
          id: 150,
          sport: 'ncaam',
          avatar: '323de7b14ad3c35925dc0c3af730d27a',
          name: 'Duke',
        },
      })
    }) as unknown as typeof fetch

    const entity = await getRealSportEntity(
      { entityId: 150, sport: 'ncaam', entityType: 'team' },
      { config: testConfig() },
    )
    expect(entity).toMatchObject({
      id: 150,
      avatar: '323de7b14ad3c35925dc0c3af730d27a',
    })
  })
})
