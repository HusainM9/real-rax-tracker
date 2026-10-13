import { afterEach, describe, expect, it } from 'vitest'
import { isAuthorizedMarketplaceScanRequest } from './marketplace-alerts'

const originalNodeEnv = process.env.NODE_ENV
const originalScanSecret = process.env.MARKETPLACE_SCAN_SECRET
const originalQstashSecret = process.env.MARKETPLACE_QSTASH_SECRET
const originalCronSecret = process.env.CRON_SECRET

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  if (originalScanSecret === undefined) delete process.env.MARKETPLACE_SCAN_SECRET
  else process.env.MARKETPLACE_SCAN_SECRET = originalScanSecret
  if (originalQstashSecret === undefined) delete process.env.MARKETPLACE_QSTASH_SECRET
  else process.env.MARKETPLACE_QSTASH_SECRET = originalQstashSecret
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
})

describe('marketplace scanner authorization', () => {
  it('requires a configured secret in production', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MARKETPLACE_SCAN_SECRET
    delete process.env.MARKETPLACE_QSTASH_SECRET
    delete process.env.CRON_SECRET
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com'))).toBe(false)
  })

  it('accepts the dedicated marketplace secret', () => {
    process.env.NODE_ENV = 'production'
    process.env.MARKETPLACE_SCAN_SECRET = 'market-secret'
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com', {
      headers: { authorization: 'Bearer market-secret' },
    }))).toBe(true)
  })

  it('accepts a separate QStash secret without replacing the GitHub secret', () => {
    process.env.NODE_ENV = 'production'
    process.env.MARKETPLACE_SCAN_SECRET = 'github-secret'
    process.env.MARKETPLACE_QSTASH_SECRET = 'qstash-secret'
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com', {
      headers: { authorization: 'Bearer qstash-secret' },
    }))).toBe(true)
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com', {
      headers: { authorization: 'Bearer github-secret' },
    }))).toBe(true)
  })

  it('rejects missing, malformed, and incorrect bearer credentials', () => {
    process.env.NODE_ENV = 'production'
    process.env.MARKETPLACE_SCAN_SECRET = 'market-secret'
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com'))).toBe(false)
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com', {
      headers: { authorization: 'market-secret' },
    }))).toBe(false)
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com', {
      headers: { authorization: 'Bearer wrong-secret' },
    }))).toBe(false)
  })

  it('prefers the dedicated secret over the fallback cron secret', () => {
    process.env.NODE_ENV = 'production'
    process.env.MARKETPLACE_SCAN_SECRET = 'market-secret'
    process.env.CRON_SECRET = 'cron-secret'
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com', {
      headers: { authorization: 'Bearer cron-secret' },
    }))).toBe(false)
  })

  it('falls back to the existing cron secret', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MARKETPLACE_SCAN_SECRET
    delete process.env.MARKETPLACE_QSTASH_SECRET
    process.env.CRON_SECRET = 'cron-secret'
    expect(isAuthorizedMarketplaceScanRequest(new Request('https://example.com', {
      headers: { authorization: 'Bearer cron-secret' },
    }))).toBe(true)
  })

  it('allows local development requests without a secret', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.MARKETPLACE_SCAN_SECRET
    delete process.env.MARKETPLACE_QSTASH_SECRET
    delete process.env.CRON_SECRET
    expect(isAuthorizedMarketplaceScanRequest(new Request('http://localhost'))).toBe(true)
  })
})
