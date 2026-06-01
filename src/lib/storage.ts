import type {
  PlayerCard,
  PotentialRaxRow,
  RaxPerformance,
  RaxTrackerData,
  SavedPotentialCard,
} from '../types/rax'
import { rarityLabelFromNotes } from './effectiveRax'

const STORAGE_KEY = 'real-rax-tracker:v1'
export const EXPORT_VERSION = 1

export function createEmptyData(): RaxTrackerData {
  return {
    version: EXPORT_VERSION,
    settings: {
      proBonusEnabled: true,
      savedUsername: '',
    },
    cards: [],
    performances: [],
    potentialCards: [],
  }
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
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    sport: typeof value.sport === 'string' ? (value.sport as PlayerCard['sport']) : 'Other',
    season: typeof value.season === 'string' ? value.season : '',
    notes,
    externalKey: typeof value.externalKey === 'string' ? value.externalKey : undefined,
    rarityLabel,
    passKind: value.passKind === 'team' ? 'team' : value.passKind === 'player' ? 'player' : undefined,
    simulatedRarityLabel:
      typeof value.simulatedRarityLabel === 'string' ? value.simulatedRarityLabel : undefined,
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
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt:
      typeof value.updatedAt === 'string'
        ? value.updatedAt
        : typeof value.createdAt === 'string'
          ? value.createdAt
          : new Date().toISOString(),
  }
}

export function normalizeData(value: unknown): RaxTrackerData {
  const fallback = createEmptyData()
  if (!isRecord(value)) return fallback

  const settingsRecord = isRecord(value.settings) ? value.settings : {}

  return {
    version: EXPORT_VERSION,
    settings: {
      proBonusEnabled:
        typeof settingsRecord.proBonusEnabled === 'boolean'
          ? settingsRecord.proBonusEnabled
          : fallback.settings.proBonusEnabled,
      savedUsername:
        typeof settingsRecord.savedUsername === 'string' ? settingsRecord.savedUsername : '',
    },
    cards: Array.isArray(value.cards)
      ? value.cards.map(hydrateCard).filter((card): card is PlayerCard => card !== null)
      : [],
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

export function saveTrackerData(data: RaxTrackerData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Ignore private-mode and quota failures.
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
