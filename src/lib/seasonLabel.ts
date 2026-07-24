import { expectedSeasonLabelFromYear } from '../../lib/seasonClaimWindow'
import { normalizeMeowbotSport } from './meowbotApi'

/** College sports (encoding differs: CFB/ncaaf start-year, CBB/ncaam end-year). */
export function isCollegeSport(sportRaw: string): boolean {
  const sport = normalizeMeowbotSport(sportRaw)
  return sport === 'ncaaf' || sport === 'ncaam'
}

export function isUfcSport(sportRaw: string): boolean {
  return normalizeMeowbotSport(sportRaw) === 'ufc'
}

export function isGolfSport(sportRaw: string): boolean {
  return normalizeMeowbotSport(sportRaw) === 'golf'
}

export function isMlbSport(sportRaw: string): boolean {
  return normalizeMeowbotSport(sportRaw) === 'mlb'
}

export function isWnbaSport(sportRaw: string): boolean {
  return normalizeMeowbotSport(sportRaw) === 'wnba'
}

export function isCalendarYearSport(sportRaw: string): boolean {
  return (
    isUfcSport(sportRaw) ||
    isGolfSport(sportRaw) ||
    isMlbSport(sportRaw) ||
    isWnbaSport(sportRaw)
  )
}

/** Season-year encoding per sport lives in lib/seasonClaimWindow (`seasonYearKindForSport`). */
export function seasonLabelFromPass(season: number, sportRaw: string): string {
  return expectedSeasonLabelFromYear(season, normalizeMeowbotSport(sportRaw))
}

export function passMetadataKey(entityId: number, season: number, sportRaw: string): string {
  return `${entityId}|${season}|${normalizeMeowbotSport(sportRaw)}`
}
