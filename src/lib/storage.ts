import type {
  CachedPlayerEarningsProfile,
  PackAccountTemplate,
  PackTracker,
  PackTrackerAccount,
  PlayerCard,
  PotentialRaxRow,
  RaxPerformance,
  RaxTrackerData,
  SavedPotentialCard,
  SavedCardProfile,
  SavedCardEarningsRow,
  SavedSellRankings,
  SavedSellRankRow,
  SavedSkippedSellRankPass,
  PlannedPass,
} from '../types/rax'
import { looksLikeTeamPassName } from './passKind'
import { rarityLabelFromNotes } from './effectiveRax'
import { normalizeRatingPerPack } from './packTracker'

const STORAGE_KEY = 'real-rax-tracker:v1'
export const EXPORT_VERSION = 1

export function createEmptyData(): RaxTrackerData {
  return {
    version: EXPORT_VERSION,
    settings: {
      proBonusEnabled: true,
      savedUsername: '',
      importRarePasses: false,
      importEpicPasses: false,
    },
    cards: [],
    performances: [],
    potentialCards: [],
    savedCardProfiles: [],
    cachedPlayerEarnings: [],
    savedSellRankings: null,
    plannedPasses: [],
    planSoldCardIds: [],
    sellExcludedCardIds: [],
    packTrackers: [],
    packAccountTemplates: [],
    ignoredPassKeys: [],
  }
}

function hydrateIgnoredPassKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const keys: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const key = entry.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/** Deduped card ids; optionally prune to ids still present in the collection. */
function hydratePlanSoldCardIds(value: unknown, validCardIds?: Set<string>): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || seen.has(id)) continue
    if (validCardIds && !validCardIds.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hydrateCard(value: unknown): PlayerCard | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  const notes = typeof value.notes === 'string' ? value.notes : ''
  const rarityLabel =
    typeof value.rarityLabel === 'string'
      ? value.rarityLabel
      : rarityLabelFromNotes(notes)
  const name = typeof value.name === 'string' ? value.name : ''
  const explicitPassKind =
    value.passKind === 'team' ? 'team' : value.passKind === 'player' ? 'player' : undefined
  return {
    id: value.id,
    name,
    sport: typeof value.sport === 'string' ? (value.sport as PlayerCard['sport']) : 'Other',
    season: typeof value.season === 'string' ? value.season : '',
    notes,
    externalKey: typeof value.externalKey === 'string' ? value.externalKey : undefined,
    rarityLabel,
    passKind: explicitPassKind ?? (looksLikeTeamPassName(name) ? 'team' : undefined),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
  }
}

function hydratePerformance(value: unknown): RaxPerformance | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  const raxEarned = Number(value.raxEarned)
  const baseRaxEarned = Number(value.baseRaxEarned)
  return {
    id: value.id,
    cardId: typeof value.cardId === 'string' ? value.cardId : '',
    claimDay: typeof value.claimDay === 'string' ? value.claimDay : '',
    raxEarned: Number.isFinite(raxEarned) && raxEarned > 0 ? raxEarned : 0,
    baseRaxEarned:
      Number.isFinite(baseRaxEarned) && baseRaxEarned > 0 ? baseRaxEarned : undefined,
    note: typeof value.note === 'string' ? value.note : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
  }
}
function hydratePotentialRow(value: unknown): PotentialRaxRow | null {
  if (!isRecord(value)) return null
  const raxEarned = Number(value.raxEarned)
  return {
    claimDay: typeof value.claimDay === 'string' ? value.claimDay : '',
    raxEarned: Number.isFinite(raxEarned) && raxEarned > 0 ? raxEarned : 0,
    note: typeof value.note === 'string' ? value.note : '',
  }
}

function hydratePotentialCard(value: unknown): SavedPotentialCard | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    sport: typeof value.sport === 'string' ? (value.sport as SavedPotentialCard['sport']) : 'Other',
    season: typeof value.season === 'string' ? value.season : '',
    rows: Array.isArray(value.rows)
      ? value.rows
          .map(hydratePotentialRow)
          .filter((row): row is PotentialRaxRow => row !== null && row.claimDay !== '')
      : [],
    notes: typeof value.notes === 'string' ? value.notes : '',
    rawJson: typeof value.rawJson === 'string' ? value.rawJson : '',
    simulatedRarityLabel:
      typeof value.simulatedRarityLabel === 'string' ? value.simulatedRarityLabel : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt:
      typeof value.updatedAt === 'string'
        ? value.updatedAt
        : typeof value.createdAt === 'string'
          ? value.createdAt
          : new Date().toISOString(),
  }
}

