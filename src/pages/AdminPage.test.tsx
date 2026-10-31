// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createOperationalError } from '../../lib/operationalErrorTypes'
import AdminPage from './AdminPage'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), logout: vi.fn() }))
vi.mock('../lib/safeImportFetch', () => ({ safeFetch: mocks.fetch, safeImportFetch: mocks.fetch }))
vi.mock('../context/AdminAuthContext', () => ({ useAdminAuth: () => ({ logout: mocks.logout, devBypass: false }) }))
vi.mock('../components/AdminAccountTrackers', () => ({ default: () => <p>Saved account trackers</p> }))
vi.mock('../components/CatalogSearchPanel', () => ({ CatalogSearchPanel: () => <p>Saved catalog search</p> }))
let container: HTMLDivElement, root: Root
const critical = createOperationalError({ source: 'real', kind: 'http', status: 500, operation: 'real_ufc_day' })
let history: { events: ReturnType<typeof createOperationalError>[]; confirmed: ReturnType<typeof createOperationalError>[]; total: number; nextCursor: string | null; partialSearch: boolean }
const render = async () => { await act(async () => root.render(<MemoryRouter><AdminPage /></MemoryRouter>)) }
const click = async (text: string) => { const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === text)!; expect(button).toBeDefined(); await act(async () => button.click()) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks()
  history = { events: [createOperationalError({ source: 'browser', kind: 'http', status: 500, operation: '/cards' }), createOperationalError({ source: 'real', kind: 'http', status: 503, operation: '/api/import/pack-ratings' })], confirmed: [critical], total: 2, nextCursor: null, partialSearch: false }
  mocks.fetch.mockImplementation(async (url: string) => Response.json(url.startsWith('/api/admin/errors') ? history : url.startsWith('/api/admin/users') ? { users: [], storageConfigured: true } : url.startsWith('/api/admin/events') ? { events: [], total: 0, storageConfigured: true } : { snapshots: [] }))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('opens on saved errors, pins confirmed Real500 separately, and defers all other tools and reads', async () => {
  await render()
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  expect(mocks.fetch.mock.calls[0]![0]).toMatch(/^\/api\/admin\/errors/)
  expect(container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Errors')
  expect(container.querySelector('.admin-critical-history')!.textContent).toContain('UFC daily games')
  expect(container.querySelector('.admin-error-history')!.textContent).toContain('Browser')
  expect(container.querySelector('.admin-error-history')!.textContent).toContain('503')
  expect(container.textContent).not.toContain('Start crawl')
  await click('Accounts')
  expect(container.textContent).toContain('Account management')
  expect(container.textContent).toContain('Saved account trackers')
  await click('Catalog')
  expect(container.textContent).toContain('Catalog / Real shop crawl')
  expect(mocks.fetch.mock.calls.some(call => /shop-earnings-crawl|pack-ratings|real-passes/.test(call[0]))).toBe(false)
  await click('Activity')
  expect(container.textContent).toContain('Event log')
  expect(mocks.fetch.mock.calls.some(call => call[0].startsWith('/api/admin/events'))).toBe(true)
})
it('submits filters across stored history, supports continuation, and keeps unknown data honest on a failed read', async () => {
  history.partialSearch = true; history.nextCursor = '1002:1000'; history.events = []
  await render()
  expect(container.textContent).toContain('No matches in this segment')
  await click('Search older records')
  expect(mocks.fetch.mock.calls.at(-1)![0]).toContain('cursor=1002%3A1000')
  const input = container.querySelector<HTMLInputElement>('input[name="query"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Packs'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => container.querySelector<HTMLFormElement>('.admin-error-filters')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(mocks.fetch.mock.calls.at(-1)![0]).toContain('query=Packs')
  expect(mocks.fetch.mock.calls.at(-1)![0]).not.toContain('cursor=')
  mocks.fetch.mockResolvedValue(Response.json({ error: 'private body' }, { status: 503 }))
  await click('Refresh history')
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('unavailable')
  expect(container.textContent).not.toContain('private body')
  expect(container.textContent).toContain('Saved incident list unavailable')
  expect(container.textContent).not.toContain('No errors recorded')
})
