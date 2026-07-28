import { computeClaimDayResults, computeYearRollup } from './claimOptimizer'
import { formatClaimDay } from './format'
import { RARITY_TIERS } from './rarityFilter'
import type { RaxTrackerData, Sport } from '../types/rax'

/** Highest-first display order: Iconic → Mystic → Legendary → … */
const PROFILE_RARITY_ORDER: readonly string[] = [...RARITY_TIERS].reverse()

export type ProfileSportShare = {
  sport: Sport
  cardCount: number
  claimableRax: number
  share: number
}

export type ProfileRarityShare = {
  label: string
  count: number
  share: number
}

export type ProfileTopCard = {
  id: string
  name: string
  sport: Sport
  rarityLabel?: string
  claimableRax: number
}

export type ProfileSnapshot = {
  username: string
  title: string
  blurb: string
  cardCount: number
  playerPassCount: number
  teamPassCount: number
  earningsRows: number
  claimDays: number
  claimableRax: number
  overlapRax: number
  efficiencyPct: number
  bestDayLabel: string
  bestDayRax: number
  plannedPasses: number
  packTrackers: number
  sports: ProfileSportShare[]
  rarities: ProfileRarityShare[]
  topCards: ProfileTopCard[]
}

function rarityBucket(label: string | undefined): string {
  const raw = (label ?? '').trim().toLowerCase()
  if (!raw) return 'Unset'
  if (raw.includes('iconic')) return 'Iconic'
  if (raw.includes('mystic')) return 'Mystic'
  if (raw.includes('legendary')) return 'Legendary'
  if (raw.includes('fandom')) return 'Fandom'
  if (raw.includes('rare')) return 'Rare'
  if (raw.includes('common')) return 'Common'
  return label?.trim() || 'Other'
}

function pickTitle(input: {
  cardCount: number
  claimableRax: number
  efficiencyPct: number
  sportCount: number
  iconicCount: number
  overlapRax: number
}): { title: string; blurb: string } {
  if (input.cardCount === 0) {
    return {
      title: 'Blank slate',
      blurb: 'Import a username and this page lights up with your collection story.',
    }
  }
  if (input.iconicCount >= 3) {
    return {
      title: 'Iconic orbit',
      blurb: 'You’re stacking Iconics like they’re going out of style — they aren’t.',
    }
  }
  if (input.efficiencyPct >= 85 && input.claimableRax > 0) {
    return {
      title: 'Overlap assassin',
      blurb: 'Almost everything you entered still claims. Ruthless scheduling energy.',
    }
  }
  if (input.overlapRax > input.claimableRax && input.claimableRax > 0) {
    return {
      title: 'Chaos collector',
      blurb: 'Big bag, messy calendar. The Overlaps page is calling your name.',
    }
  }
  if (input.sportCount >= 6) {
    return {
      title: 'Sport polyglot',
      blurb: 'Your collection doesn’t pick a lane — it opens a league.',
    }
  }
  if (input.cardCount >= 40) {
    return {
      title: 'Vault keeper',
      blurb: 'Deep bench. Deep claims. Deep respect for whoever imports this.',
    }
  }
  if (input.claimableRax >= 500) {
    return {
      title: 'RAX heavyweight',
      blurb: 'Claimable total says you’re not here for participation trophies.',
    }
  }
  if (input.cardCount <= 8) {
    return {
      title: 'Focused flyer',
      blurb: 'Small squad, sharp edges. Quality over clutter.',
    }
  }
  return {
    title: 'OTD regular',
    blurb: 'Solid collection, real claims — keep tuning the calendar.',
  }
}

export function buildProfileSnapshot(
  data: RaxTrackerData,
  username: string,
): ProfileSnapshot {
  const claimResults = computeClaimDayResults(data)
  const rollup = computeYearRollup(data, claimResults)
  const cardCount = data.cards.length
  const playerPassCount = data.cards.filter((card) => (card.passKind ?? 'player') === 'player').length
  const teamPassCount = cardCount - playerPassCount
  const totalEntered = rollup.totalClaimableRax + rollup.totalOverlapRax
  const efficiencyPct =
    totalEntered > 0 ? Math.round((rollup.totalClaimableRax / totalEntered) * 100) : 0

  const bestDay = [...claimResults].sort((a, b) => b.totalClaimableRax - a.totalClaimableRax)[0]
  const sportCounts = new Map<Sport, number>()
  for (const card of data.cards) {
    sportCounts.set(card.sport, (sportCounts.get(card.sport) ?? 0) + 1)
  }

  const sports: ProfileSportShare[] = rollup.sports
    .map((sport) => ({
      sport: sport.sport,
      cardCount: sportCounts.get(sport.sport) ?? 0,
      claimableRax: sport.totalClaimableRax,
      share: cardCount > 0 ? (sportCounts.get(sport.sport) ?? 0) / cardCount : 0,
    }))
    .filter((row) => row.cardCount > 0 || row.claimableRax > 0)
    .sort((a, b) => b.claimableRax - a.claimableRax || b.cardCount - a.cardCount)

  const rarityCounts = new Map<string, number>()
  for (const card of data.cards) {
    const bucket = rarityBucket(card.rarityLabel)
    rarityCounts.set(bucket, (rarityCounts.get(bucket) ?? 0) + 1)
  }
  const rarities: ProfileRarityShare[] = [...rarityCounts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      share: cardCount > 0 ? count / cardCount : 0,
    }))
    .sort((a, b) => {
      const aRank = PROFILE_RARITY_ORDER.indexOf(a.label)
      const bRank = PROFILE_RARITY_ORDER.indexOf(b.label)
      const aOrder = aRank === -1 ? PROFILE_RARITY_ORDER.length : aRank
      const bOrder = bRank === -1 ? PROFILE_RARITY_ORDER.length : bRank
      return aOrder - bOrder || b.count - a.count || a.label.localeCompare(b.label)
    })

  const topCards: ProfileTopCard[] = [...rollup.cards]
    .sort((a, b) => b.totalClaimableRax - a.totalClaimableRax)
    .slice(0, 5)
    .filter((row) => row.totalClaimableRax > 0)
    .map((row) => ({
      id: row.card.id,
      name: row.card.name,
      sport: row.card.sport,
      rarityLabel: row.card.rarityLabel,
      claimableRax: row.totalClaimableRax,
    }))

  const { title, blurb } = pickTitle({
    cardCount,
    claimableRax: rollup.totalClaimableRax,
    efficiencyPct,
    sportCount: sports.length,
    iconicCount: rarityCounts.get('Iconic') ?? 0,
    overlapRax: rollup.totalOverlapRax,
  })

  return {
    username: username.replace(/^@/, '').trim().toLowerCase() || 'collector',
    title,
    blurb,
    cardCount,
    playerPassCount,
    teamPassCount,
    earningsRows: data.performances.length,
    claimDays: claimResults.length,
    claimableRax: rollup.totalClaimableRax,
    overlapRax: rollup.totalOverlapRax,
    efficiencyPct,
    bestDayLabel: bestDay ? formatClaimDay(bestDay.claimDay) : '—',
    bestDayRax: bestDay?.totalClaimableRax ?? 0,
    plannedPasses: data.plannedPasses?.length ?? 0,
    packTrackers: data.packTrackers?.length ?? 0,
    sports,
    rarities,
    topCards,
  }
}
