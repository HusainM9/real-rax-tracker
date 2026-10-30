import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import MarketplaceAlertsPage from './MarketplaceAlertsPage'
vi.mock('../context/RaxDataContext', async () => {
  const { createEmptyData } = await import('../lib/storage')
  return { useRaxData: () => ({ data: createEmptyData() }) }
})
vi.mock('../context/AccountAuthContext', () => ({ useAccountAuth: () => ({ username: 'fixture-user' }) }))

it('restores the four-minute alerts UI without individual listings or provider requests on mount', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const fetcher = vi.fn(() => { throw new Error('No network allowed') })
  vi.stubGlobal('fetch', fetcher)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MarketplaceAlertsPage />))
    expect(container.textContent).toContain('Hosted · 4 min')
    expect(container.textContent).not.toContain('Temporarily disabled')
    expect(container.textContent).not.toContain('Player listings')
    expect(container.querySelector('button')).not.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})
