import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage'
vi.mock('../context/AccountAuthContext', () => ({ useAccountAuth: () => ({ username: 'fixture' }) }))
vi.mock('../context/RaxDataContext', async () => {
  const { createEmptyData } = await import('../lib/storage')
  return { useRaxData: () => ({ data: createEmptyData() }) }
})

it('keeps marketplace/collection stats without linking to the removed Earnings page', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter><ProfilePage /></MemoryRouter>))
    expect(container.querySelector('a[href="/earnings"]')).toBeNull()
    expect(container.querySelector('a[href="/marketplace"]')).not.toBeNull()
    expect(container.textContent).toContain('Claimable')
  } finally { await act(async () => root.unmount()) }
})
