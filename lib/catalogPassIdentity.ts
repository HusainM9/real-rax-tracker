import type { CatalogPassKind } from './meowbotCatalogStore'

export type CatalogPassIdentityFields = {
  passKind: CatalogPassKind
  sport: string
  seasonYear: number
  seasonLabel?: string
  name: string
  entityId?: number
  externalKey?: string
  rarityLabel?: string
  totalBaseRax?: number
  rowCount?: number
}

function normalizePassName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function seasonLabelForIdentity(item: {
  seasonLabel?: string
  seasonYear: number
}): string {
  const label = item.seasonLabel?.trim()
  return label || String(item.seasonYear)
}

export function parseEntityIdFromExternalKey(externalKey?: string): number | null {
  if (!externalKey) return null
  const entityId = Number(externalKey.split('|')[0])
  return Number.isFinite(entityId) ? entityId : null
}

/** Stable identity for one logical catalog pass (ignores duplicate external keys). */
export function catalogPassIdentityKey(item: CatalogPassIdentityFields): string {
  const sport = item.sport.trim()
  const season = seasonLabelForIdentity(item)
  if (item.passKind === 'team') {
    const entityId = item.entityId ?? parseEntityIdFromExternalKey(item.externalKey)
    return `team|${sport}|${season}|${entityId ?? normalizePassName(item.name)}`
  }
  return `player|${sport}|${season}|${normalizePassName(item.name)}`
}

function iconicRank(rarityLabel?: string): number {
  const label = rarityLabel?.trim().toLowerCase() ?? ''
  if (label.startsWith('iconic')) return 3
  if (label.startsWith('legendary')) return 2
  if (label.startsWith('rare')) return 1
  return 0
}

/** Pick one catalog row when the database has duplicates for the same player. */
export function compareCatalogPassRepresentatives(
  a: CatalogPassIdentityFields,
  b: CatalogPassIdentityFields,
): number {
  const raxDiff = (b.totalBaseRax ?? 0) - (a.totalBaseRax ?? 0)
  if (raxDiff !== 0) return raxDiff

  const iconicDiff = iconicRank(b.rarityLabel) - iconicRank(a.rarityLabel)
  if (iconicDiff !== 0) return iconicDiff

  const rowDiff = (b.rowCount ?? 0) - (a.rowCount ?? 0)
  if (rowDiff !== 0) return rowDiff

  return (a.externalKey ?? '').localeCompare(b.externalKey ?? '')
}

export function dedupeCatalogPassSummaries<T extends CatalogPassIdentityFields>(
  items: readonly T[],
): { items: T[]; duplicatesRemoved: number } {
  const byIdentity = new Map<string, T>()

  for (const item of items) {
    const key = catalogPassIdentityKey(item)
    const existing = byIdentity.get(key)
    if (!existing || compareCatalogPassRepresentatives(existing, item) > 0) {
      byIdentity.set(key, item)
    }
  }

  return {
    items: [...byIdentity.values()],
    duplicatesRemoved: Math.max(0, items.length - byIdentity.size),
  }
}

export function catalogPassIdentityKeyFromOwnedCard(card: {
  passKind?: CatalogPassKind
  sport: string
  season: string
  name: string
  externalKey?: string
}): string {
  return catalogPassIdentityKey({
    passKind: card.passKind ?? 'player',
    sport: card.sport,
    seasonYear: 0,
    seasonLabel: card.season,
    name: card.name,
    entityId: parseEntityIdFromExternalKey(card.externalKey) ?? undefined,
    externalKey: card.externalKey,
  })
}
