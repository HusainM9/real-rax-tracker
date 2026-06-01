import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createId } from '../lib/id'
import {
  createEmptyData,
  exportTrackerData,
  importTrackerData,
  loadTrackerData,
  saveTrackerData,
} from '../lib/storage'
import {
  importFromUsername as runUsernameImport,
  type UsernameImportOptions,
  type UsernameImportProgress,
  type UsernameImportResult,
} from '../lib/usernameImport'
import type {
  AppSettings,
  PlayerCard,
  PotentialRaxRow,
  RaxPerformance,
  RaxTrackerData,
  SavedPotentialCard,
  Sport,
} from '../types/rax'

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
  setSettings: (patch: Partial<AppSettings>) => void
  addCard: (input: CardInput) => string
  upsertCard: (externalKey: string, input: CardInput) => string
  updateCard: (id: string, patch: Partial<CardInput>) => void
  deleteCard: (id: string) => void
  addPerformance: (input: PerformanceInput) => void
  addPerformances: (inputs: PerformanceInput[]) => void
  updatePerformance: (id: string, patch: Partial<PerformanceInput>) => void
  deletePerformance: (id: string) => void
  addPotentialCard: (input: PotentialCardInput) => string
  updatePotentialCard: (id: string, input: PotentialCardInput) => void
  deletePotentialCard: (id: string) => void
  exportJson: () => string
  importJson: (json: string) => void
  importFromUsername: (
    username: string,
    options?: ImportFromUsernameOptions,
  ) => Promise<UsernameImportResult>
  resetAll: () => void
}

const RaxDataContext = createContext<RaxDataContextValue | null>(null)

function nowIso(): string {
  return new Date().toISOString()
}

export function RaxDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<RaxTrackerData>(loadTrackerData)

  useEffect(() => {
    saveTrackerData(data)
  }, [data])

  const value = useMemo<RaxDataContextValue>(
    () => ({
      data,
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
      deleteCard: (id) => {
        setData((current) => ({
          ...current,
          cards: current.cards.filter((card) => card.id !== id),
          performances: current.performances.filter((performance) => performance.cardId !== id),
        }))
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
      exportJson: () => exportTrackerData(data),
      importJson: (json) => setData(importTrackerData(json)),
      importFromUsername: async (username, options) => {
        const { data: nextData, result } = await runUsernameImport(data, username, options)
        const trimmed = username.replace(/^@/, '').trim()
        setData({
          ...nextData,
          settings: { ...nextData.settings, savedUsername: trimmed },
        })
        return result
      },
      resetAll: () => setData(createEmptyData()),
    }),
    [data],
  )

  return <RaxDataContext.Provider value={value}>{children}</RaxDataContext.Provider>
}

export function useRaxData(): RaxDataContextValue {
  const value = useContext(RaxDataContext)
  if (!value) throw new Error('useRaxData must be used inside RaxDataProvider')
  return value
}

export type { UsernameImportProgress, UsernameImportResult }
