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
import { loadAccountData, saveAccountData } from '../lib/accountData'
import { useAccountAuth } from './AccountAuthContext'
import {
  importFromUsername as runUsernameImport,
  retryFailedEarnings as runRetryFailedEarnings,
  type UsernameImportOptions,
  type UsernameImportResult,
} from '../lib/usernameImport'
import type { EarningsBackfillPass } from '../lib/realEarningsImport'
import { createId } from '../lib/id'
import type { BulkSellRankResult } from '../lib/removeCardAnalysis'
import { buildSavedSellRankings } from '../lib/sellRankings'
import {
  importCatalogProfileIntoData,
  type CatalogProfileImportResult,
} from '../lib/catalogImport'
import type { CatalogImportProfile } from '../lib/catalogApi'
import { applyCardRarityChange } from '../lib/cardRarity'
import type {
  AppSettings,
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
import { plannedPassFromCatalogResult, type PlannedPassInput } from '../lib/plannedPasses'
import { RECOMMENDATION_SIMULATED_RARITY } from '../lib/passRecommendation'

type CardInput = Pick<
  PlayerCard,
  'name' | 'sport' | 'season' | 'notes' | 'rarityLabel' | 'passKind' | 'simulatedRarityLabel'
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
  upsertPackTracker: (plannedPassId: string) => string
  updatePackTracker: (
    id: string,
    patch: Partial<Pick<PackTracker, 'accounts'>>,
  ) => void
  addPackTrackerAccount: (trackerId: string, input?: Partial<PackTrackerAccount>) => string | null
  updatePackTrackerAccount: (
    trackerId: string,
    accountId: string,
    patch: Partial<
      Pick<PackTrackerAccount, 'name' | 'rating' | 'opensPacks' | 'username' | 'rarityLabel' | 'lastImportedAt'>
    >,
  ) => void
  applyPackRatingsFromImport: (
    username: string,
    ratingsByExternalKey: Record<string, { rating: number; rarityLabel?: string }>,
    options?: { plannedPassId?: string; accountId?: string; ensureAccounts?: boolean },
  ) => { updatedAccounts: number; missingPasses: number }
  removePackTrackerAccount: (trackerId: string, accountId: string) => void
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
      void saveAccountData(data, { ifUnmodifiedSince: accountUpdatedAtRef.current })
        .then((result) => {
          accountUpdatedAtRef.current = result.meta.updatedAt
          setStorageWarning(null)
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Could not save account data.'
          setStorageWarning(message)
          console.warn('Could not save account data:', error)
        })
    }, 800)

    return () => window.clearTimeout(handle)
  }, [data, storageReady, accountDevBypass])

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
                addedAt: nowIso(),
              },
            ],
          }
        })
        return createdId
      },
      removePlannedPass: (id) => {
        setData((current) => ({
          ...current,
          plannedPasses: (current.plannedPasses ?? []).filter((pass) => pass.id !== id),
          packTrackers: (current.packTrackers ?? []).filter(
            (tracker) => tracker.plannedPassId !== id,
          ),
        }))
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
          return {
            ...current,
            packTrackers: [
              ...(current.packTrackers ?? []),
              {
                id,
                plannedPassId,
                accounts: [
                  {
                    id: createId('pacc'),
                    name: 'Account 1',
                    rating: 0,
                    opensPacks: true,
                  },
                ],
                createdAt: stamp,
                updatedAt: stamp,
              },
            ],
          }
        })
        return trackerId
      },
      updatePackTracker: (id, patch) => {
        setData((current) => ({
          ...current,
          packTrackers: (current.packTrackers ?? []).map((tracker) => {
            if (tracker.id !== id) return tracker
            return {
              ...tracker,
              accounts: patch.accounts !== undefined ? patch.accounts : tracker.accounts,
              updatedAt: nowIso(),
            }
          }),
        }))
      },
      addPackTrackerAccount: (trackerId, input) => {
        let accountId: string | null = null
        setData((current) => ({
          ...current,
          packTrackers: (current.packTrackers ?? []).map((tracker) => {
            if (tracker.id !== trackerId) return tracker
            const id = createId('pacc')
            accountId = id
            const rating = Number(input?.rating)
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
                },
              ],
              updatedAt: nowIso(),
            }
          }),
        }))
        return accountId
      },
      updatePackTrackerAccount: (trackerId, accountId, patch) => {
        setData((current) => ({
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
                }
              }),
              updatedAt: nowIso(),
            }
          }),
        }))
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
                },
              ]
              updatedAccounts += 1
              return { ...tracker, accounts, updatedAt: stamp }
            }

            if (!imported) {
              missingPasses += matchingAccounts.length
              return tracker
            }

            const targetIds = new Set(matchingAccounts.map((account) => account.id))
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
                }
              }),
              updatedAt: stamp,
            }
          })

          return { ...current, packTrackers: nextTrackers }
        })

        return { updatedAccounts, missingPasses }
      },
      removePackTrackerAccount: (trackerId, accountId) => {
        setData((current) => ({
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
        }))
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
