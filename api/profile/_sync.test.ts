import { expect, it, vi } from 'vitest'
import handler from './sync'

vi.mock('../admin/_helpers', () => ({ requireAppSession: async () => null }))
vi.mock('../../lib/trackerProfileStore', () => ({ profileSyncConfigured: () => false }))

it('marks legacy query-credential reads as non-cacheable and deprecated even on failure', async () => {
  const response = await handler(new Request('https://example.test/api/profile/sync?username=test&passphrase=test'))
  expect(response.status).toBe(503)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('deprecation')).toBeTruthy()
})
