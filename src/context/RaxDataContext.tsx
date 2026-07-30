import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  buildSavedCardProfile,
  removeCardFromCollection,
  restoreSavedCardProfile,
  type RemoveCardFromCollectionOptions,
  upsertSavedCardProfile,
} from '../lib/cardProfile'
import { ignorePassOnImport, removeIgnoredPassKey } from '../lib/ignoredPasses'
import { toggleSellExcludedCardId } from '../lib/sellExcludedPasses'
import {
  createEmptyData,
  exportTrackerData,
  importTrackerData,
  normalizeData,
} from '../lib/storage'
import {
  loadPersistedTrackerData,
  persistTrackerData,
  storageWarningMessage,
} from '../lib/trackerPersistence'
import { loadAccountData, saveAccountData, AccountDataConflictError } from '../lib/accountData'
import { useAccountAuth } from './AccountAuthContext'
import {
  importFromUsername as runUsernameImport,
  retryFailedEarnings as runRetryFailedEarnings,
  type UsernameImportOptions,
  type UsernameImportResult,
} from '../lib/usernameImport'
import type { EarningsBackfillPass } from '../lib/realEarningsImport'
import { createId } from '../lib/id'
import { avatarByExternalKey, enrichCardsWithCatalogAvatars } from '../lib/realMedia'
import type { BulkSellRankResult } from '../lib/removeCardAnalysis'
import { buildSavedSellRankings } from '../lib/sellRankings'
import {
  importCatalogProfileIntoData,
  type CatalogProfileImportResult,
} from '../lib/catalogImport'
import { fetchCatalogAvatars, type CatalogImportProfile } from '../lib/catalogApi'
import { applyCardRarityChange } from '../lib/cardRarity'
import type {
  AppSettings,
  PackAccountTemplate,
  PackTracker,
  PackTrackerAccount,
  PlayerCard,
  PotentialRaxRow,
  RaxPerformance,
  RaxTrackerData,
  SavedPotentialCard,
  PlannedPass,
  Sport,
} from '../types/rax'
import type { CatalogSearchResult } from '../lib/catalogApi'
import { plannedPassFromCatalogResult, syncPlanProgressFromPackTrackers, type PlannedPassInput } from '../lib/plannedPasses'
import { RECOMMENDATION_SIMULATED_RARITY } from '../lib/passRecommendation'
import {
  accountsFromPackTemplates,
  applyPackTemplatesToAccounts,
  DEFAULT_PACK_RATING_INCREMENT,
  normalizePackUsername,
  normalizeRatingPerPack,
  removeFinishedPlannedPass,
} from '../lib/packTracker'

type CardInput = Pick<
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
type PerformanceInput = Pick<
  RaxPerformance,
  'cardId' | 'claimDay' | 'raxEarned' | 'baseRaxEarned' | 'note'
>
type PotentialCardInput = Pick<
  SavedPotentialCard,
  'name' | 'sport' | 'season' | 'notes' | 'rawJson' | 'simulatedRarityLabel'
> & {
  rows: PotentialRaxRow[]
}

type ImportFromUsernameOptions = UsernameImportOptions

