import type { ClaimDayResult } from '../types/rax'
import {
  dayOfMonthFromMonthDay,
  monthDayKeyFromClaimDay,
  monthIndexFromClaimDay,
  monthIndexFromMonthDay,
} from './claimDayKey'
import { currentYear } from './format'

export const CALENDAR_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export type MonthCalendarGroup = {
  monthIdx: number
  month: string
  days: ClaimDayResult[]
}

export type CalendarCell = {
  key: string
  dayNumber: number | null
  monthDay: string | null
  result: ClaimDayResult | null
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate()
}

export function groupClaimDaysByMonth(results: ClaimDayResult[]): MonthCalendarGroup[] {
  const groups = new Map<number, ClaimDayResult[]>()

  for (const result of results) {
    const monthIdx = monthIndexFromClaimDay(result.claimDay)
    if (monthIdx < 0) continue
    groups.set(monthIdx, [...(groups.get(monthIdx) ?? []), result])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([monthIdx, days]) => ({
      monthIdx,
      month: CALENDAR_MONTH_NAMES[monthIdx] ?? 'Other',
      days: [...days].sort((a, b) => a.claimDay.localeCompare(b.claimDay)),
    }))
}

export function buildCalendarCells(
  days: ClaimDayResult[],
  monthIdx: number,
  layoutYear = currentYear(),
): CalendarCell[] {
  const byDayOfMonth = new Map<number, ClaimDayResult>()
  for (const day of days) {
    const monthDay = monthDayKeyFromClaimDay(day.claimDay) ?? day.claimDay
    if (monthIndexFromMonthDay(monthDay) !== monthIdx) continue
    const dayNumber = dayOfMonthFromMonthDay(monthDay)
    if (dayNumber <= 0) continue
    byDayOfMonth.set(dayNumber, day)
  }

  const leading = new Date(layoutYear, monthIdx, 1).getDay()
  const count = daysInMonth(layoutYear, monthIdx)
  const cells: CalendarCell[] = []

  for (let index = 0; index < leading; index += 1) {
    cells.push({
      key: `blank-${index}`,
      dayNumber: null,
      monthDay: null,
      result: null,
    })
  }

  for (let dayNumber = 1; dayNumber <= count; dayNumber += 1) {
    const result = byDayOfMonth.get(dayNumber) ?? null
    cells.push({
      key: `${monthIdx}-${dayNumber}`,
      dayNumber,
      monthDay: result?.claimDay ?? `${String(monthIdx + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`,
      result,
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      key: `tail-${cells.length}`,
      dayNumber: null,
      monthDay: null,
      result: null,
    })
  }

  return cells
}

export function monthGroupTotals(days: ClaimDayResult[]): {
  dayCount: number
  totalClaimableRax: number
} {
  return {
    dayCount: days.length,
    totalClaimableRax: days.reduce((sum, day) => sum + day.totalClaimableRax, 0),
  }
}

export function findClaimDayResult(
  results: ClaimDayResult[],
  monthDay: string,
): ClaimDayResult | null {
  return results.find((result) => result.claimDay === monthDay) ?? null
}
