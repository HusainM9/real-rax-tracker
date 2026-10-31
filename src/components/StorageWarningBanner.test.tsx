// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import StorageWarningBanner from './StorageWarningBanner'

vi.mock('../context/RaxDataContext', () => ({ useRaxData: () => ({ storageReady: true, storageWarning: 'Cloud saving is paused.' }) }))

it('offers explicit account reload with a discard warning and a working backup link', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  const root = createRoot(container)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  try {
    await act(async () => root.render(<MemoryRouter><StorageWarningBanner /></MemoryRouter>))
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/')
    const button = container.querySelector('button')
    expect(button?.textContent).toMatch(/reload/i)
    await act(async () => button?.click())
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/replace.*local.*export/i))
  } finally {
    await act(async () => root.unmount())
    confirm.mockRestore()
  }
})
