import { RARITY_TIERS, passRarityLookupKey } from './rarityFilter'
import { runWithConcurrency } from './runWithConcurrency'
import { seasonLabelFromSportRaw } from './usernameImportShared'
import type { RealPass, RealPassQuery } from './realApi'

export type RealPassKind = 'player' | 'team'

/** Matches the shape `importFromUsername` consumes (MeowbotPlayerPass). */
export type NormalizedRealPass = {
  entityId: number
  season: number
  sportRaw: string
  pair: string
  passKind: RealPassKind
  rarityLabel?: string
  playerName?: string
  seasonLabel?: string
  /** Real CDN avatar key from `entity.avatar` (face or team badge). */
  avatar?: string
}

export type RealPassPayload = {
  playerPasses: NormalizedRealPass[]
  teamPasses: NormalizedRealPass[]
  rarities: Record<string, string[]>
}

/**
 * Real uses aliases in the `sport` field (`soccer` for FC). Canonicalize once here so the
 * pair string, the rarity lookup key and every downstream sport mapping agree.
 */
export function canonicalRealSport(raw: string): string {
  const sport = raw.trim().toLowerCase()
  if (sport === 'soccer') return 'fc'
  if (sport === 'ncaab' || sport === 'ncaa-mens-basketball' || sport === 'cbb') return 'ncaam'
  if (sport === 'ncaafootball' || sport === 'ncaa-football' || sport === 'cfb') return 'ncaaf'
  return sport
}

/**
 * Inverse of `canonicalRealSport` for request paths. `canonicalRealSport` is lossy (both `soccer`
 * and `fc` collapse to `fc`), and only the pass-list value is confirmed, so callers try each
 * candidate in order and fall through on a 404 rather than assuming one slug.
 */
export function realRequestSportSlugs(canonicalSport: string): string[] {
  const sport = canonicalSport.trim().toLowerCase()
  switch (sport) {
    case 'fc':
      return ['soccer', 'fc']
    case 'ncaam':
      return ['ncaam', 'ncaab', 'cbb']
    case 'ncaaf':
      return ['ncaaf', 'cfb']
    default:
      return sport ? [sport] : []
  }
}

/**
 * Live responses use title case (`"Iconic 1"`), which is what `normalizeRarityTier` needs.
 * This is defensive only: an all-caps label would otherwise collapse to the `Other` tier and
 * silently empty the Legendary+ filter.
 */
export function normalizeRealRarityLabel(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  const [head, ...rest] = trimmed.split(' ')
  const tier = RARITY_TIERS.find((candidate) => candidate.toLowerCase() === head?.toLowerCase())
  if (!tier) return trimmed
  return [tier, ...rest].join(' ')
}

function rarityRank(label: string): number {
  const [head, level] = label.split(' ')
  const tierIndex = RARITY_TIERS.findIndex((tier) => tier === head)
  const parsedLevel = Number.parseInt(level ?? '1', 10)
  return tierIndex * 100 + (Number.isFinite(parsedLevel) ? parsedLevel : 1)
}

/**
 * Real's `seasonDisplay` is authoritative and already uses the app's format ("2025-26", "2026"),
 * so it wins over the locally derived label. The derived label is only a fallback for malformed or
 * missing values — normalized pass years use the catalog conventions in seasonYearKindForSport.
 */
function seasonLabelForPass(season: number, sportRaw: string, seasonDisplay: string): string {
  const trimmed = seasonDisplay.replace(/\u2013|\u2014/g, '-').trim()
  if (/^\d{4}(-\d{2})?$/.test(trimmed)) return trimmed
  return seasonLabelFromSportRaw(season, sportRaw)
}

export function realPassPair(entityId: number, season: number, sportRaw: string): string {
  return `${entityId}:${season}:${sportRaw}`
}

/** Extract Real CDN avatar key from a nested `entity` object. */
export function avatarFromRealEntity(entity: unknown): string | undefined {
  if (!entity || typeof entity !== 'object') return undefined
  const avatar = (entity as { avatar?: unknown }).avatar
  if (typeof avatar !== 'string') return undefined
  const trimmed = avatar.trim()
  return trimmed || undefined
}

