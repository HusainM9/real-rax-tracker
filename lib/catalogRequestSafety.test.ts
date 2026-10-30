import { expect, it, vi } from 'vitest'
import { fetchCatalogPassAvatars } from './meowbotCatalogStore'

it('never retries a Supabase 5xx, including a later query with different pass keys', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://catalog.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-token')
  const fetcher = vi.fn().mockResolvedValue(Response.json({ code: '57014', message: 'statement timeout' }, { status: 500 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(fetchCatalogPassAvatars(['1|2026|NBA'])).rejects.toMatchObject({ upstreamStatus: 500, retryable: false })
  await expect(fetchCatalogPassAvatars(['2|2026|NBA'])).rejects.toMatchObject({ upstreamStatus: 500, retryable: false })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
