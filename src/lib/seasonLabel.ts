import { normalizeMeowbotSport } from './meowbotApi'

/** College seasons use the start year in Real's `season` field. */
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

export function seasonLabelFromPass(season: number, sportRaw: string): string {
  if (!Number.isInteger(season) || season < 1000) return String(season)
  if (isCollegeSport(sportRaw)) {
    return `${season}-${String(season + 1).slice(-2)}`
  }
  if (isUfcSport(sportRaw) || isGolfSport(sportRaw)) {
    return String(season)
  }
  return `${season - 1}-${String(season).slice(-2)}`
}

export function passMetadataKey(entityId: number, season: number, sportRaw: string): string {
  return `${entityId}|${season}|${normalizeMeowbotSport(sportRaw)}`
}