function hydrateSavedCardRow(value: unknown): SavedCardEarningsRow | null {
  if (!isRecord(value)) return null
  const raxEarned = Number(value.raxEarned)
  const baseRaxEarned = Number(value.baseRaxEarned)
  return {
    claimDay: typeof value.claimDay === 'string' ? value.claimDay : '',
    raxEarned: Number.isFinite(raxEarned) && raxEarned > 0 ? raxEarned : 0,
    baseRaxEarned:
      Number.isFinite(baseRaxEarned) && baseRaxEarned > 0 ? baseRaxEarned : undefined,
    note: typeof value.note === 'string' ? value.note : '',
  }
}

function hydrateSavedCardProfile(value: unknown): SavedCardProfile | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  return {
    id: value.id,
    externalKey: typeof value.externalKey === 'string' ? value.externalKey : undefined,
    name: typeof value.name === 'string' ? value.name : '',
    sport: typeof value.sport === 'string' ? (value.sport as SavedCardProfile['sport']) : 'Other',
    season: typeof value.season === 'string' ? value.season : '',
    notes: typeof value.notes === 'string' ? value.notes : '',
    rarityLabel: typeof value.rarityLabel === 'string' ? value.rarityLabel : undefined,
    passKind: value.passKind === 'team' ? 'team' : value.passKind === 'player' ? 'player' : undefined,
    rawJson: typeof value.rawJson === 'string' ? value.rawJson : '',
    rows: Array.isArray(value.rows)
      ? value.rows
          .map(hydrateSavedCardRow)
          .filter((row): row is SavedCardEarningsRow => row !== null && row.claimDay !== '')
      : [],
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt:
      typeof value.updatedAt === 'string'
        ? value.updatedAt
        : typeof value.createdAt === 'string'
          ? value.createdAt
          : new Date().toISOString(),
  }
}

function hydrateCachedPlayerEarnings(value: unknown): CachedPlayerEarningsProfile | null {
  if (!isRecord(value) || typeof value.cacheKey !== 'string') return null
  const entityId = Number(value.entityId)
  const seasonYear = Number(value.seasonYear)
  const passKind = value.passKind === 'team' ? 'team' : 'player'
  return {
    cacheKey: value.cacheKey,
    entityId: Number.isFinite(entityId) ? entityId : 0,
    sport:
      typeof value.sport === 'string' ? (value.sport as CachedPlayerEarningsProfile['sport']) : 'Other',
    season: typeof value.season === 'string' ? value.season : '',
    seasonYear: Number.isFinite(seasonYear) ? seasonYear : 0,
    passKind,
    name: typeof value.name === 'string' ? value.name : '',
    rarityLabel: typeof value.rarityLabel === 'string' ? value.rarityLabel : undefined,
    externalKey: typeof value.externalKey === 'string' ? value.externalKey : value.cacheKey,
    rows: Array.isArray(value.rows)
      ? value.rows
          .map(hydrateSavedCardRow)
          .filter((row): row is SavedCardEarningsRow => row !== null && row.claimDay !== '')
      : [],
    source: value.source === 'manual' ? 'manual' : 'username_import',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  }
}

function hydrateSavedSellRankRow(value: unknown): SavedSellRankRow | null {
  if (!isRecord(value) || typeof value.cardId !== 'string') return null
  return {
    cardId: value.cardId,
    name: typeof value.name === 'string' ? value.name : '',
    sport:
      typeof value.sport === 'string' ? (value.sport as SavedSellRankRow['sport']) : 'Other',
    season: typeof value.season === 'string' ? value.season : '',
    rarityLabel: typeof value.rarityLabel === 'string' ? value.rarityLabel : undefined,
    claimableNow: Number(value.claimableNow) || 0,
    lostClaimableRax: Number(value.lostClaimableRax) || 0,
    freedClaimableRax: Number(value.freedClaimableRax) || 0,
    netClaimableDelta: Number(value.netClaimableDelta) || 0,
  }
}

function hydrateSkippedSellRankPass(value: unknown): SavedSkippedSellRankPass | null {
  if (!isRecord(value) || typeof value.cardId !== 'string') return null
  const reason = value.reason === 'analysis_failed' ? 'analysis_failed' : 'no_earnings'
  return {
    cardId: value.cardId,
    name: typeof value.name === 'string' ? value.name : '',
    sport:
      typeof value.sport === 'string'
        ? (value.sport as SavedSkippedSellRankPass['sport'])
        : 'Other',
    season: typeof value.season === 'string' ? value.season : '',
    rarityLabel: typeof value.rarityLabel === 'string' ? value.rarityLabel : undefined,
    reason,
    detail: typeof value.detail === 'string' ? value.detail : '',
  }
}

