// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import PreviewPerformancePage from './PreviewPerformancePage'

it('does not load or write account data and requires explicit input before ranking', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<PreviewPerformancePage />))
    expect(fetch).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Memory only')
    expect(container.querySelector('input[aria-label="Real username"]')).toBeNull()
    expect([...container.querySelectorAll('button')].filter(button => /Measure Packs|Measure collection import/.test(button.textContent ?? ''))).toHaveLength(0)
    const rank = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Measure rankings'))!
    expect(rank.disabled).toBe(true)
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
