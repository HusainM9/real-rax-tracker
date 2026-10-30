import { beforeEach, vi } from 'vitest'
import { memoryRequestSafetyStore } from './requestSafetyFake'

vi.mock('../../lib/requestSafetyStore', async () => {
  const { memoryRequestSafetyStore } = await import('./requestSafetyFake')
  return { requestSafetyStore: memoryRequestSafetyStore() }
})
// Keep existing storage tests' explicit @vercel/kv fakes at the external boundary.
vi.mock('../../lib/noRetryKv', async () => {
  const { kv } = await import('@vercel/kv')
  return { kv, getNoRetryKv: () => kv }
})
import { requestSafetyStore } from '../../lib/requestSafetyStore'

// No test may accidentally use environment credentials to contact a live service.
const denyFetch: typeof fetch = async () => {
  throw new Error('Offline tests: unmocked fetch is forbidden. Supply an explicit mock response.')
}
globalThis.fetch = denyFetch
beforeEach(() => {
  vi.stubGlobal('fetch', denyFetch)
  ;(requestSafetyStore as ReturnType<typeof memoryRequestSafetyStore>).clear?.()
  if (typeof localStorage !== 'undefined') for (const key of Object.keys(localStorage)) if (key.startsWith('rax:request-safety:')) localStorage.removeItem(key)
})
