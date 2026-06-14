import { describe, expect, it } from 'vitest'
import { buildUsernameOwnershipSnapshot, meowbotPassToOwnershipPass } from './usernameOwnershipImport'

describe('usernameOwnershipImport', () => {
  it('maps Meowbot passes into ownership snapshot rows with earnings', () => {
    const pass = {
      entityId: 100,
      seasonYear: 2026,
      sportRaw: 'nba',
      sport: 'NBA',
      seasonLabel: '2025-26',
      name: 'Test Player',
      rarityLabel: 'Legendary 1',
      passKind: 'player' as const,
      externalKey: '100|2026|NBA',
      earnings: [{ claimDay: '2025-08-22', baseRaxEarned: 26 }],
    }

    expect(meowbotPassToOwnershipPass(pass)).toEqual({
      name: 'Test Player',
      sport: 'NBA',
      season: '2025-26',
      seasonYear: 2026,
      entityId: 100,
      rarityLabel: 'Legendary 1',
      externalKey: '100|2026|NBA',
      passKind: 'player',
      earnings: [{ claimDay: '2025-08-22', baseRaxEarned: 26 }],
    })

    const snapshot = buildUsernameOwnershipSnapshot('@friend', [meowbotPassToOwnershipPass(pass)])
    expect(snapshot.realUsername).toBe('friend')
    expect(snapshot.clientId).toBe('admin-username-ownership')
    expect(snapshot.passes).toHaveLength(1)
    expect(snapshot.passes[0]?.earnings).toHaveLength(1)
  })
})
