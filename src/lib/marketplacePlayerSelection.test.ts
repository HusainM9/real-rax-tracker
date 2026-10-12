import { describe, expect, it } from 'vitest'
import type { MarketplaceAlertPlayer } from '../../lib/marketplaceAlerts'
import {
  applyMarketplacePlayerSelection,
  filterMarketplacePlayers,
  initialMarketplacePlayerSelection,
} from './marketplacePlayerSelection'

const players: MarketplaceAlertPlayer[] = [
  { entityId: 1, name: 'Kenneth Walker', rarityLabel: 'Rare 8' },
  { entityId: 2, name: 'A.J. Brown', rarityLabel: 'Iconic 1' },
  { entityId: 3, name: 'Baker Mayfield', rarityLabel: 'Epic 4' },
]

describe('marketplace player selection', () => {
  it('selects every loaded player for a first-time picker', () => {
    expect(initialMarketplacePlayerSelection(players, [])).toEqual([1, 2, 3])
  })

  it('keeps only existing selections that are still available after a reload', () => {
    expect(initialMarketplacePlayerSelection(players, [
      { entityId: 2, name: 'Old A.J. Brown' },
      { entityId: 99, name: 'No longer owned' },
    ])).toEqual([2])
  })

  it('applies the chosen players in loaded order and preserves custom filters', () => {
    expect(applyMarketplacePlayerSelection(players, [{
      entityId: 2,
      name: 'A.J. Brown',
      pricePerRatingMax: 35,
      rarities: ['Iconic'],
      noBidsOnly: true,
      alwaysNotifyIconic: true,
      alwaysNotifyMystic: true,
    }], [3, 2])).toEqual([
      { entityId: 2, name: 'A.J. Brown', rarityLabel: 'Iconic 1', pricePerRatingMax: 35, rarities: ['Iconic'], noBidsOnly: true, alwaysNotifyIconic: true, alwaysNotifyMystic: true },
      { entityId: 3, name: 'Baker Mayfield', rarityLabel: 'Epic 4' },
    ])
  })

  it('filters by player name or rarity without changing the original order', () => {
    expect(filterMarketplacePlayers(players, 'walker')).toEqual([players[0]])
    expect(filterMarketplacePlayers(players, 'ICONIC')).toEqual([players[1]])
    expect(filterMarketplacePlayers(players, '  ')).toEqual(players)
  })
})
