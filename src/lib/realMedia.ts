import { isUfcCatalogSport } from './passKind'

export type RealMediaSize = 'xsmall' | 'small' | 'medium' | 'large'

export type RealEntityImageKind = 'player' | 'team'

const REAL_MEDIA_BASE = 'https://media.realapp.com'

/**
 * CDN folder for an avatar key. UFC fighters are stored as passKind=player for
 * Potential/OTD, but Real hosts their faces under `assets/teams/...`.
 */
export function resolveRealEntityImageKind(
  passKind: RealEntityImageKind = 'player',
  sport?: string | null,
): RealEntityImageKind {
  if (sport && isUfcCatalogSport(sport)) return 'team'
  return passKind === 'team' ? 'team' : 'player'
}

/** First non-empty avatar key among candidates (local card, planned pass, catalog profile, …). */
export function resolvePassAvatar(
  ...candidates: Array<string | null | undefined>
): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

/** Map catalog `externalKey` → avatar for joining onto local cards / planned passes. */
export function avatarByExternalKey(
  items: Array<{ externalKey?: string; avatar?: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of items) {
    const key = item.externalKey?.trim()
    const avatar = item.avatar?.trim()
    if (!key || !avatar || map.has(key)) continue
    map.set(key, avatar)
  }
  return map
}

/**
 * Fill missing `avatar` on local cards from catalog rows keyed by `externalKey`.
 * Returns the same array reference when nothing changes.
 */
export function enrichCardsWithCatalogAvatars<T extends { externalKey?: string; avatar?: string }>(
  cards: T[],
  catalogAvatars: Map<string, string>,
): T[] {
  if (catalogAvatars.size === 0) return cards
  let changed = false
  const next = cards.map((card) => {
    if (card.avatar?.trim()) return card
    const key = card.externalKey?.trim()
    if (!key) return card
    const avatar = catalogAvatars.get(key)
    if (!avatar) return card
    changed = true
    return { ...card, avatar }
  })
  return changed ? next : cards
}

/**
 * Build a Real CDN URL for a player face or team badge.
 * Avatar keys come from Real `entity.avatar` (hash or slug) — not entityId.
 * Same path for college (ncaam/ncaaf) and pro sports.
 * For UFC, pass imageKind=`team` (see {@link resolveRealEntityImageKind}).
 */
export function buildRealEntityImageUrl(
  imageKind: RealEntityImageKind,
  avatar: string,
  size: RealMediaSize = 'large',
): string | null {
  const key = avatar.trim()
  if (!key) return null
  const category = imageKind === 'team' ? 'teams' : 'players'
  // Don't encodeURIComponent the key — Real hashes/slugs are path-safe and encoding
  // can break keys that already include safe characters Real expects literally.
  return `${REAL_MEDIA_BASE}/assets/${category}/default/${size}/${key}.webp`
}
