import { beforeEach, vi } from 'vitest'

// Shared by every project. Internal application services are not substituted here.
const denyFetch: typeof fetch = async () => {
  throw new Error('Offline tests: unmocked fetch is forbidden. Supply an explicit mock response.')
}

globalThis.fetch = denyFetch
beforeEach(() => { vi.stubGlobal('fetch', denyFetch) })
