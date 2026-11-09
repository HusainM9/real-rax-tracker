import { beforeEach, vi } from 'vitest'
import { memoryRequestSafetyStore } from './requestSafetyFake'
import '../../tests/setup/offlineNetwork'

// Compatibility setup for existing unit/UI suites only. Integration projects
// use offlineNetwork directly and exercise the actual stores and official SDK.

vi.mock('../../lib/requestSafetyStore', async () => {
  const { memoryRequestSafetyStore } = await import('./requestSafetyFake')
  return { requestSafetyStore: memoryRequestSafetyStore() }
})
// Keep existing storage tests' explicit @vercel/kv fakes at the external boundary.
vi.mock('../../lib/noRetryKv', async () => {
  const { kv } = await import('@vercel/kv')
  return { kv, getNoRetryKv: () => kv }
})
// Passive error writes are a separate external storage boundary, never a provider
// fetch in request-count tests. Journal tests explicitly load the real store.
vi.mock('../../lib/operationalErrorStore', () => ({
  appendOperationalErrors: async () => 1,
  listOperationalErrors: async () => ({ events: [], total: 0, nextCursor: null, partialSearch: false }),
  listConfirmedRealErrors: async () => [],
}))
import { requestSafetyStore } from '../../lib/requestSafetyStore'

beforeEach(() => {
  ;(requestSafetyStore as ReturnType<typeof memoryRequestSafetyStore>).clear?.()
  if (typeof localStorage !== 'undefined') for (const key of Object.keys(localStorage)) if (key.startsWith('rax:request-safety:')) localStorage.removeItem(key)
})
