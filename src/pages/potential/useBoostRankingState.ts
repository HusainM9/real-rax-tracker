import { useState } from 'react'
import { monthIndexFromClaimDay } from '../../lib/claimDayKey'
import { todayIsoLocal } from '../../lib/format'
import type {
  MonthPassRecommendationRow,
  PassRecommendationProgress,
} from '../../lib/passRecommendation'
import type { Sport } from '../../types/rax'

export type RankSportChoice = Sport | 'ALL'

type RankingMeta = {
  calculatedAt: string
  skippedOwnedIconic: number
  skippedAdjusted: number
  skippedNoRows: number
  catalogCount: number
  fetchTrimmed: number
  prefilterTrimmed: number
  baselineAdjustmentCount: number
}

export type MonthBoostMeta = RankingMeta & {
  monthIdx: number
  month: string
}

export type DayBoostMeta = RankingMeta & {
  claimDay: string
  dayLabel: string
  topPerSport?: number | null
}

export function useMonthBoostRankingState(pageSize: number) {
  const [monthBoostOpen, setMonthBoostOpen] = useState(false)
  const [monthBoostSport, setMonthBoostSport] = useState<RankSportChoice>('FC')
  const [monthBoostExcludedSports, setMonthBoostExcludedSports] = useState<Sport[]>([])
  const [monthBoostMonthIdx, setMonthBoostMonthIdx] = useState(() => {
    const index = monthIndexFromClaimDay(todayIsoLocal())
    return index >= 0 ? index : 0
  })
  const [monthBoostInProgress, setMonthBoostInProgress] = useState(false)
  const [monthBoostProgress, setMonthBoostProgress] =
    useState<PassRecommendationProgress | null>(null)
  const [monthBoostStatus, setMonthBoostStatus] = useState('')
  const [monthBoostAllRows, setMonthBoostAllRows] = useState<MonthPassRecommendationRow[]>([])
  const [monthBoostVisibleCount, setMonthBoostVisibleCount] = useState(pageSize)
  const [monthBoostMeta, setMonthBoostMeta] = useState<MonthBoostMeta | null>(null)

  return {
    monthBoostOpen,
    setMonthBoostOpen,
    monthBoostSport,
    setMonthBoostSport,
    monthBoostExcludedSports,
    setMonthBoostExcludedSports,
    monthBoostMonthIdx,
    setMonthBoostMonthIdx,
    monthBoostInProgress,
    setMonthBoostInProgress,
    monthBoostProgress,
    setMonthBoostProgress,
    monthBoostStatus,
    setMonthBoostStatus,
    monthBoostAllRows,
    setMonthBoostAllRows,
    monthBoostVisibleCount,
    setMonthBoostVisibleCount,
    monthBoostMeta,
    setMonthBoostMeta,
  }
}

export function useDayBoostRankingState(pageSize: number) {
  const [dayBoostOpen, setDayBoostOpen] = useState(false)
  const [dayBoostSport, setDayBoostSport] = useState<RankSportChoice>('FC')
  const [dayBoostExcludedSports, setDayBoostExcludedSports] = useState<Sport[]>([])
  const [dayBoostBestDay, setDayBoostBestDay] = useState<string | null>(null)
  const [dayBoostTopPerSport, setDayBoostTopPerSport] = useState<number | null>(null)
  const [dayBoostPendingAutoRun, setDayBoostPendingAutoRun] = useState(false)
  const [dayBoostInProgress, setDayBoostInProgress] = useState(false)
  const [dayBoostProgress, setDayBoostProgress] = useState<PassRecommendationProgress | null>(null)
  const [dayBoostStatus, setDayBoostStatus] = useState('')
  const [dayBoostAllRows, setDayBoostAllRows] = useState<MonthPassRecommendationRow[]>([])
  const [dayBoostVisibleCount, setDayBoostVisibleCount] = useState(pageSize)
  const [dayBoostMeta, setDayBoostMeta] = useState<DayBoostMeta | null>(null)

  return {
    dayBoostOpen,
    setDayBoostOpen,
    dayBoostSport,
    setDayBoostSport,
    dayBoostExcludedSports,
    setDayBoostExcludedSports,
    dayBoostBestDay,
    setDayBoostBestDay,
    dayBoostTopPerSport,
    setDayBoostTopPerSport,
    dayBoostPendingAutoRun,
    setDayBoostPendingAutoRun,
    dayBoostInProgress,
    setDayBoostInProgress,
    dayBoostProgress,
    setDayBoostProgress,
    dayBoostStatus,
    setDayBoostStatus,
    dayBoostAllRows,
    setDayBoostAllRows,
    dayBoostVisibleCount,
    setDayBoostVisibleCount,
    dayBoostMeta,
    setDayBoostMeta,
  }
}
