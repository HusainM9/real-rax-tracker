import {
  claimDayInPassSeason,
  parseSplitSeasonLabel,
  resolvePassSeasonDateWindow,
  seasonYearKindForSport,
  sportSkipsClaimDaySeasonFilter,
} from '../../lib/seasonClaimWindow'
import {
  boostAddend,
  parseBoosterCardMultiplier,
  parseExplicitMultiplier,
  parsePassBoostMultiplier,
  parseRarityMultiplierLabel,
} from '../../lib/passEarningsBoost'
import { usernameImportExternalKey } from '../../lib/usernameImportShared'
import { getBaseRaxEarned, sportToMeowbotSlug } from './effectiveRax'
import { mapMeowbotSport, type MeowbotPlayerPass } from './meowbotApi'
import { todayIsoLocal } from './format'
import { getOtdMultiplier } from './otdRax'
import type { PlayerCard, RaxTrackerData, Sport } from '../types/rax'
import type { EarningsBackfillDailyRow } from '../../lib/realEarningsShared'

export type SeasonDailyPassInput = {
  entityId: number
  seasonYear: number
  sportRaw: string
  sport: Sport
  passKind: 'player' | 'team'
  name: string
  seasonLabel: string
  rarityLabel?: string
  avatar?: string
  earned?: number
  isActive?: boolean
  boostValue?: number
  boostValueDisplay?: string
  rarityMultiplierLabel?: string
  /** Explicit one-day booster like `15x`, never play rating. */
  boosterMultiplierLabel?: string
  externalKey: string
  /** Present when the pass came from a local tracker collection. */
  cardId?: string
}

export type SeasonDailyPassSummary = {
  externalKey: string
  name: string
  sport: Sport
  seasonLabel: string
  passKind: 'player' | 'team'
  rarityLabel?: string
  rarityMultiplier: number
  boostMultiplier: number
  totalMultiplier: number
  boostLabel: string
  performanceRax: number
  earnedRax: number
}

export type SeasonDailyAccountSummary = {
  username: string
  claimDay: string
  ownedPassCount: number
  currentPassCount: number
  skippedPassCount: number
  performanceRax: number
  earnedRax: number
  boostedPassCount: number
  passes: SeasonDailyPassSummary[]
  error?: string
}

export function resolveSeasonDailyRarityMultiplier(pass: SeasonDailyPassInput): number {
  const fromReal = parseRarityMultiplierLabel(pass.rarityMultiplierLabel)
  if (fromReal != null) return fromReal
  return getOtdMultiplier(pass.sportRaw, pass.rarityLabel, pass.passKind)
}

export function resolvePassBoostMultiplier(pass: SeasonDailyPassInput): number {
  const fromBooster =
    parseExplicitMultiplier(pass.boosterMultiplierLabel) ??
    parseBoosterCardMultiplier(pass.boosterMultiplierLabel)
  if (fromBooster > 1) return fromBooster
  return parsePassBoostMultiplier(undefined, pass.boostValueDisplay)
}

/** Today’s performance RAX × (rarity + boost). Boost is 0 when none is applied. */
export function computeDailyEarnedRax(
  performanceRax: number,
  rarityMultiplier: number,
  boostMultiplier = 0,
): number {
  if (!Number.isFinite(performanceRax) || performanceRax <= 0) return 0
  const rarity = Number.isFinite(rarityMultiplier) && rarityMultiplier > 0 ? rarityMultiplier : 1
  const total = rarity + boostAddend(boostMultiplier)
  return Math.round(performanceRax * total)
}

export function formatMultiplier(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '1×'
  const rounded = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
  return `${rounded}×`
}

export function latestSeasonBySport(passes: SeasonDailyPassInput[]): Map<string, number> {
  const latest = new Map<string, number>()
  for (const pass of passes) {
    const key = pass.sportRaw
    const current = latest.get(key)
    if (current == null || pass.seasonYear > current) latest.set(key, pass.seasonYear)
  }
  return latest
}

export function isPassCurrentlyPlaying(
  pass: SeasonDailyPassInput,
  today: string,
  latestSeasons?: Map<string, number>,
): boolean {
  if (pass.isActive === false) return false
  if (pass.sport === 'UFC') {
    const latest = latestSeasons?.get(pass.sportRaw)
    return latest != null && pass.seasonYear === latest
  }
  if (sportSkipsClaimDaySeasonFilter(pass.sport)) {
    const window = resolvePassSeasonDateWindow(pass.seasonYear, pass.sport, pass.seasonLabel)
    if (window) return today >= window.start && today <= window.end
    const latest = latestSeasons?.get(pass.sportRaw)
    return latest != null && pass.seasonYear === latest
  }
  return claimDayInPassSeason(today, pass.seasonYear, pass.sport, pass.seasonLabel)
}

export function seasonDailyPassFromReal(pass: MeowbotPlayerPass): SeasonDailyPassInput | null {
  const sport = mapMeowbotSport(pass.sportRaw)
  if (!pass.entityId || !pass.season) return null
  return {
    entityId: pass.entityId,
    seasonYear: pass.season,
    sportRaw: pass.sportRaw,
    sport,
    passKind: pass.passKind,
    name: pass.playerName?.trim() || `Pass ${pass.entityId}`,
    seasonLabel: pass.seasonLabel?.trim() || String(pass.season),
    rarityLabel: pass.rarityLabel,
    avatar: pass.avatar,
    earned: pass.earned,
    isActive: pass.isActive,
    boostValue: pass.boostValue,
    boostValueDisplay: pass.boostValueDisplay,
    rarityMultiplierLabel: pass.rarityMultiplierLabel,
    boosterMultiplierLabel: pass.boosterMultiplierLabel,
    externalKey: usernameImportExternalKey(pass.entityId, pass.season, pass.sportRaw),
  }
}

