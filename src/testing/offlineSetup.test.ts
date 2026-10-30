import { expect, it, vi } from 'vitest'

it('rejects unmocked network access', async () => {
  await expect(fetch('https://offline.invalid')).rejects.toThrow('unmocked fetch is forbidden')
})

it('permits explicitly mocked responses', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ fixture: true })))
  expect(await (await fetch('https://offline.invalid')).json()).toEqual({ fixture: true })
})