function hydratePlannedPass(value: unknown): PlannedPass | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.externalKey !== 'string') {
    return null
  }
  const sport =
    typeof value.sport === 'string' ? (value.sport as PlannedPass['sport']) : 'Other'
  const passKind = value.passKind === 'team' ? 'team' : 'player'
  const source =
    value.source === 'ranking' ? 'ranking' : value.source === 'manual' ? 'manual' : 'catalog'
  const progressRaw = typeof value.progress === 'string' ? value.progress : ''
  const progress: PlannedPass['progress'] =
    progressRaw === 'nearly-finished' ||
    progressRaw === 'on-the-way' ||
    progressRaw === 'just-started' ||
    progressRaw === 'future'
      ? progressRaw
      : 'just-started'
  return {
    id: value.id,
    externalKey: value.externalKey,
    name: typeof value.name === 'string' ? value.name : '',
    sport,
    season: typeof value.season === 'string' ? value.season : '',
    passKind,
    simulatedRarityLabel:
      typeof value.simulatedRarityLabel === 'string' && value.simulatedRarityLabel.trim()
        ? value.simulatedRarityLabel.trim()
        : 'Iconic 1',
    totalBaseRax: Number(value.totalBaseRax) || 0,
    rowCount: Number(value.rowCount) || 0,
    notes: typeof value.notes === 'string' ? value.notes : '',
    source,
    progress,
    addedAt: typeof value.addedAt === 'string' ? value.addedAt : new Date().toISOString(),
  }
}

function hydratePackTrackerAccount(value: unknown): PackTrackerAccount | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  const rating = Number(value.rating)
  const ownershipStatus =
    value.ownershipStatus === 'owned' ||
    value.ownershipStatus === 'missing' ||
    value.ownershipStatus === 'unknown'
      ? value.ownershipStatus
      : undefined
  return {
    id: value.id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Account',
    rating: Number.isFinite(rating) && rating > 0 ? Math.floor(rating) : 0,
    opensPacks: value.opensPacks !== false,
    username:
      typeof value.username === 'string' && value.username.trim()
        ? value.username.replace(/^@/, '').trim()
        : undefined,
    rarityLabel:
      typeof value.rarityLabel === 'string' && value.rarityLabel.trim()
        ? value.rarityLabel.trim()
        : undefined,
    lastImportedAt:
      typeof value.lastImportedAt === 'string' ? value.lastImportedAt : undefined,
    ownershipStatus,
    ignoredMissing: value.ignoredMissing === true ? true : undefined,
  }
}

function hydratePackAccountTemplate(value: unknown): PackAccountTemplate | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  return {
    id: value.id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Account',
    username:
      typeof value.username === 'string' && value.username.trim()
        ? value.username.replace(/^@/, '').trim()
        : '',
    opensPacks: value.opensPacks !== false,
  }
}

function hydratePackTracker(value: unknown): PackTracker | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.plannedPassId !== 'string') {
    return null
  }
  const now = new Date().toISOString()
  return {
    id: value.id,
    plannedPassId: value.plannedPassId,
    accounts: Array.isArray(value.accounts)
      ? value.accounts
          .map(hydratePackTrackerAccount)
          .filter((account): account is PackTrackerAccount => account !== null)
      : [],
    ratingPerPack: normalizeRatingPerPack(
      value.ratingPerPack === undefined || value.ratingPerPack === null
        ? undefined
        : Number(value.ratingPerPack),
    ),
    averagePlayRating: (() => {
      const n = Number(value.averagePlayRating)
      return Number.isFinite(n) ? n : undefined
    })(),
    playCount: (() => {
      const n = Number(value.playCount)
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
    })(),
    lastPlaysImportedAt:
      typeof value.lastPlaysImportedAt === 'string' ? value.lastPlaysImportedAt : undefined,
    lastAutoIncrementDay:
      typeof value.lastAutoIncrementDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.lastAutoIncrementDay)
        ? value.lastAutoIncrementDay
        : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  }
}

function hydrateSavedSellRankings(value: unknown): SavedSellRankings | null {
  if (!isRecord(value) || typeof value.calculatedAt !== 'string') return null
  return {
    calculatedAt: value.calculatedAt,
    skippedWithoutEarnings: Number(value.skippedWithoutEarnings) || 0,
    skippedTeamPasses: Number(value.skippedTeamPasses) || 0,
    skippedPlayerPasses: Array.isArray(value.skippedPlayerPasses)
      ? value.skippedPlayerPasses
          .map(hydrateSkippedSellRankPass)
          .filter((pass): pass is SavedSkippedSellRankPass => pass !== null)
      : [],
    rows: Array.isArray(value.rows)
      ? value.rows
          .map(hydrateSavedSellRankRow)
          .filter((row): row is SavedSellRankRow => row !== null)
      : [],
  }
}

