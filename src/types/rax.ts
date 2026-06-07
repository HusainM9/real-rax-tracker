export const SPORTS = [
  'NBA',
  'WNBA',
  'NFL',
  'CFB',
  'MLB',
  'NHL',
  'CBB',
  'Golf',
  'FC',
  'UFC',
  'Other',
] as const

export type Sport = (typeof SPORTS)[number]

export type PlayerCard = {
  id: string
  name: string
  sport: Sport
  season: string
  notes: string
  externalKey?: string
  rarityLabel?: string
  passKind?: 'player' | 'team'
  simulatedRarityLabel?: string
  createdAt: string
}

export type RaxPerformance = {
  id: string
  cardId: string
  claimDay: string
  raxEarned: number
  baseRaxEarned?: number
  note: string
  createdAt: string
}

export type PotentialRaxRow = {
  claimDay: string
  raxEarned: number
  note: string
}

export type SavedPotentialCard = {
  id: string
  name: string
  sport: Sport
  season: string
  notes: string
  rawJson: string
  rows: PotentialRaxRow[]
  simulatedRarityLabel?: string
  createdAt: string
  updatedAt: string
}

export type SavedCardEarningsRow = {
  claimDay: string
  raxEarned: number
  baseRaxEarned?: number
  note: string
}

export type SavedCardProfile = {
  id: string
  externalKey?: string
  name: string
  sport: Sport
  season: string
  notes: string
  rarityLabel?: string
  passKind?: 'player' | 'team'
  rawJson: string
  rows: SavedCardEarningsRow[]
  createdAt: string
  updatedAt: string
}

export type CachedPlayerEarningsProfile = {
  cacheKey: string
  entityId: number
  sport: Sport
  season: string
  seasonYear: number
  passKind: 'player' | 'team'
  name: string
  rarityLabel?: string
  externalKey: string
  rows: SavedCardEarningsRow[]
  source: 'username_import' | 'manual'
  updatedAt: string
}

export type SavedSellRankRow = {
  cardId: string
  name: string
  sport: Sport
  season: string
  rarityLabel?: string
  claimableNow: number
  lostClaimableRax: number
  freedClaimableRax: number
  netClaimableDelta: number
}

export type SavedSkippedSellRankPass = {
  cardId: string
  name: string
  sport: Sport
  season: string
  rarityLabel?: string
  reason: 'no_earnings' | 'analysis_failed'
  detail: string
}

export type SavedSellRankings = {
  calculatedAt: string
  skippedWithoutEarnings: number
  skippedTeamPasses: number
  skippedPlayerPasses: SavedSkippedSellRankPass[]
  rows: SavedSellRankRow[]
}

export type AppSettings = {
  proBonusEnabled: boolean
  savedUsername: string
}

export type RaxTrackerData = {
  version: number
  settings: AppSettings
  cards: PlayerCard[]
  performances: RaxPerformance[]
  potentialCards: SavedPotentialCard[]
  savedCardProfiles: SavedCardProfile[]
  cachedPlayerEarnings?: CachedPlayerEarningsProfile[]
  savedSellRankings?: SavedSellRankings | null
}

export type ClaimStatus = 'guaranteed' | 'pro-bonus' | 'overlap'

export type ClaimCandidate = {
  performance: RaxPerformance
  card: PlayerCard
  status: ClaimStatus
  rankInSport: number
}

export type SportClaimResult = {
  sport: Sport
  guaranteed: ClaimCandidate[]
  overlaps: ClaimCandidate[]
  totalGuaranteedRax: number
  totalOverlapRax: number
}

export type ClaimDayResult = {
  claimDay: string
  sports: SportClaimResult[]
  proBonus: ClaimCandidate | null
  totalGuaranteedRax: number
  totalProBonusRax: number
  totalClaimableRax: number
  totalOverlapRax: number
}

export type CardRollup = {
  card: PlayerCard
  totalBaseRax: number
  guaranteedRax: number
  proBonusRax: number
  overlapRax: number
  totalClaimableRax: number
  guaranteedClaims: number
  proBonusClaims: number
  overlapCount: number
  performanceCount: number
}

export type SportRollup = {
  sport: Sport
  guaranteedRax: number
  proBonusRax: number
  overlapRax: number
  totalClaimableRax: number
  guaranteedClaims: number
  proBonusClaims: number
  overlapCount: number
}

export type YearRollup = {
  totalGuaranteedRax: number
  totalProBonusRax: number
  totalClaimableRax: number
  totalOverlapRax: number
  claimDays: number
  cards: CardRollup[]
  sports: SportRollup[]
}
