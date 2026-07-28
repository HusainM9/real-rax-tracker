import { describe, expect, it } from 'vitest'
import { parsePlayerPair } from './meowbotApi'
import {
  legendaryPlusRarityFilter,
  normalizeRarityTier,
  passMatchesRarityFilter,
  RARITY_TIERS,
  usernameImportRarityFilter,
} from './rarityFilter'

describe('rarityFilter', () => {
  it('normalizes sub-level rarity labels', () => {
    expect(normalizeRarityTier('Iconic 2')).toBe('Iconic')
    expect(normalizeRarityTier('Legendary 5')).toBe('Legendary')
    expect(normalizeRarityTier('Rare')).toBe('Rare')
  })

  it('filters passes by selected tiers', () => {
    const pass = parsePlayerPair('100:2026:nba')
    expect(pass).not.toBeNull()
    const rarities = { '100-2026-nba': ['Iconic 2'] }

    expect(
      passMatchesRarityFilter(pass!, rarities, 'Iconic 2', new Set(['Iconic'])),
    ).toBe(true)
    expect(
      passMatchesRarityFilter(pass!, rarities, 'Iconic 2', new Set(['Rare', 'Epic'])),
    ).toBe(false)
    expect(passMatchesRarityFilter(pass!, rarities, 'Iconic 2', new Set(RARITY_TIERS))).toBe(
      true,
    )
    expect(passMatchesRarityFilter(pass!, rarities, 'Iconic 2', new Set())).toBe(false)
  })

  it('defaults to Legendary+ tiers', () => {
    expect([...legendaryPlusRarityFilter()]).toEqual(['Legendary', 'Mystic', 'Iconic'])
  })

  it('optionally expands username import to Rare and/or Epic', () => {
    expect([...usernameImportRarityFilter()]).toEqual(['Legendary', 'Mystic', 'Iconic'])
    expect([...usernameImportRarityFilter({ includeRare: true })].sort()).toEqual(
      ['Iconic', 'Legendary', 'Mystic', 'Rare'].sort(),
    )
    expect([...usernameImportRarityFilter({ includeEpic: true })].sort()).toEqual(
      ['Epic', 'Iconic', 'Legendary', 'Mystic'].sort(),
    )
    expect(
      [...usernameImportRarityFilter({ includeRare: true, includeEpic: true })].sort(),
    ).toEqual(['Epic', 'Iconic', 'Legendary', 'Mystic', 'Rare'].sort())
  })
})
