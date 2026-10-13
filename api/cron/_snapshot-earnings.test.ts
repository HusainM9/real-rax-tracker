import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { RealApiError } from '../../lib/realApi'
import {
  hasSnapshotTimeBudget,
  isAuthorizedSnapshotRequest,
  isEasternSnapshotTime,
  isSnapshotRateLimit,
  orderSnapshotUsernames,
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
  it('never accepts a run before 5:30 AM Eastern', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T10:29:00Z'))).toBe(false)
    expect(isEasternSnapshotTime(new Date('2026-07-15T09:29:00Z'))).toBe(false)
  })

  it('accepts the 5:30 AM Eastern primary run across DST', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T10:30:00Z'))).toBe(true)
    expect(isEasternSnapshotTime(new Date('2026-07-15T09:30:00Z'))).toBe(true)
  })

  it('accepts a delayed fallback throughout the 6 AM hour', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T11:15:00Z'))).toBe(true)
    expect(isEasternSnapshotTime(new Date('2026-07-15T10:45:00Z'))).toBe(true)
  })

  it('rejects inactive seasonal jobs before 5:30 or after the reset window', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T09:30:00Z'))).toBe(false)
    expect(isEasternSnapshotTime(new Date('2026-07-15T11:30:00Z'))).toBe(false)
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

  it('reserves enough invocation time to finish or defer cleanly', () => {
    expect(hasSnapshotTimeBudget(1_000, 20_000, 5_000)).toBe(true)
    expect(hasSnapshotTimeBudget(1_000, 40_000, 2_000)).toBe(false)
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

  it('configures a DST-aware 6 AM retry in both seasons', () => {
    const config = JSON.parse(
      readFileSync('vercel.json', 'utf8'),
    ) as { crons: Array<{ path: string; schedule: string }> }

    expect(config.crons).toContainEqual({
      path: '/api/cron/snapshot-earnings-after-six-summer',
      schedule: '0 10 * * *',
    })
    expect(config.crons).toContainEqual({
      path: '/api/cron/snapshot-earnings-after-six-winter',
      schedule: '0 11 * * *',
    })
  })
})
