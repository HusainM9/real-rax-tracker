import type { RemoveCardFromCollectionOptions } from '../lib/cardProfile'
import type { CatalogImportProfile, CatalogSearchResult } from '../lib/catalogApi'
import type { CatalogProfileImportResult } from '../lib/catalogImport'
import type { EarningsBackfillPass } from '../lib/realEarningsImport'
import type { BulkSellRankResult } from '../lib/removeCardAnalysis'
import type { PlannedPassInput } from '../lib/plannedPasses'
import type { UsernameImportOptions, UsernameImportResult } from '../lib/usernameImport'
import type {
  AppSettings,
  PackAccountTemplate,
  PackTracker,
  PackTrackerAccount,
  PlannedPass,
  PlayerCard,
  PotentialRaxRow,
  RaxPerformance,
  RaxTrackerData,
  SavedPotentialCard,
} from '../types/rax'

export type CardInput = Pick<
  PlayerCard,
  | 'name'
  | 'sport'
  | 'season'
  | 'notes'
  | 'rarityLabel'
  | 'passKind'
  | 'simulatedRarityLabel'
  | 'avatar'
>
export type PerformanceInput = Pick<
  RaxPerformance,
  'cardId' | 'claimDay' | 'raxEarned' | 'baseRaxEarned' | 'note'
>
export type PotentialCardInput = Pick<
  SavedPotentialCard,
  'name' | 'sport' | 'season' | 'notes' | 'rawJson' | 'simulatedRarityLabel'
> & {
  rows: PotentialRaxRow[]
}
export type ImportFromUsernameOptions = UsernameImportOptions

export type RaxDataContextValue = {
  data: RaxTrackerData
  storageReady: boolean
  storageWarning: string | null
  setSettings: (patch: Partial<AppSettings>) => void
  addCard: (input: CardInput) => string
  upsertCard: (externalKey: string, input: CardInput) => string
  updateCard: (id: string, patch: Partial<CardInput>) => void
  setCardRarity: (id: string, targetRarity: string) => void
  deleteCard: (id: string) => void
  removeCardFromCollection: (id: string, options?: RemoveCardFromCollectionOptions) => boolean
  ignorePassOnImport: (id: string) => boolean
  unignorePassKey: (externalKey: string) => void
  addPerformance: (input: PerformanceInput) => void
  addPerformances: (inputs: PerformanceInput[]) => void
  updatePerformance: (id: string, patch: Partial<PerformanceInput>) => void
  deletePerformance: (id: string) => void
  addPotentialCard: (input: PotentialCardInput) => string
  updatePotentialCard: (id: string, input: PotentialCardInput) => void
  deletePotentialCard: (id: string) => void
  addPlannedPass: (input: PlannedPassInput) => string | null
  removePlannedPass: (id: string) => void
  updatePlannedPass: (id: string, patch: Partial<PlannedPassInput>) => void
  addPlannedPassFromCatalog: (
    result: CatalogSearchResult,
    simulatedRarityLabel?: string,
    source?: PlannedPass['source'],
  ) => string | null
  setPlanSoldCardIds: (ids: string[]) => void
  togglePlanSoldCard: (cardId: string) => void
  clearPlanSoldCardIds: () => void
  toggleSellExcludedCard: (cardId: string) => void
  upsertPackTracker: (plannedPassId: string) => string
  /** Start tracking every untracked planned player pass (same seeding as upsertPackTracker). */
  trackAllUntrackedPlayerPacks: () => { tracked: number }
  updatePackTracker: (
    id: string,
    patch: Partial<
      Pick<
        PackTracker,
        | 'accounts'
        | 'ratingPerPack'
        | 'dailySwaps'
        | 'weeklyPacksOnly'
        | 'weeklyExtraAccounts'
        | 'weeklyPackOpens'
        | 'averagePlayRating'
        | 'playCount'
        | 'lastPlaysImportedAt'
      >
    >,
  ) => void
  addPackTrackerAccount: (trackerId: string, input?: Partial<PackTrackerAccount>) => string | null
  updatePackTrackerAccount: (
    trackerId: string,
    accountId: string,
    patch: Partial<
      Pick<
        PackTrackerAccount,
        | 'name'
        | 'rating'
        | 'opensPacks'
        | 'username'
        | 'rarityLabel'
        | 'lastImportedAt'
        | 'ownershipStatus'
        | 'ignoredMissing'
      >
    >,
  ) => void
  applyPackRatingsFromImport: (
    username: string,
    ratingsByExternalKey: Record<string, { rating: number; rarityLabel?: string }>,
    options?: { plannedPassId?: string; accountId?: string; ensureAccounts?: boolean },
  ) => { updatedAccounts: number; missingPasses: number }
  removePackTrackerAccount: (trackerId: string, accountId: string) => void
  addPackAccountTemplate: (input?: Partial<PackAccountTemplate>) => string
  updatePackAccountTemplate: (
    id: string,
    patch: Partial<Pick<PackAccountTemplate, 'name' | 'username' | 'opensPacks'>>,
  ) => void
  removePackAccountTemplate: (id: string) => void
  applyPackAccountTemplatesToTracked: () => {
    trackersTouched: number
    accountsAdded: number
    accountsUpdated: number
    accountsRemoved: number
  }
  saveCardProfile: (cardId: string, rawJson?: string) => void
  restoreCardProfile: (profileId: string) => { cardId: string; rowsRestored: number } | null
  deleteCardProfile: (profileId: string) => void
  saveSellRankings: (result: BulkSellRankResult) => void
  clearSellRankings: () => void
  exportJson: () => string
  importJson: (json: string) => void
  replaceData: (next: RaxTrackerData) => void
  importFromUsername: (
    username: string,
    options?: ImportFromUsernameOptions,
  ) => Promise<UsernameImportResult>
  retryFailedEarnings: (
    passes: EarningsBackfillPass[],
    options?: ImportFromUsernameOptions,
  ) => Promise<UsernameImportResult>
  importCatalogProfile: (profile: CatalogImportProfile) => CatalogProfileImportResult
  /** Backfill missing card/planned-pass avatars from catalog rows (by externalKey). */
  enrichAvatarsFromCatalog: (
    items: Array<{ externalKey: string; avatar?: string | null }>,
  ) => void
  resetAll: () => void
}
