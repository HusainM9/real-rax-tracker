import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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

  it('does not retry auth failures', async () => {
    globalThis.fetch = vi.fn(async () => new Response('auth', { status: 401 })) as unknown as typeof fetch

    await expect(
      realGetJson('/user/test', { config: testConfig({ maxRetries: 5 }) }),
    ).rejects.toMatchObject({ kind: 'auth', status: 401 })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
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
