export type EarningsHistoryEntry = {
  username: string
  day: string
  dailyTotal: number
  capturedAt: string
  passes: Array<{
    username: string
    id: string
    label: string
    sport: string
    totalEarnings: number
  }>
}

const STORAGE_KEY = 'rax-daily-earnings-history-v1'

export function readEarningsHistory(): EarningsHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((row): EarningsHistoryEntry[] => {
      if (!row || typeof row !== 'object') return []
      const value = row as Partial<EarningsHistoryEntry>
      if (typeof value.username !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day ?? '')) {
        return []
      }
      return [{
        username: value.username,
        day: value.day!,
        dailyTotal: Number(value.dailyTotal) || 0,
        capturedAt: typeof value.capturedAt === 'string' ? value.capturedAt : '',
        passes: Array.isArray(value.passes)
          ? value.passes.flatMap((pass) =>
              pass && typeof pass.id === 'string'
                ? [{ ...pass, username: pass.username || value.username! }]
                : [],
            )
          : [],
      }]
    })
  } catch {
    return []
  }
}

export function saveEarningsHistoryEntry(entry: EarningsHistoryEntry): EarningsHistoryEntry[] {
  return saveEarningsHistoryEntries([entry])
}

export function saveEarningsHistoryEntries(entries: EarningsHistoryEntry[]): EarningsHistoryEntry[] {
  const replacements = new Map(
    entries.map((entry) => [`${entry.username.toLowerCase()}|${entry.day}`, entry]),
  )
  const next = readEarningsHistory().filter(
    (row) => !replacements.has(`${row.username.toLowerCase()}|${row.day}`),
  )
  next.push(...entries)
  next.sort((a, b) => a.day.localeCompare(b.day) || a.username.localeCompare(b.username))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-1500)))
  return next
}

/**
 * Merges authoritative scheduled snapshots into local history. Matching account/day rows are
 * replaced, while locally refreshed days that the server has not captured are preserved.
 */
export function replaceEarningsHistoryForUsernames(
  entries: EarningsHistoryEntry[],
  usernames: string[],
): EarningsHistoryEntry[] {
  const linked = new Set(usernames.map((username) => username.toLowerCase()))
  return saveEarningsHistoryEntries(
    entries.filter((entry) => linked.has(entry.username.toLowerCase())),
  )
}

export function sumHistory(entries: EarningsHistoryEntry[]): number {
  return entries.reduce((sum, row) => sum + row.dailyTotal, 0)
}

export function highestEarningDay(entries: EarningsHistoryEntry[]): EarningsHistoryEntry | null {
  return entries.reduce<EarningsHistoryEntry | null>(
    (best, row) => !best || row.dailyTotal > best.dailyTotal ? row : best,
    null,
  )
}

export function highestAverageWeekday(entries: EarningsHistoryEntry[]): {
  weekday: string
  average: number
  days: number
} | null {
  const weekdays = new Map<string, { total: number; days: number }>()
  for (const row of entries) {
    const weekday = new Date(`${row.day}T12:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    })
    const current = weekdays.get(weekday) ?? { total: 0, days: 0 }
    weekdays.set(weekday, { total: current.total + row.dailyTotal, days: current.days + 1 })
  }
  return [...weekdays.entries()]
    .map(([weekday, stats]) => ({ weekday, average: stats.total / stats.days, days: stats.days }))
    .sort((a, b) => b.average - a.average)[0] ?? null
}

export type EarningPassRanking = {
  username: string
  label: string
  sport: string
  total: number
  best: number
  days: number
}

export type EarningSportRanking = {
  sport: string
  total: number
  best: number
  average: number
  days: number
  passes: number
}

export function rankEarningSports(entries: EarningsHistoryEntry[]): EarningSportRanking[] {
  const sports = new Map<string, {
    sport: string
    dailyTotals: Map<string, number>
    passes: Set<string>
  }>()

  for (const row of entries) {
    for (const pass of row.passes) {
      const sport = pass.sport.trim() || 'Other'
      const key = sport.toLowerCase()
      const current = sports.get(key) ?? {
        sport,
        dailyTotals: new Map<string, number>(),
        passes: new Set<string>(),
      }
      current.dailyTotals.set(
        row.day,
        (current.dailyTotals.get(row.day) ?? 0) + pass.totalEarnings,
      )
      current.passes.add(`${pass.username.toLowerCase()}|${pass.id}`)
      sports.set(key, current)
    }
  }

  return [...sports.values()]
    .map((row): EarningSportRanking => {
      const dailyTotals = [...row.dailyTotals.values()]
      const total = dailyTotals.reduce((sum, value) => sum + value, 0)
      return {
        sport: row.sport,
        total,
        best: Math.max(0, ...dailyTotals),
        average: dailyTotals.length > 0 ? total / dailyTotals.length : 0,
        days: dailyTotals.length,
        passes: row.passes.size,
      }
    })
    .sort((a, b) => b.total - a.total || b.best - a.best || a.sport.localeCompare(b.sport))
}

export function rankEarningPasses(
  entries: EarningsHistoryEntry[],
  limit = 5,
): EarningPassRanking[] {
  const passes = new Map<string, EarningPassRanking>()
  for (const row of entries) {
    for (const pass of row.passes) {
      const key = `${pass.username.toLowerCase()}|${pass.id}`
      const current = passes.get(key) ?? {
        username: pass.username,
        label: pass.label,
        sport: pass.sport,
        total: 0,
        best: 0,
        days: 0,
      }
      passes.set(key, {
        ...current,
        total: current.total + pass.totalEarnings,
        best: Math.max(current.best, pass.totalEarnings),
        days: current.days + 1,
      })
    }
  }
  return [...passes.values()]
    .sort((a, b) => b.total - a.total || b.best - a.best || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, limit))
}
