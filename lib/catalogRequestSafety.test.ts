import { expect, it, vi } from 'vitest'
import { fetchCatalogPassAvatars } from './meowbotCatalogStore'

it('does not automatically retry a failed catalog read or permanently block later normal queries', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://catalog.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-token')
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ code: '57014', message: 'statement timeout' }, { status: 500 })).mockResolvedValue(Response.json([]))
  vi.stubGlobal('fetch', fetcher)
  await expect(fetchCatalogPassAvatars(['1|2026|NBA'])).rejects.toMatchObject({ status: 500 })
  expect(fetcher).toHaveBeenCalledTimes(1)
  await expect(fetchCatalogPassAvatars(['2|2026|NBA'])).resolves.toBeDefined()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