type RaxDataContextValue = {
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

const RaxDataContext = createContext<RaxDataContextValue | null>(null)

function nowIso(): string {
  return new Date().toISOString()
}

export function RaxDataProvider({ children }: { children: ReactNode }) {
  const { username: accountUsername, devBypass: accountDevBypass } = useAccountAuth()
  const [data, setData] = useState<RaxTrackerData>(createEmptyData)
  const [storageReady, setStorageReady] = useState(false)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const accountUpdatedAtRef = useRef<string | undefined>(undefined)
  const skipNextAccountSaveRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    setStorageReady(false)

    const bootstrap = async () => {
      if (!accountDevBypass) {
        try {
          const loaded = await loadAccountData()
          if (cancelled) return
          accountUpdatedAtRef.current = loaded.meta.updatedAt
          skipNextAccountSaveRef.current = true
          setData(loaded.data)
          setStorageReady(true)
          void persistTrackerData(loaded.data)
          return
        } catch (error) {
          console.warn('Could not load account data; falling back to local storage.', error)
        }
      }

      const loaded = await loadPersistedTrackerData()
      if (cancelled) return
      skipNextAccountSaveRef.current = true
      setData(loaded.data)
      setStorageReady(true)
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [accountUsername, accountDevBypass])

  useEffect(() => {
    if (!storageReady) return
    const handle = window.setTimeout(() => {
      void persistTrackerData(data).then((result) => {
        const warning = storageWarningMessage(result)
        setStorageWarning(warning || null)
        if (!result.ok) {
          console.warn('Could not persist tracker data:', result)
        }
      })
    }, 250)
    return () => window.clearTimeout(handle)
  }, [data, storageReady])

  useEffect(() => {
    if (!storageReady || accountDevBypass) return
    if (skipNextAccountSaveRef.current) {
      skipNextAccountSaveRef.current = false
      return
    }

    const handle = window.setTimeout(() => {
      const save = async (ifUnmodifiedSince: string | undefined, allowRetry: boolean) => {
        try {
          const result = await saveAccountData(data, { ifUnmodifiedSince })
          accountUpdatedAtRef.current = result.meta.updatedAt
          setStorageWarning(null)
        } catch (error) {
          if (error instanceof AccountDataConflictError && allowRetry) {
            accountUpdatedAtRef.current = error.existingUpdatedAt
            await save(error.existingUpdatedAt, false)
            return
          }
          const message = error instanceof Error ? error.message : 'Could not save account data.'
          setStorageWarning(message)
          console.warn('Could not save account data:', error)
        }
      }
      void save(accountUpdatedAtRef.current, true)
    }, 800)

    return () => window.clearTimeout(handle)
  }, [data, storageReady, accountDevBypass])

  const missingAvatarKeysFingerprint = useMemo(() => {
    const keys = new Set<string>()
    for (const card of data.cards) {
      const key = card.externalKey?.trim()
      if (key && !card.avatar?.trim()) keys.add(key)
    }
    for (const pass of data.plannedPasses ?? []) {
      const key = pass.externalKey?.trim()
      if (key && !pass.avatar?.trim()) keys.add(key)
    }
    return [...keys].sort().join('\0')
  }, [data.cards, data.plannedPasses])

  useEffect(() => {
    if (!storageReady || !missingAvatarKeysFingerprint) return
    const keys = missingAvatarKeysFingerprint.split('\0')
    const controller = new AbortController()
    void fetchCatalogAvatars(keys, controller.signal)
      .then(({ avatars }) => {
        if (controller.signal.aborted || avatars.length === 0) return
        const map = avatarByExternalKey(avatars)
        if (map.size === 0) return
        setData((current) => {
          const cards = enrichCardsWithCatalogAvatars(current.cards, map)
          const plannedPasses = enrichCardsWithCatalogAvatars(current.plannedPasses ?? [], map)
          if (cards === current.cards && plannedPasses === (current.plannedPasses ?? [])) {
            return current
          }
          return { ...current, cards, plannedPasses }
        })
      })
      .catch(() => {
        /* catalog optional */
      })
    return () => controller.abort()
  }, [missingAvatarKeysFingerprint, storageReady])

  const value = useMemo<RaxDataContextValue>(
    () => ({
      data,
      storageReady,
      storageWarning,
      setSettings: (patch) => {
        setData((current) => ({
          ...current,
          settings: { ...current.settings, ...patch },
        }))
      },
      addCard: (input) => {
        const id = createId('card')
        setData((current) => ({
          ...current,
          cards: [
            ...current.cards,
            {
              id,
              name: input.name.trim(),
              sport: input.sport as Sport,
              season: input.season.trim(),
              notes: input.notes.trim(),
              rarityLabel: input.rarityLabel?.trim() || undefined,
              passKind: input.passKind,
              avatar: input.avatar?.trim() || undefined,
              simulatedRarityLabel: input.simulatedRarityLabel,
              createdAt: nowIso(),
            },
          ],
        }))
        return id
      },
      upsertCard: (externalKey, input) => {
        let cardId = ''
        setData((current) => {
          const existing = current.cards.find((card) => card.externalKey === externalKey)
          if (existing) {
            cardId = existing.id
            return {
              ...current,
              cards: current.cards.map((card) =>
                card.id === existing.id
                  ? {
                      ...card,
                      name: input.name.trim() || card.name,
                      sport: input.sport as Sport,
                      season: input.season.trim() || card.season,
                      notes: input.notes.trim() || card.notes,
                    }
                  : card,
              ),
            }
          }
          cardId = createId('card')
          return {
            ...current,
            cards: [
              ...current.cards,
              {
                id: cardId,
                name: input.name.trim(),
                sport: input.sport as Sport,
                season: input.season.trim(),
                notes: input.notes.trim(),
                externalKey,
                createdAt: nowIso(),
              },
            ],
          }
        })
        return cardId
      },
      updateCard: (id, patch) => {
        setData((current) => ({
          ...current,
          cards: current.cards.map((card) =>
            card.id === id
              ? {
                  ...card,
                  ...patch,
                  name: patch.name !== undefined ? patch.name : card.name,
                  season: patch.season !== undefined ? patch.season : card.season,
                  notes: patch.notes !== undefined ? patch.notes : card.notes,
                }
              : card,
          ),
        }))
      },
      setCardRarity: (id, targetRarity) => {
        setData((current) => applyCardRarityChange(current, id, targetRarity) ?? current)
      },
      deleteCard: (id) => {
        setData((current) => removeCardFromCollection(current, id) ?? current)
      },
      removeCardFromCollection: (id, options) => {
        let removed = false
        setData((current) => {
          const next = removeCardFromCollection(current, id, options)
          if (!next) return current
          removed = true
          return next
        })
        return removed
      },
      ignorePassOnImport: (id) => {
        let ignored = false
        setData((current) => {
          const next = ignorePassOnImport(current, id)
          if (!next) return current
          ignored = true
          return next
        })
        return ignored
      },
      unignorePassKey: (externalKey) => {
        setData((current) => removeIgnoredPassKey(current, externalKey))
      },
      addPerformance: (input) => {
        setData((current) => ({
          ...current,
          performances: [
            ...current.performances,
            {
              id: createId('perf'),
              cardId: input.cardId,
              claimDay: input.claimDay,
              raxEarned: input.raxEarned,
              baseRaxEarned: input.baseRaxEarned,
              note: input.note.trim(),
              createdAt: nowIso(),
            },
          ],
        }))
      },
      addPerformances: (inputs) => {
        if (inputs.length === 0) return
        const createdAt = nowIso()
        setData((current) => ({
          ...current,
          performances: [
            ...current.performances,
            ...inputs.map((input) => ({
              id: createId('perf'),
              cardId: input.cardId,
              claimDay: input.claimDay,
              raxEarned: input.raxEarned,
              baseRaxEarned: input.baseRaxEarned,
              note: input.note.trim(),
              createdAt,
            })),
          ],
        }))
      },
      updatePerformance: (id, patch) => {
        setData((current) => ({
          ...current,
          performances: current.performances.map((performance) =>
            performance.id === id ? { ...performance, ...patch } : performance,
          ),
        }))
      },
      deletePerformance: (id) => {
        setData((current) => ({
          ...current,
          performances: current.performances.filter((performance) => performance.id !== id),
        }))
      },
      addPotentialCard: (input) => {
        const id = createId('potential')
        const timestamp = nowIso()
        setData((current) => ({
          ...current,
          potentialCards: [
            ...current.potentialCards,
            {
              id,
              name: input.name.trim() || 'Potential card',
              sport: input.sport,
              season: input.season.trim(),
              notes: input.notes.trim(),
              rawJson: input.rawJson,
              simulatedRarityLabel: input.simulatedRarityLabel?.trim() || undefined,
              rows: input.rows,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        }))
        return id
      },
      updatePotentialCard: (id, input) => {
        setData((current) => ({
          ...current,
          potentialCards: current.potentialCards.map((card) =>
            card.id === id
              ? {
                  ...card,
                  name: input.name.trim() || card.name,
                  sport: input.sport,
                  season: input.season.trim(),
                  notes: input.notes.trim(),
                  rawJson: input.rawJson,
                  simulatedRarityLabel: input.simulatedRarityLabel?.trim() || undefined,
                  rows: input.rows,
                  updatedAt: nowIso(),
                }
              : card,
          ),
        }))
      },
      deletePotentialCard: (id) => {
        setData((current) => ({
          ...current,
          potentialCards: current.potentialCards.filter((card) => card.id !== id),
        }))
      },
      addPlannedPass: (input) => {
        const externalKey = input.externalKey.trim()
        if (!externalKey) return null
        let createdId: string | null = null
        setData((current) => {
          if ((current.plannedPasses ?? []).some((pass) => pass.externalKey === externalKey)) {
            return current
          }
          const id = createId('plan')
          createdId = id
          return {
            ...current,
            plannedPasses: [
              ...(current.plannedPasses ?? []),
              {
                id,
                externalKey,
                name: input.name.trim() || 'Planned pass',
                sport: input.sport,
                season: input.season.trim(),
                passKind: input.passKind,
                simulatedRarityLabel:
                  input.simulatedRarityLabel?.trim() || RECOMMENDATION_SIMULATED_RARITY,
                totalBaseRax: input.totalBaseRax ?? 0,
                rowCount: input.rowCount ?? 0,
                notes: input.notes?.trim() ?? '',
                source: input.source ?? 'catalog',
                progress: input.progress ?? 'just-started',
                avatar: input.avatar?.trim() || undefined,
                addedAt: nowIso(),
              },
            ],
          }
        })
        return createdId
      },
      removePlannedPass: (id) => {
        setData((current) => {
          const cleaned = removeFinishedPlannedPass(
            current.plannedPasses ?? [],
            current.packTrackers ?? [],
            id,
          )
          return syncPlanProgressFromPackTrackers({
            ...current,
            plannedPasses: cleaned.plannedPasses,
            packTrackers: cleaned.packTrackers,
          })
        })
      },
      updatePlannedPass: (id, patch) => {
        setData((current) => ({
          ...current,
          plannedPasses: (current.plannedPasses ?? []).map((pass) =>
            pass.id === id
              ? {
                  ...pass,
                  ...patch,
                  name: patch.name !== undefined ? patch.name.trim() || pass.name : pass.name,
                  season: patch.season !== undefined ? patch.season.trim() : pass.season,
                  notes: patch.notes !== undefined ? patch.notes.trim() : pass.notes,
                  simulatedRarityLabel:
                    patch.simulatedRarityLabel !== undefined
                      ? patch.simulatedRarityLabel.trim() || RECOMMENDATION_SIMULATED_RARITY
                      : pass.simulatedRarityLabel,
                  progress: patch.progress !== undefined ? patch.progress : pass.progress,
                }
              : pass,
          ),
        }))
      },
      addPlannedPassFromCatalog: (result, simulatedRarityLabel, source) => {
        const input = plannedPassFromCatalogResult(
          result,
          simulatedRarityLabel ?? RECOMMENDATION_SIMULATED_RARITY,
          source ?? 'catalog',
        )
        let createdId: string | null = null
        setData((current) => {
          if ((current.plannedPasses ?? []).some((pass) => pass.externalKey === result.externalKey)) {
            return current
          }
          const id = createId('plan')
          createdId = id
          return {
            ...current,
            plannedPasses: [
              ...(current.plannedPasses ?? []),
              {
                id,
                ...input,
                name: input.name.trim() || 'Planned pass',
                season: input.season.trim(),
                notes: input.notes.trim(),
                progress: input.progress ?? 'just-started',
                addedAt: nowIso(),
              },
            ],
          }
        })
        return createdId
      },
      setPlanSoldCardIds: (ids) => {
        setData((current) => {
          const validIds = new Set(current.cards.map((card) => card.id))
          const next = [
            ...new Set(ids.filter((id) => typeof id === 'string' && validIds.has(id))),
          ]
          const prev = current.planSoldCardIds ?? []
          if (
            next.length === prev.length &&
            next.every((id, index) => id === prev[index])
          ) {
            return current
          }
          return { ...current, planSoldCardIds: next }
        })
      },
      togglePlanSoldCard: (cardId) => {
        setData((current) => {
          if (!current.cards.some((card) => card.id === cardId)) return current
          const prev = current.planSoldCardIds ?? []
          const planSoldCardIds = prev.includes(cardId)
            ? prev.filter((id) => id !== cardId)
            : [...prev, cardId]
          return { ...current, planSoldCardIds }
        })
      },
      clearPlanSoldCardIds: () => {
        setData((current) =>
          (current.planSoldCardIds ?? []).length === 0
            ? current
            : { ...current, planSoldCardIds: [] },
        )
      },
      toggleSellExcludedCard: (cardId) => {
        setData((current) => toggleSellExcludedCardId(current, cardId))
      },
      upsertPackTracker: (plannedPassId) => {
        let trackerId = ''
        setData((current) => {
          const existing = (current.packTrackers ?? []).find(
            (tracker) => tracker.plannedPassId === plannedPassId,
          )
          if (existing) {
            trackerId = existing.id
            return current
          }
          const pass = (current.plannedPasses ?? []).find((item) => item.id === plannedPassId)
          if (!pass) return current
          const id = createId('pack')
          trackerId = id
          const stamp = nowIso()
          const templates = current.packAccountTemplates ?? []
          const seeded = accountsFromPackTemplates(templates, createId)
          const accounts =
            seeded.length > 0
              ? seeded
              : [
                  {
                    id: createId('pacc'),
                    name: 'Account 1',
                    rating: 0,
                    opensPacks: true,
                  },
                ]
          return syncPlanProgressFromPackTrackers({
            ...current,
            packTrackers: [
              ...(current.packTrackers ?? []),
              {
                id,
                plannedPassId,
                accounts,
                ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
                createdAt: stamp,
                updatedAt: stamp,
              },
            ],
          })
        })
        return trackerId
      },
      trackAllUntrackedPlayerPacks: () => {
        let tracked = 0
        setData((current) => {
          const existingPassIds = new Set(
            (current.packTrackers ?? []).map((tracker) => tracker.plannedPassId),
          )
          const templates = current.packAccountTemplates ?? []
          const stamp = nowIso()
          const additions: PackTracker[] = []
          for (const pass of current.plannedPasses ?? []) {
            if (pass.passKind === 'team') continue
            if (existingPassIds.has(pass.id)) continue
            const seeded = accountsFromPackTemplates(templates, createId)
            const accounts =
              seeded.length > 0
                ? seeded
                : [
                    {
                      id: createId('pacc'),
                      name: 'Account 1',
                      rating: 0,
                      opensPacks: true,
                    },
                  ]
            additions.push({
              id: createId('pack'),
              plannedPassId: pass.id,
              accounts,
              ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
              createdAt: stamp,
              updatedAt: stamp,
            })
          }
          tracked = additions.length
          if (additions.length === 0) return current
          return syncPlanProgressFromPackTrackers({
            ...current,
            packTrackers: [...(current.packTrackers ?? []), ...additions],
          })
        })
        return { tracked }
      },
      updatePackTracker: (id, patch) => {
        setData((current) =>
          syncPlanProgressFromPackTrackers({
            ...current,
            packTrackers: (current.packTrackers ?? []).map((tracker) => {
              if (tracker.id !== id) return tracker
              const averagePlayRating = Number(patch.averagePlayRating)
              const playCount = Number(patch.playCount)
              const dailySwaps = Number(patch.dailySwaps)
              return {
                ...tracker,
                ratingPerPack:
                  patch.ratingPerPack !== undefined
                    ? normalizeRatingPerPack(patch.ratingPerPack)
                    : tracker.ratingPerPack,
                dailySwaps:
                  'dailySwaps' in patch
                    ? Number.isFinite(dailySwaps) && dailySwaps > 0
                      ? Math.floor(dailySwaps)
                      : undefined
                    : tracker.dailySwaps,
                averagePlayRating:
                  patch.averagePlayRating !== undefined
                    ? Number.isFinite(averagePlayRating)
                      ? averagePlayRating
                      : undefined
                    : tracker.averagePlayRating,
                playCount:
                  patch.playCount !== undefined
                    ? Number.isFinite(playCount) && playCount >= 0
                      ? Math.floor(playCount)
                      : undefined
                    : tracker.playCount,
                lastPlaysImportedAt:
                  patch.lastPlaysImportedAt !== undefined
                    ? patch.lastPlaysImportedAt
                    : tracker.lastPlaysImportedAt,
                accounts: patch.accounts !== undefined ? patch.accounts : tracker.accounts,
                updatedAt: nowIso(),
              }
            }),
          }),
        )
      },
      addPackTrackerAccount: (trackerId, input) => {
        let accountId: string | null = null
        setData((current) =>
          syncPlanProgressFromPackTrackers({
            ...current,
            packTrackers: (current.packTrackers ?? []).map((tracker) => {
              if (tracker.id !== trackerId) return tracker
              const id = createId('pacc')
              accountId = id
              const rating = Number(input?.rating)
              const username = normalizePackUsername(input?.username)
              return {
                ...tracker,
                accounts: [
                  ...tracker.accounts,
                  {
                    id,
                    name:
                      typeof input?.name === 'string' && input.name.trim()
                        ? input.name.trim()
                        : `Account ${tracker.accounts.length + 1}`,
                    rating: Number.isFinite(rating) && rating > 0 ? Math.floor(rating) : 0,
                    opensPacks: input?.opensPacks !== false,
                    username: username || undefined,
                  },
                ],
                updatedAt: nowIso(),
              }
            }),
          }),
        )
        return accountId
      },
      updatePackTrackerAccount: (trackerId, accountId, patch) => {
        setData((current) =>
          syncPlanProgressFromPackTrackers({
            ...current,
            packTrackers: (current.packTrackers ?? []).map((tracker) => {
              if (tracker.id !== trackerId) return tracker
              return {
                ...tracker,
                accounts: tracker.accounts.map((account) => {
                  if (account.id !== accountId) return account
                  const rating =
                    patch.rating !== undefined ? Number(patch.rating) : account.rating
                  return {
                    ...account,
                    name:
                      patch.name !== undefined
                        ? patch.name.trim() || account.name
                        : account.name,
                    rating:
                      patch.rating !== undefined
                        ? Number.isFinite(rating) && rating > 0
                          ? Math.floor(rating)
                          : 0
                        : account.rating,
                    opensPacks:
                      patch.opensPacks !== undefined ? patch.opensPacks : account.opensPacks,
                    username:
                      patch.username !== undefined
                        ? patch.username.replace(/^@/, '').trim() || undefined
                        : account.username,
                    rarityLabel:
                      patch.rarityLabel !== undefined
                        ? patch.rarityLabel.trim() || undefined
                        : account.rarityLabel,
                    lastImportedAt:
                      patch.lastImportedAt !== undefined
                        ? patch.lastImportedAt
                        : account.lastImportedAt,
                    ownershipStatus:
                      patch.ownershipStatus !== undefined
                        ? patch.ownershipStatus
                        : account.ownershipStatus,
                    ignoredMissing:
                      patch.ignoredMissing !== undefined
                        ? patch.ignoredMissing || undefined
                        : account.ignoredMissing,
                  }
                }),
                updatedAt: nowIso(),
              }
            }),
          }),
        )
      },
      applyPackRatingsFromImport: (username, ratingsByExternalKey, options) => {
        const normalizedUser = username.replace(/^@/, '').trim().toLowerCase()
        const displayUser = username.replace(/^@/, '').trim()
        const stamp = nowIso()
        let updatedAccounts = 0
        let missingPasses = 0

        setData((current) => {
          updatedAccounts = 0
          missingPasses = 0
          const plannedById = new Map(
            (current.plannedPasses ?? []).map((pass) => [pass.id, pass]),
          )

          const nextTrackers = (current.packTrackers ?? []).map((tracker) => {
            if (options?.plannedPassId && tracker.plannedPassId !== options.plannedPassId) {
              return tracker
            }

            const pass = plannedById.get(tracker.plannedPassId)
            if (!pass) return tracker

            const imported = ratingsByExternalKey[pass.externalKey]
            let accounts = [...tracker.accounts]

            const matchingAccounts = accounts.filter((account) => {
              if (options?.accountId) return account.id === options.accountId
              const accountUser = (account.username || account.name)
                .replace(/^@/, '')
                .trim()
                .toLowerCase()
              return accountUser === normalizedUser
            })

            if (matchingAccounts.length === 0) {
              if (!options?.ensureAccounts || !imported || options?.accountId) {
                return tracker
              }
              accounts = [
                ...accounts,
                {
                  id: createId('pacc'),
                  name: displayUser || 'Account',
                  username: displayUser || undefined,
                  rating: imported.rating,
                  opensPacks: true,
                  rarityLabel: imported.rarityLabel,
                  lastImportedAt: stamp,
                  ownershipStatus: 'owned',
                  ignoredMissing: undefined,
                },
              ]
              updatedAccounts += 1
              return { ...tracker, accounts, updatedAt: stamp }
            }

            const targetIds = new Set(matchingAccounts.map((account) => account.id))

            if (!imported) {
              missingPasses += matchingAccounts.length
              return {
                ...tracker,
                accounts: accounts.map((account) => {
                  if (!targetIds.has(account.id)) return account
                  return {
                    ...account,
                    ownershipStatus: 'missing' as const,
                  }
                }),
                updatedAt: stamp,
              }
            }

            return {
              ...tracker,
              accounts: accounts.map((account) => {
                if (!targetIds.has(account.id)) return account
                updatedAccounts += 1
                return {
                  ...account,
                  username: displayUser || account.username,
                  name:
                    !account.name.trim() ||
                    /^account\s*\d*$/i.test(account.name.trim())
                      ? displayUser || account.name
                      : account.name,
                  rating: imported.rating,
                  rarityLabel: imported.rarityLabel ?? account.rarityLabel,
                  lastImportedAt: stamp,
                  ownershipStatus: 'owned' as const,
                  ignoredMissing: undefined,
                }
              }),
              updatedAt: stamp,
            }
          })

          return syncPlanProgressFromPackTrackers({ ...current, packTrackers: nextTrackers })
        })

        return { updatedAccounts, missingPasses }
      },
      removePackTrackerAccount: (trackerId, accountId) => {
        setData((current) =>
          syncPlanProgressFromPackTrackers({
            ...current,
            packTrackers: (current.packTrackers ?? []).map((tracker) =>
              tracker.id === trackerId
                ? {
                    ...tracker,
                    accounts: tracker.accounts.filter((account) => account.id !== accountId),
                    updatedAt: nowIso(),
                  }
                : tracker,
            ),
          }),
        )
      },
      addPackAccountTemplate: (input) => {
        const id = createId('ptpl')
        setData((current) => {
          const templates = current.packAccountTemplates ?? []
          const username = normalizePackUsername(input?.username)
          return {
            ...current,
            packAccountTemplates: [
              ...templates,
              {
                id,
                name:
                  typeof input?.name === 'string' && input.name.trim()
                    ? input.name.trim()
                    : `Account ${templates.length + 1}`,
                username,
                opensPacks: input?.opensPacks !== false,
              },
            ],
          }
        })
        return id
      },
      updatePackAccountTemplate: (id, patch) => {
        setData((current) => ({
          ...current,
          packAccountTemplates: (current.packAccountTemplates ?? []).map((template) => {
            if (template.id !== id) return template
            return {
              ...template,
              name:
                patch.name !== undefined
                  ? patch.name.trim() || template.name
                  : template.name,
              username:
                patch.username !== undefined
                  ? normalizePackUsername(patch.username)
                  : template.username,
              opensPacks:
                patch.opensPacks !== undefined ? patch.opensPacks : template.opensPacks,
            }
          }),
        }))
      },
      removePackAccountTemplate: (id) => {
        setData((current) => ({
          ...current,
          packAccountTemplates: (current.packAccountTemplates ?? []).filter(
            (template) => template.id !== id,
          ),
        }))
      },
      applyPackAccountTemplatesToTracked: () => {
        let trackersTouched = 0
        let accountsAdded = 0
        let accountsUpdated = 0
        let accountsRemoved = 0
        setData((current) => {
          trackersTouched = 0
          accountsAdded = 0
          accountsUpdated = 0
          accountsRemoved = 0
          const templates = current.packAccountTemplates ?? []
          if (templates.length === 0) return current

          const playerPassIds = new Set(
            (current.plannedPasses ?? [])
              .filter((pass) => pass.passKind !== 'team')
              .map((pass) => pass.id),
          )
          const stamp = nowIso()
          let changed = false

          const packTrackers = (current.packTrackers ?? []).map((tracker) => {
            if (!playerPassIds.has(tracker.plannedPassId)) return tracker
            const applied = applyPackTemplatesToAccounts(tracker.accounts, templates, createId)
            if (applied.added === 0 && applied.updated === 0 && applied.removed === 0) {
              return tracker
            }
            trackersTouched += 1
            accountsAdded += applied.added
            accountsUpdated += applied.updated
            accountsRemoved += applied.removed
            changed = true
            return {
              ...tracker,
              accounts: applied.accounts,
              updatedAt: stamp,
            }
          })

          return changed
            ? syncPlanProgressFromPackTrackers({ ...current, packTrackers })
            : current
        })
        return { trackersTouched, accountsAdded, accountsUpdated, accountsRemoved }
      },
      saveCardProfile: (cardId, rawJson) => {
        setData((current) => {
          const card = current.cards.find((item) => item.id === cardId)
          if (!card) return current
          const performances = current.performances.filter(
            (performance) => performance.cardId === cardId,
          )
          if (performances.length === 0) return current
          const profile = buildSavedCardProfile({ card, performances, rawJson })
          return upsertSavedCardProfile(current, profile)
        })
      },
      restoreCardProfile: (profileId) => {
        const restored = restoreSavedCardProfile(data, profileId)
        if (!restored) return null
        setData(restored.data)
        return { cardId: restored.cardId, rowsRestored: restored.rowsRestored }
      },
      deleteCardProfile: (profileId) => {
        setData((current) => ({
          ...current,
          savedCardProfiles: current.savedCardProfiles.filter((profile) => profile.id !== profileId),
        }))
      },
      saveSellRankings: (result) => {
        setData((current) => ({
          ...current,
          savedSellRankings: buildSavedSellRankings(result, nowIso()),
        }))
      },
      clearSellRankings: () => {
        setData((current) => ({
          ...current,
          savedSellRankings: null,
        }))
      },
      exportJson: () => exportTrackerData(data),
      importJson: (json) => setData(importTrackerData(json)),
      replaceData: (next) => setData(normalizeData(next)),
      importFromUsername: async (username, options) => {
        const { data: nextData, result } = await runUsernameImport(data, username, options)
        const trimmed = username.replace(/^@/, '').trim()
        setData({
          ...nextData,
          settings: { ...nextData.settings, savedUsername: trimmed },
        })
        return result
      },
      retryFailedEarnings: async (passes, options) => {
        const { data: nextData, result } = await runRetryFailedEarnings(data, passes, options)
        setData(nextData)
        return result
      },
      importCatalogProfile: (profile) => {
        let result: CatalogProfileImportResult | null = null
        setData((current) => {
          const imported = importCatalogProfileIntoData(current, profile, {
            nowIso: nowIso(),
            createId,
          })
          result = imported.result
          return imported.data
        })
        return (
          result ?? {
            cardId: '',
            cardCreated: false,
            rowsImported: 0,
            rowsUpdated: 0,
          }
        )
      },
      enrichAvatarsFromCatalog: (items) => {
        setData((current) => {
          const map = avatarByExternalKey(items)
          if (map.size === 0) return current
          const cards = enrichCardsWithCatalogAvatars(current.cards, map)
          const plannedPasses = enrichCardsWithCatalogAvatars(current.plannedPasses ?? [], map)
          if (cards === current.cards && plannedPasses === (current.plannedPasses ?? [])) {
            return current
          }
          return { ...current, cards, plannedPasses }
        })
      },
      resetAll: () => setData(createEmptyData()),
    }),
    [data, storageReady, storageWarning],
  )

  return <RaxDataContext.Provider value={value}>{children}</RaxDataContext.Provider>
}

export function useRaxData(): RaxDataContextValue {
  const value = useContext(RaxDataContext)
  if (!value) throw new Error('useRaxData must be used inside RaxDataProvider')
  return value
}

export type { UsernameImportResult }
export type { UsernameImportProgress } from '../lib/usernameImport'
