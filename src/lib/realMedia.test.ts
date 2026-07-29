import { describe, expect, it } from 'vitest'
import {
  avatarByExternalKey,
  buildRealEntityImageUrl,
  enrichCardsWithCatalogAvatars,
  resolvePassAvatar,
  resolveRealEntityImageKind,
} from './realMedia'

describe('resolveRealEntityImageKind', () => {
  it('uses teams CDN for UFC even when passKind is player', () => {
    expect(resolveRealEntityImageKind('player', 'UFC')).toBe('team')
    expect(resolveRealEntityImageKind('player', 'ufc')).toBe('team')
    expect(resolveRealEntityImageKind('team', 'UFC')).toBe('team')
  })

  it('follows passKind for non-UFC sports', () => {
    expect(resolveRealEntityImageKind('player', 'NBA')).toBe('player')
    expect(resolveRealEntityImageKind('team', 'NBA')).toBe('team')
    expect(resolveRealEntityImageKind('player')).toBe('player')
  })
})

describe('buildRealEntityImageUrl', () => {
  it('builds player and team CDN URLs', () => {
    expect(buildRealEntityImageUrl('player', 'c5f7b44ab4ea35fa57df203aa18eed54')).toBe(
      'https://media.realapp.com/assets/players/default/large/c5f7b44ab4ea35fa57df203aa18eed54.webp',
    )
    expect(buildRealEntityImageUrl('team', 'e898d322da', 'small')).toBe(
      'https://media.realapp.com/assets/teams/default/small/e898d322da.webp',
    )
  })

  it('returns null for blank avatar keys', () => {
    expect(buildRealEntityImageUrl('player', '  ')).toBeNull()
  })
})

describe('resolvePassAvatar / catalog join', () => {
  it('picks the first non-empty avatar', () => {
    expect(resolvePassAvatar(undefined, '  ', 'abc')).toBe('abc')
  })

  it('enriches local cards from catalog avatar keys', () => {
    const cards = [
      { externalKey: '1|2025|NBA', name: 'A', avatar: undefined },
      { externalKey: '2|2025|NBA', name: 'B', avatar: 'keep-me' },
    ]
    const map = avatarByExternalKey([
      { externalKey: '1|2025|NBA', avatar: 'new-face' },
      { externalKey: '2|2025|NBA', avatar: 'ignored' },
    ])
    const next = enrichCardsWithCatalogAvatars(cards, map)
    expect(next[0]?.avatar).toBe('new-face')
    expect(next[1]?.avatar).toBe('keep-me')
  })
})
