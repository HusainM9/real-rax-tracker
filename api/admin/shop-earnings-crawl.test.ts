// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './shop-earnings-crawl'

const ENV_KEYS = [
  'NODE_ENV',
  'ADMIN_PASSWORD',
  'BASIC_AUTH_PASSWORD',
  'AUTH_SESSION_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REAL_IMPORT_ENABLED',
  'REAL_AUTH_INFO',
  'REAL_SESSION_TOKEN',
  'REAL_DEVICE_UUID',
  'REAL_BASE_URL',
] as const

const originalFetch = globalThis.fetch
const savedEnv = new Map<string, string | undefined>()

function crawlRequest(body: Record<string, unknown>): Request {
  return new Request('https://example.com/api/admin/shop-earnings-crawl', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/shop-earnings-crawl', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key])
    }
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.AUTH_SESSION_SECRET
    delete process.env.ADMIN_PASSWORD
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
    process.env.REAL_IMPORT_ENABLED = 'true'
    process.env.REAL_AUTH_INFO = 'user!token!device'
    process.env.REAL_SESSION_TOKEN = '0123456789abcdef'
    process.env.REAL_DEVICE_UUID = '00000000-0000-4000-8000-000000000000'
    process.env.REAL_BASE_URL = 'https://web.realapp.test'
  })

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    savedEnv.clear()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('requires an admin session outside development', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ADMIN_PASSWORD = 'admin-secret'

    const response = await handler(crawlRequest({ seasons: [2025], sports: ['nba'], maxPages: 1 }))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Admin session required',
    })
  })

  it('rejects requests with no seasons', async () => {
    process.env.NODE_ENV = 'development'
    const response = await handler(crawlRequest({ sports: ['nba'], maxPages: 1 }))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; log?: Array<{ message: string }> }
    expect(body.error).toBe('Enter at least one season year.')
    expect(body.log?.[0]?.message).toContain('season')
  })

  it('accepts UFC-only crawls without player/team entity toggles', async () => {
    process.env.NODE_ENV = 'development'
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('supabase')) {
        return new Response(null, { status: 201 })
      }
      if (url.includes('/userpassshop/ufc/')) {
        expect(url).toContain('/season/2023/entity/team/section/earningstotal')
        return Response.json({ items: [] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const response = await handler(
      crawlRequest({
        seasons: [2023],
        sports: ['ufc'],
        includeUfc: true,
        entityTypes: [],
        maxPages: 1,
        delayMs: 0,
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      done: boolean
      jobsTotal: number
      log?: Array<{ type: string; message: string }>
    }
    expect(body).toMatchObject({ ok: true, done: true, jobsTotal: 1 })
    expect(body.log?.some((event) => event.type === 'chunk_start')).toBe(true)
  })

  it('crawls shop totals then per-item earnings and returns a resumable cursor', async () => {
    process.env.NODE_ENV = 'development'
    const calledUrls: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calledUrls.push(url)
      if (url.includes('supabase')) {
        return new Response(null, { status: 201 })
      }
      if (url.includes('/userpassshop/')) {
        expect(url).toContain('/userpassshop/nba/season/2025/entity/player/section/earningstotal')
        expect(url).toContain('before=0')
        return Response.json({
          items: [
            { id: 10, value: '50', label: 'A', entityType: 'player', sport: 'nba' },
            { id: 11, value: '40', label: 'B', entityType: 'player', sport: 'nba' },
          ],
        })
      }
      if (url.includes('/userpassearnings/nba/season/2025/entity/player/10')) {
        return Response.json({
          earnings: [{ day: '2025-01-10', earnings: 12 }],
          info: { total: 12 },
        })
      }
      if (url.includes('/userpassearnings/nba/season/2025/entity/player/11')) {
        return Response.json({
          earnings: [{ day: '2025-01-11', earnings: 8 }],
          info: { total: 8 },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const response = await handler(
      crawlRequest({
        seasons: [2025],
        sports: ['nba'],
        entityTypes: ['player'],
        maxPages: 1,
        delayMs: 0,
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      upserted: number
      pagesFetched: number
      earningsFetched: number
      earningsFailed: number
      dailyRowsUpserted: number
      done: boolean
      nextBefore: number
      earningsConcurrency: number
      log?: Array<{ type: string; message: string }>
    }
    expect(body).toMatchObject({
      ok: true,
      upserted: 2,
      pagesFetched: 1,
      earningsFetched: 2,
      earningsFailed: 0,
      dailyRowsUpserted: 2,
      done: true,
      nextBefore: 0,
      earningsConcurrency: 2,
    })
    expect(Array.isArray(body.log)).toBe(true)
    expect(body.log?.some((event) => event.type === 'page_fetched')).toBe(true)
    expect(body.log?.some((event) => event.type === 'chunk_complete')).toBe(true)
    expect(calledUrls.some((url) => url.includes('/userpassshop/'))).toBe(true)
    expect(calledUrls.some((url) => url.includes('/userpassearnings/'))).toBe(true)
  })
})