/** Returns null for passes we cannot key on (missing ids) or that Real has refunded. */
export function normalizeRealPass(raw: RealPass): NormalizedRealPass | null {
  if (raw.isRefunded === true) return null

  const entityId = Number(raw.entityId)
  const sourceSeason = Number(raw.season)
  const sportRaw = canonicalRealSport(String(raw.sport ?? ''))
  if (!Number.isFinite(entityId) || entityId <= 0) return null
  if (!Number.isInteger(sourceSeason) || sourceSeason <= 0) return null
  if (!sportRaw) return null
  // Real's NHL /userpasses response uses start-year (2025 = "2025-26"), while the catalog and
  // the rest of the app use end-year for NHL. Normalize at the provider boundary.
  const season = sportRaw === 'nhl' ? sourceSeason + 1 : sourceSeason

  const rarityLabel = normalizeRealRarityLabel(String(raw.boostInfo?.rarityLabel ?? ''))
  const playerName = String(raw.label ?? '').trim()
  const avatar = avatarFromRealEntity(raw.entity)

  return {
    entityId,
    season,
    sportRaw,
    pair: realPassPair(entityId, season, sportRaw),
    passKind: String(raw.entityType ?? '').trim().toLowerCase() === 'team' ? 'team' : 'player',
    rarityLabel: rarityLabel || undefined,
    playerName: playerName || undefined,
    seasonLabel: seasonLabelForPass(season, sportRaw, String(raw.seasonDisplay ?? '')),
    avatar,
  }
}

/**
 * Collapses multiple owned copies of the same entity/season/sport into one pass (so the import
 * creates one card) while collecting every copy's rarity label into the `rarities` map. The
 * surviving pass keeps the highest rarity so the card shows the best copy.
 */
export function buildRealPassPayload(rawPasses: RealPass[]): RealPassPayload {
  const byKey = new Map<string, NormalizedRealPass>()
  const rarities: Record<string, string[]> = {}

  for (const raw of rawPasses) {
    const pass = normalizeRealPass(raw)
    if (!pass) continue

    const dedupeKey = `${pass.passKind}|${pass.pair}`
    const existing = byKey.get(dedupeKey)
    if (!existing) {
      byKey.set(dedupeKey, pass)
    } else {
      const next = { ...existing }
      if (
        pass.rarityLabel &&
        rarityRank(pass.rarityLabel) > rarityRank(existing.rarityLabel ?? '')
      ) {
        next.rarityLabel = pass.rarityLabel
      }
      if (pass.avatar && !existing.avatar) next.avatar = pass.avatar
      byKey.set(dedupeKey, next)
    }

    if (!pass.rarityLabel) continue
    const lookupKey = passRarityLookupKey(pass)
    const labels = rarities[lookupKey] ?? []
    if (!labels.includes(pass.rarityLabel)) {
      labels.push(pass.rarityLabel)
      rarities[lookupKey] = labels
    }
  }

  const passes = [...byKey.values()]
  return {
    playerPasses: passes.filter((pass) => pass.passKind === 'player'),
    teamPasses: passes.filter((pass) => pass.passKind === 'team'),
    rarities,
  }
}

export type RealScanTarget = Pick<RealPassQuery, 'entityType' | 'season' | 'sport'>

export type RealScanOptions = {
  /** Omit for the default single unfiltered request that returns the whole collection. */
  targets?: RealScanTarget[]
  concurrency?: number
}

export type RealScanResult = {
  passes: RealPass[]
  strategy: 'single' | 'targeted'
  requests: number
}

/**
 * One unfiltered `/userpasses/{userId}/passes` call returns the entire collection across every
 * sport, season and entity type, so that is the default. Explicit `targets` switch to the
 * parameterised form for incremental refreshes of a single sport/season/entity type.
 */
export async function scanRealUserPasses(
  userId: string,
  listPassesFor: (query: RealPassQuery) => Promise<RealPass[]>,
  options: RealScanOptions = {},
): Promise<RealScanResult> {
  const targets = options.targets ?? []
  if (targets.length === 0) {
    const passes = await listPassesFor({ userId })
    return { passes, strategy: 'single', requests: 1 }
  }

  const collected: RealPass[] = []
  await runWithConcurrency(targets, options.concurrency ?? 4, async (target) => {
    const passes = await listPassesFor({ userId, ...target })
    collected.push(...passes)
  })
  return { passes: collected, strategy: 'targeted', requests: targets.length }
}