export function normalizeData(value: unknown): RaxTrackerData {
  const fallback = createEmptyData()
  if (!isRecord(value)) return fallback

  const settingsRecord = isRecord(value.settings) ? value.settings : {}
  const cards = Array.isArray(value.cards)
    ? value.cards.map(hydrateCard).filter((card): card is PlayerCard => card !== null)
    : []
  const validCardIds = new Set(cards.map((card) => card.id))

  return {
    version: EXPORT_VERSION,
    settings: {
      proBonusEnabled:
        typeof settingsRecord.proBonusEnabled === 'boolean'
          ? settingsRecord.proBonusEnabled
          : fallback.settings.proBonusEnabled,
      savedUsername:
        typeof settingsRecord.savedUsername === 'string' ? settingsRecord.savedUsername : '',
      lastCloudSyncAt:
        typeof settingsRecord.lastCloudSyncAt === 'string'
          ? settingsRecord.lastCloudSyncAt
          : undefined,
      cloudSyncAuto:
        typeof settingsRecord.cloudSyncAuto === 'boolean'
          ? settingsRecord.cloudSyncAuto
          : undefined,
      importRarePasses:
        typeof settingsRecord.importRarePasses === 'boolean'
          ? settingsRecord.importRarePasses
          : typeof settingsRecord.importEpicAndRarePasses === 'boolean'
            ? settingsRecord.importEpicAndRarePasses
            : fallback.settings.importRarePasses,
      importEpicPasses:
        typeof settingsRecord.importEpicPasses === 'boolean'
          ? settingsRecord.importEpicPasses
          : typeof settingsRecord.importEpicAndRarePasses === 'boolean'
            ? settingsRecord.importEpicAndRarePasses
            : fallback.settings.importEpicPasses,
    },
    cards,
    performances: Array.isArray(value.performances)
      ? value.performances
          .map(hydratePerformance)
          .filter((performance): performance is RaxPerformance => performance !== null)
      : [],
    potentialCards: Array.isArray(value.potentialCards)
      ? value.potentialCards
          .map(hydratePotentialCard)
          .filter((card): card is SavedPotentialCard => card !== null)
      : [],
    savedCardProfiles: Array.isArray(value.savedCardProfiles)
      ? value.savedCardProfiles
          .map(hydrateSavedCardProfile)
          .filter((profile): profile is SavedCardProfile => profile !== null)
      : [],
    cachedPlayerEarnings: Array.isArray(value.cachedPlayerEarnings)
      ? value.cachedPlayerEarnings
          .map(hydrateCachedPlayerEarnings)
          .filter(
            (profile): profile is CachedPlayerEarningsProfile =>
              profile !== null && profile.cacheKey !== '' && profile.rows.length > 0,
          )
      : [],
    savedSellRankings: hydrateSavedSellRankings(value.savedSellRankings),
    plannedPasses: Array.isArray(value.plannedPasses)
      ? value.plannedPasses
          .map(hydratePlannedPass)
          .filter((pass): pass is PlannedPass => pass !== null)
      : [],
    planSoldCardIds: hydratePlanSoldCardIds(value.planSoldCardIds, validCardIds),
    sellExcludedCardIds: hydratePlanSoldCardIds(value.sellExcludedCardIds, validCardIds),
    packTrackers: Array.isArray(value.packTrackers)
      ? value.packTrackers
          .map(hydratePackTracker)
          .filter((tracker): tracker is PackTracker => tracker !== null)
      : [],
    packAccountTemplates: Array.isArray(value.packAccountTemplates)
      ? value.packAccountTemplates
          .map(hydratePackAccountTemplate)
          .filter((template): template is PackAccountTemplate => template !== null)
      : [],
    ignoredPassKeys: hydrateIgnoredPassKeys(value.ignoredPassKeys),
  }
}

export function loadTrackerData(): RaxTrackerData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createEmptyData()
    return normalizeData(JSON.parse(raw))
  } catch {
    return createEmptyData()
  }
}

export function saveTrackerData(data: RaxTrackerData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function exportTrackerData(data: RaxTrackerData): string {
  return JSON.stringify(
    {
      ...data,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  )
}

export function importTrackerData(json: string): RaxTrackerData {
  return normalizeData(JSON.parse(json))
}
