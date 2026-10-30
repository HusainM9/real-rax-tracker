import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogSearchResult } from '../lib/catalogApi'
import { PlayerListingsRequestError } from '../lib/marketplacePlayerListingsApi'
import MarketplacePlayerListings from './MarketplacePlayerListings'

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), cards: vi.fn() }))
vi.mock('../lib/catalogApi', () => ({ fetchCatalogPassSummaries: mocks.catalog }))
vi.mock('../lib/marketplacePlayerListingsApi', async (original) => ({
  ...await original<typeof import('../lib/marketplacePlayerListingsApi')>(), fetchPlayerCards: mocks.cards,
}))

const players = Array.from({ length: 36 }, (_, index) => ({
  entityId: index + 1, name: `Player ${String(index + 1).padStart(2, '0')}`, totalBaseRax: 1000 - index,
  sport: 'NFL', seasonYear: 2026, seasonLabel: '2026', passKind: 'player', avatar: '',
})) as CatalogSearchResult[]

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.catalog.mockResolvedValue({ results: players, storageConfigured: true })
  mocks.cards.mockImplementation(async (_sport: string, _season: number, entityId: number) => ({
    ownerCount: entityId === 1 ? 99 : entityId === 2 ? null : 100 + entityId,
    ...(entityId <= 2 ? { listingsSkipped: entityId === 1 ? 'minimum-owners' : 'unknown-owners' } : {}),
    listings: entityId % 2 ? [{ id: entityId, listingType: 'card', status: 'open', currentBidAmount: 100, buyNowPrice: 100 }] : [],
    incompleteTypes: [], fetchedAt: '2026-10-30T12:00:00Z',
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function render() { await act(async () => root.render(<MarketplacePlayerListings />)) }
const rows = () => [...container.querySelectorAll('.marketplace-players-table > tbody > tr')]
const button = (name: string) => [...container.querySelectorAll('button')].find((element) => element.textContent?.trim().startsWith(name))!

describe('player listings table', () => {
  it('does not reset loaded rows when the initial search debounce would expire', async () => {
    vi.useFakeTimers()
    await render()
    await act(async () => button('Load 25 more').click())
    expect(rows()).toHaveLength(34)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(rows()).toHaveLength(34)
  })

  it('automatically qualifies ownership, shows 25 rows, sorts through headers and loads more', async () => {
    await render()
    expect(rows()).toHaveLength(25)
    expect(container.querySelector('tbody')?.textContent).not.toContain('Player 01')
    expect(container.querySelector('tbody')?.textContent).not.toContain('Player 02')
    expect(mocks.cards.mock.calls.every((call) => call[5] === 100)).toBe(true)
    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
    expect(container.textContent).not.toContain('Check players on this page')

    await act(async () => button('Owners').click())
    expect(container.querySelector('th[aria-sort="descending"]')?.textContent).toContain('Owners')
    const highOwnerCount = Number(rows()[0]!.children[1]!.textContent)
    await act(async () => button('Owners').click())
    expect(container.querySelector('th[aria-sort="ascending"]')?.textContent).toContain('Owners')
    expect(Number(rows()[0]!.children[1]!.textContent)).toBeLessThan(highOwnerCount)

    await act(async () => button('Load 25 more').click())
    expect(rows()).toHaveLength(34)
    expect(container.textContent).toContain('34 players shown')
    await act(async () => button('Retry unavailable players').click())
    expect(mocks.cards.mock.calls.filter((call) => call[2] === 2).at(-1)?.[4]).toBe(true)
  })

  it('uses a dropdown to filter target cards and exposes details inline', async () => {
    await render()
    const listingsSelect = container.querySelectorAll('select')[1]!
    await act(async () => { listingsSelect.value = 'target'; listingsSelect.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(rows().length).toBe(17)
    expect(rows().every((row) => row.children[4]?.textContent === '1')).toBe(true)
    await act(async () => button('View listings').click())
    expect(container.querySelector('.marketplace-player-auctions')).not.toBeNull()
    expect(container.textContent).toContain('Seller target')
  })

  it('stops on missing access instead of requesting the whole catalog', async () => {
    mocks.cards.mockRejectedValue(new PlayerListingsRequestError('Sign in required.', 401))
    await render()
    expect(mocks.cards.mock.calls.length).toBeLessThanOrEqual(2)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Sign in required.')
    expect(container.textContent).not.toContain('0 at target')
    expect(button('Retry unavailable players')).toBeDefined()
  })

  it('bounds an unsuccessful ownership scan to 100 candidates per batch', async () => {
    mocks.catalog.mockResolvedValue({ results: Array.from({ length: 200 }, (_, index) => ({ ...players[0], entityId: index + 1 })), storageConfigured: true })
    mocks.cards.mockResolvedValue({ ownerCount: 99, listings: [], listingsSkipped: 'minimum-owners', incompleteTypes: [], fetchedAt: '2026-10-30T12:00:00Z' })
    await render()
    expect(mocks.cards).toHaveBeenCalledTimes(100)
    expect(container.textContent).toContain('0 players shown')
    expect(button('Check more players')).toBeDefined()
  })
})
