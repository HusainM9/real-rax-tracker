import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { RealApiError } from '../../lib/realApi'
import {
  hasSnapshotTimeBudget,
  hasSnapshotBearerAuthorization,
  isAuthorizedSnapshotRequest,
  isEasternFinalCheckTime,
  isEasternSnapshotTime,
  isScheduledSnapshotRouteTime,
  isSnapshotRateLimit,
  missingSnapshotUsernames,
  orderSnapshotUsernames,
  snapshotPublicCacheNamespace,
  snapshotRetryDelayMs,
} from './snapshot-earnings'

const originalNodeEnv = process.env.NODE_ENV
const originalCronSecret = process.env.CRON_SECRET

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
})

describe('scheduled earnings snapshot window', () => {
  it('accepts the 4 AM through 6 AM Eastern recovery window', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T09:00:00Z'))).toBe(true)
    expect(isEasternSnapshotTime(new Date('2026-07-15T09:00:00Z'))).toBe(true)
    expect(isEasternSnapshotTime(new Date('2026-01-15T11:59:00Z'))).toBe(true)
    expect(isEasternSnapshotTime(new Date('2026-07-15T10:59:00Z'))).toBe(true)
  })

  it('rejects runs before 4 AM or after the 6 AM hour', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T08:59:00Z'))).toBe(false)
    expect(isEasternSnapshotTime(new Date('2026-07-15T07:59:00Z'))).toBe(false)
    expect(isEasternSnapshotTime(new Date('2026-01-15T12:00:00Z'))).toBe(false)
    expect(isEasternSnapshotTime(new Date('2026-07-15T11:00:00Z'))).toBe(false)
  })

  it('recognizes the final 6 AM verification hour across DST', () => {
    expect(isEasternFinalCheckTime(new Date('2026-01-15T11:15:00Z'))).toBe(true)
    expect(isEasternFinalCheckTime(new Date('2026-07-15T10:45:00Z'))).toBe(true)
    expect(isEasternFinalCheckTime(new Date('2026-01-15T10:59:00Z'))).toBe(false)
  })

  it('accepts every scheduled route throughout the delayed-cron recovery window', () => {
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-summer',
      new Date('2026-07-15T08:30:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-summer',
      new Date('2026-01-15T08:30:00Z'),
    )).toBe(false)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-after-six-summer',
      new Date('2026-07-15T09:00:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-winter',
      new Date('2026-01-15T09:30:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-winter',
      new Date('2026-07-15T09:30:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-after-six-winter',
      new Date('2026-01-15T10:00:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-after-six-winter',
      new Date('2026-07-15T10:00:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-fallback',
      new Date('2026-01-15T10:30:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-fallback',
      new Date('2026-07-15T10:30:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-final-check',
      new Date('2026-01-15T11:00:00Z'),
    )).toBe(true)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-final-check',
      new Date('2026-07-15T11:00:00Z'),
    )).toBe(false)
    expect(isScheduledSnapshotRouteTime(
      '/api/cron/snapshot-earnings-summer',
      new Date('2026-07-15T09:45:00Z'),
    )).toBe(true)
  })
})

describe('scheduled earnings snapshot authorization', () => {
  it('accepts Vercel cron invocations when no cron secret is configured', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.CRON_SECRET

    expect(isAuthorizedSnapshotRequest(new Request('https://example.com/api/cron', {
      headers: { 'user-agent': 'vercel-cron/1.0' },
    }))).toBe(true)
  })

  it('requires the bearer token when a cron secret is configured', () => {
    process.env.NODE_ENV = 'production'
    process.env.CRON_SECRET = 'snapshot-secret'

    expect(isAuthorizedSnapshotRequest(new Request('https://example.com/api/cron', {
      headers: { 'user-agent': 'vercel-cron/1.0' },
    }))).toBe(false)
    expect(isAuthorizedSnapshotRequest(new Request('https://example.com/api/cron', {
      headers: { authorization: 'Bearer snapshot-secret' },
    }))).toBe(true)
    expect(hasSnapshotBearerAuthorization(new Request('https://example.com/api/cron', {
      headers: { authorization: 'Bearer snapshot-secret' },
    }))).toBe(true)
    expect(hasSnapshotBearerAuthorization(new Request('https://example.com/api/cron', {
      headers: { 'user-agent': 'vercel-cron/1.0' },
    }))).toBe(false)
  })
})

