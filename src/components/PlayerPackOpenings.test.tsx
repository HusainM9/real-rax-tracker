// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { observePackRating } from '../lib/dailyPacks'
import { PlayerPackOpenings } from './PlayerPackOpenings'
import { AccountAvatar } from './AccountAvatar'

it('renders per-account evidence, invalidates it after reset and falls back without image retries', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'), root = createRoot(host)
  const fetchedAt = '2026-10-30T15:00:00Z'
  const first = observePackRating(undefined, { username: 'main', rating: 100, fetchedAt, startedAt: fetchedAt })
  const next = '2026-10-30T16:00:00Z'
  const observation = observePackRating(first, { username: 'main', rating: 110, fetchedAt: next, startedAt: next })
  const accounts = [{ id: 'a', username: 'main', name: 'Main', rating: 110, opensPacks: true, packObservation: observation }, { id: 'b', username: 'alt', name: 'Alt', rating: 1, opensPacks: true }]
  const render = (now: Date) => <><PlayerPackOpenings player="Player" accounts={accounts} now={now} /><AccountAvatar username="main" profile={{ username: 'main', avatarUrl: 'https://media.realapp.com/example.webp' }} /></>
  try {
    await act(async () => root.render(render(new Date(next))))
    expect(host.textContent).toContain('1 / 2 likely opened')
    expect(host.querySelector('[data-status="unknown"]')).not.toBeNull()
    const image = host.querySelector('img')!
    expect(image.getAttribute('loading')).toBe('lazy')
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await act(async () => image.dispatchEvent(new Event('error')))
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('M')
    expect(fetcher).not.toHaveBeenCalled()
    await act(async () => root.render(render(new Date('2026-10-31T11:00:00Z'))))
    expect(host.textContent).toContain('0 / 2 likely opened')
    expect(host.querySelectorAll('[data-status="unknown"]')).toHaveLength(2)
    await act(async () => root.render(<AccountAvatar username="alt" profile={{ username: 'main', avatarUrl: 'https://media.realapp.com/example.webp' }} />))
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('A')
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
