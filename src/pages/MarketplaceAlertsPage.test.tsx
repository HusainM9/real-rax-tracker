// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import MarketplaceAlertsPage from './MarketplaceAlertsPage'
import { parseMarketplaceAlertRule } from '../../lib/marketplaceAlerts'
import { saveCachedMarketplacePlayers } from '../lib/marketplacePlayerCache'
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

it.each(['FC owned players', 'My hockey bargains'])('keeps NHL selection and its generated/custom name in sync when editing %s', async name => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
  localStorage.clear()
  const stored = parseMarketplaceAlertRule({
    id: 'sport-edit', name, sport: 'fc', season: 2026, entityScope: 'ownedPlayers',
    players: [{ entityId: 101, name: 'Football player' }], itemType: 'bulk',
  })!
  localStorage.setItem('rax-marketplace-alert-rules-v1', JSON.stringify([stored]))
  saveCachedMarketplacePlayers('fixture-user', 'nhl', 2027, [{ entityId: 701, name: 'Hockey player' }])
  const container = document.createElement('div')
  const root = createRoot(container)
  const click = async (text: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === text)!
    expect(button).toBeDefined()
    await act(async () => button.click())
  }
  try {
    await act(async () => root.render(<MarketplaceAlertsPage />))
    await click('Edit alert')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Sport"]')!.click())
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(button => button.textContent?.trim().endsWith('NHL'))!.click())
    await click('Update alert')
    const [saved] = JSON.parse(localStorage.getItem('rax-marketplace-alert-rules-v1')!)
    expect(saved).toMatchObject({
      name: name === 'FC owned players' ? 'NHL owned players' : name,
      sport: 'nhl', season: 2027, players: [{ entityId: 701, name: 'Hockey player' }],
    })
    expect(container.querySelector('.marketplace-rule-card h3')?.textContent).toBe(saved.name)
  } finally {
    await act(async () => root.unmount())
    localStorage.clear()
    vi.useRealTimers()
  }
})