function parseCardSeasonYear(card: PlayerCard): number | null {
  const split = parseSplitSeasonLabel(card.season)
  if (split) {
    return seasonYearKindForSport(card.sport) === 'start' ? split.startYear : split.endYear
  }
  const year = Number(/^(\d{4})/.exec(card.season.trim())?.[1])
  return Number.isInteger(year) && year >= 1000 ? year : null
}

function parseEntityIdFromExternalKey(externalKey: string | undefined): number | null {
  if (!externalKey) return null
  const entityId = Number(externalKey.split('|')[0])
  return Number.isFinite(entityId) && entityId > 0 ? entityId : null
}

export function seasonDailyPassesFromTrackerData(data: RaxTrackerData): SeasonDailyPassInput[] {
  const passes: SeasonDailyPassInput[] = []
  for (const card of data.cards) {
    const seasonYear = parseCardSeasonYear(card)
    if (seasonYear == null) continue
    const entityId = parseEntityIdFromExternalKey(card.externalKey) ?? 0
    const sportRaw = sportToMeowbotSlug(card.sport)
    passes.push({
      entityId,
      seasonYear,
      sportRaw,
      sport: card.sport,
      passKind: card.passKind ?? 'player',
      name: card.name,
      seasonLabel: card.season,
      rarityLabel: card.rarityLabel,
      avatar: card.avatar,
      externalKey:
        card.externalKey?.trim() ||
        usernameImportExternalKey(entityId || 0, seasonYear, sportRaw),
      cardId: card.id,
    })
  }
  return passes
}

export function dailyRowsFromTrackerCard(
  data: RaxTrackerData,
  cardId: string,
  card: PlayerCard,
): EarningsBackfillDailyRow[] {
  return data.performances
    .filter((performance) => performance.cardId === cardId)
    .map((performance) => ({
      claimDay: performance.claimDay,
      baseRaxEarned: getBaseRaxEarned(performance, card),
    }))
    .filter((row) => row.baseRaxEarned > 0 && /^\d{4}-\d{2}-\d{2}/.test(row.claimDay))
}

export function todayPerformanceRow(
  rows: EarningsBackfillDailyRow[],
  today: string,
): EarningsBackfillDailyRow | null {
  const match = rows.find((row) => row.claimDay.slice(0, 10) === today && row.baseRaxEarned > 0)
  return match ?? null
}

export function summarizeTodayPass(
  pass: SeasonDailyPassInput,
  rows: EarningsBackfillDailyRow[],
  today = todayIsoLocal(),
): SeasonDailyPassSummary | null {
  const row = todayPerformanceRow(rows, today)
  if (!row) return null
  const boostMultiplier = resolvePassBoostMultiplier(pass)
  const rarityMultiplier = resolveSeasonDailyRarityMultiplier(pass)
  const earnedRax = computeDailyEarnedRax(row.baseRaxEarned, rarityMultiplier, boostMultiplier)
  if (earnedRax <= 0) return null
  const totalMultiplier = rarityMultiplier + boostAddend(boostMultiplier)
  return {
    externalKey: pass.externalKey,
    name: pass.name,
    sport: pass.sport,
    seasonLabel: pass.seasonLabel,
    passKind: pass.passKind,
    rarityLabel: pass.rarityLabel,
    rarityMultiplier,
    boostMultiplier: boostAddend(boostMultiplier),
    totalMultiplier,
    boostLabel: boostAddend(boostMultiplier) > 0 ? formatMultiplier(boostMultiplier) : 'None',
    performanceRax: row.baseRaxEarned,
    earnedRax,
  }
}

export function summarizeSeasonDailyAccount(
  username: string,
  claimDay: string,
  passSummaries: SeasonDailyPassSummary[],
  ownedPassCount: number,
  skippedPassCount = 0,
): SeasonDailyAccountSummary {
  const passes = [...passSummaries].sort(
    (a, b) => b.earnedRax - a.earnedRax || a.name.localeCompare(b.name),
  )
  return {
    username,
    claimDay,
    ownedPassCount,
    currentPassCount: passes.length,
    skippedPassCount,
    performanceRax: passes.reduce((sum, pass) => sum + pass.performanceRax, 0),
    earnedRax: passes.reduce((sum, pass) => sum + pass.earnedRax, 0),
    boostedPassCount: passes.filter((pass) => pass.boostMultiplier > 0).length,
    passes,
  }
}

export function seasonDailyAccountError(
  username: string,
  error: string,
  claimDay = todayIsoLocal(),
): SeasonDailyAccountSummary {
  return {
    username,
    claimDay,
    ownedPassCount: 0,
    currentPassCount: 0,
    skippedPassCount: 0,
    performanceRax: 0,
    earnedRax: 0,
    boostedPassCount: 0,
    passes: [],
    error,
  }
}

export function filterCurrentSeasonPasses(
  passes: SeasonDailyPassInput[],
  today = todayIsoLocal(),
): { current: SeasonDailyPassInput[]; skipped: number } {
  const latest = latestSeasonBySport(passes)
  const current = passes.filter((pass) => isPassCurrentlyPlaying(pass, today, latest))
  return { current, skipped: passes.length - current.length }
}
