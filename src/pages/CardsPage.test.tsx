// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createEmptyData } from '../lib/storage'
import type { RaxTrackerData } from '../types/rax'
import CardsPage from './CardsPage'

const mocks = vi.hoisted(() => ({ ignore: vi.fn(() => true), unignore: vi.fn(), remove: vi.fn(), rarity: vi.fn() }))
let data: RaxTrackerData
vi.mock('../context/RaxDataContext', () => ({ useRaxData: () => ({ data, ignorePassOnImport: mocks.ignore, unignorePassKey: mocks.unignore, removeCardFromCollection: mocks.remove, setCardRarity: mocks.rarity }) }))
let container: HTMLDivElement, root: Root
const render = async () => { await act(async () => root.render(<MemoryRouter><CardsPage /></MemoryRouter>)) }
const search = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  data = { ...createEmptyData(), cards: Array.from({ length: 53 }, (_, index) => ({ id: `card-${index}`, name: index === 52 ? 'Aaron Judge' : `Player ${String(index).padStart(2, '0')}`, sport: 'CBB', season: '2023-24', notes: '', externalKey: `${index}|2024|CBB`, rarityLabel: 'Iconic 1', createdAt: '2026-10-31' })) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })

it('finds exclusions across the whole collection independently of the main filters and pagination', async () => {
  await render()
  const table = container.querySelector('.collection-table')!
  expect(table.querySelectorAll('tbody tr')).toHaveLength(50)
  expect(table.textContent).not.toContain('Aaron Judge')
  expect(table.textContent).not.toContain('Ignore on import')
  const exclusions = container.querySelector('#collection-import-exclusions')!
  expect(exclusions).not.toBeNull()
  expect(container.querySelector('.collection-workspace')!.lastElementChild).toBe(exclusions)
  await search(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'No matching player')
  expect(table.textContent).toContain('No cards match')
  await search(exclusions.querySelector<HTMLInputElement>('input[type="search"]')!, '  aaron  ')
  expect(exclusions.textContent).toContain('Aaron Judge')
  const ignore = Array.from(exclusions.querySelectorAll('button')).find(button => button.textContent === 'Ignore on import')!
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await act(async () => ignore.click())
  expect(mocks.ignore).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => ignore.click())
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Removes it from your collection'))
  expect(mocks.ignore).toHaveBeenCalledExactlyOnceWith('card-52')
  expect(exclusions.querySelector('[role="status"]')!.textContent).toContain('Aaron Judge')
})

it('only offers imported passes for exclusion and keeps restoring existing exclusions available', async () => {
  delete data.cards[0]!.externalKey
  data.ignoredPassKeys = ['999|2027|NHL']
  await render()
  const exclusions = container.querySelector('#collection-import-exclusions')!
  expect(exclusions).not.toBeNull()
  const input = exclusions.querySelector<HTMLInputElement>('input[type="search"]')!
  await search(input, 'Player 00')
  expect(exclusions.textContent).toContain('No imported passes match')
  expect(exclusions.textContent).not.toContain('Ignore on import')
  await search(input, 'Player')
  const next = Array.from(exclusions.querySelectorAll('button')).find(button => button.textContent === 'Next matches')!
  expect(next).toBeDefined()
  await act(async () => next.click())
  expect(exclusions.textContent).toContain('Player 51')
  await search(input, 'Aaron')
  expect(exclusions.textContent).toContain('Aaron Judge')
  expect(exclusions.textContent).not.toContain('Page 2')
  const restore = Array.from(exclusions.querySelectorAll('button')).find(button => button.textContent === 'Allow import')!
  await act(async () => restore.click())
  expect(mocks.unignore).toHaveBeenCalledExactlyOnceWith('999|2027|NHL')
})
