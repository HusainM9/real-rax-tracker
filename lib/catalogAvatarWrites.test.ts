import { afterEach, describe, expect, it, vi } from 'vitest'
import { insertCatalogPassesIfMissing, updateCatalogPassAvatars } from './meowbotCatalogStore'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
function configuredFetch() {
  vi.stubEnv('SUPABASE_URL', 'https://catalog.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
describe('avatar-only catalog writes', () => {
  it('patches only avatar, leaving totals, timestamps and earnings metadata untouched', async () => {
    const fetcher = configuredFetch()
    await updateCatalogPassAvatars([{ externalKey: '1|2026|NBA', avatar: 'face-key' }])
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).searchParams.get('external_key')).toBe('eq.1|2026|NBA')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ avatar: 'face-key' })
  })
  it('inserts missing metadata without merging over a concurrent earnings insert', async () => {
    const fetcher = configuredFetch()
    await insertCatalogPassesIfMissing([{ externalKey: '1|2026|NBA', entityId: 1, sport: 'NBA', passKind: 'player', seasonYear: 2026, seasonLabel: '2026-27', name: 'Player', avatar: 'face', hasEarnings: false, totalBaseRax: 0 }])
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('Prefer')).toContain('resolution=ignore-duplicates')
  })
})