describe('scheduled earnings snapshot rate-limit fallback', () => {
  it('recognizes typed and response-shaped rate-limit failures', () => {
    expect(isSnapshotRateLimit(
      new RealApiError('rate_limited', 'Real API rate limited this request.', 429),
    )).toBe(true)
    expect(isSnapshotRateLimit({ status: 429 })).toBe(true)
    expect(isSnapshotRateLimit(new RealApiError('timeout', 'Timed out.'))).toBe(false)
    expect(isSnapshotRateLimit(new Error('Unrelated failure.'))).toBe(false)
  })

  it('uses a short bounded delay before one account-level retry', () => {
    expect(snapshotRetryDelayMs(() => 0)).toBe(2_500)
    expect(snapshotRetryDelayMs(() => 0.5)).toBe(3_750)
    expect(snapshotRetryDelayMs(() => 1)).toBe(5_000)
  })

  it('shares fresh public game data across accounts in one snapshot invocation', () => {
    const now = new Date('2026-10-18T10:30:00Z')
    expect(snapshotPublicCacheNamespace('2026-10-17', now, 1)).toBe(
      'snapshot:2026-10-17:2026-10-18T10:30:00.000Z:attempt:1',
    )
  })

  it('reserves enough invocation time to finish or defer cleanly', () => {
    expect(hasSnapshotTimeBudget(1_000, 200_000, 5_000)).toBe(true)
    expect(hasSnapshotTimeBudget(1_000, 230_000, 2_000)).toBe(false)
  })

  it('prioritizes the opposite end of the account list on the 6 AM fallback', () => {
    const usernames = ['alpha', 'gordon', 'twinchenzo']

    expect(orderSnapshotUsernames(usernames)).toEqual(usernames)
    expect(orderSnapshotUsernames(usernames, true)).toEqual([
      'twinchenzo',
      'gordon',
      'alpha',
    ])
    expect(usernames).toEqual(['alpha', 'gordon', 'twinchenzo'])
  })

  it('reports exactly which accounts still lack a saved snapshot', () => {
    expect(missingSnapshotUsernames(
      ['alpha', 'gordon', 'twinchenzo'],
      ['TWINCHENZO'],
      ['alpha'],
    )).toEqual(['gordon'])
  })

  it('configures shifted recovery attempts and the DST-aware final check', () => {
    const config = JSON.parse(
      readFileSync('vercel.json', 'utf8'),
    ) as { crons: Array<{ path: string; schedule: string }> }

    expect(config.crons).toEqual(expect.arrayContaining([
      { path: '/api/cron/snapshot-earnings-summer', schedule: '30 8 * * *' },
      { path: '/api/cron/snapshot-earnings-after-six-summer', schedule: '0 9 * * *' },
      { path: '/api/cron/snapshot-earnings-winter', schedule: '30 9 * * *' },
      { path: '/api/cron/snapshot-earnings-after-six-winter', schedule: '0 10 * * *' },
      { path: '/api/cron/snapshot-earnings-fallback', schedule: '30 10 * * *' },
      { path: '/api/cron/snapshot-earnings-final-check', schedule: '0 11 * * *' },
    ]))
  })

  it('allows complete active-pass scans enough time in manual and scheduled runs', () => {
    const config = JSON.parse(
      readFileSync('vercel.json', 'utf8'),
    ) as { functions: Record<string, { maxDuration: number }> }

    expect(config.functions['api/account/earnings.ts']?.maxDuration).toBe(300)
    expect(config.functions['api/cron/snapshot-earnings*.ts']?.maxDuration).toBe(300)
  })

  it('configures an independent GitHub Actions fallback across EDT and EST', () => {
    const workflow = readFileSync('.github/workflows/earnings-snapshot.yml', 'utf8')

    expect(workflow).toContain("cron: '35 8-11 * * *'")
    expect(workflow).toContain("cron: '55 8-11 * * *'")
    expect(workflow).toContain('secrets.CRON_SECRET')
    expect(workflow).toContain('/api/cron/$route')
    expect(workflow).toContain('query="?test=1"')
    expect(workflow).toContain("--write-out '%{http_code}'")
    expect(workflow).toContain("jq --exit-status '.ok == true'")
  })

  it('uses production-resolvable ESM imports in the Node cron function', () => {
    const source = readFileSync('api/cron/snapshot-earnings.ts', 'utf8')

    expect(source).toContain("from '../../lib/httpResponses.js'")
    expect(source).not.toContain("from '../../lib/httpResponses'\n")
  })
})
