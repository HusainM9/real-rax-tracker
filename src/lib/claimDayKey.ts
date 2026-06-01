/** OTD claim buckets use month/day (MM-DD). Performances store full YYYY-MM-DD dates. */

export function isMonthDayKey(value: string): boolean {
  return /^\d{2}-\d{2}$/.test(value)
}

export function monthDayKeyFromClaimDay(claimDay: string): string | null {
  if (isMonthDayKey(claimDay)) return claimDay
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(claimDay)
  if (!match) return null
  return `${match[2]}-${match[3]}`
}

export function monthIndexFromMonthDay(monthDay: string): number {
  const month = Number(monthDay.slice(0, 2))
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : -1
}

export function dayOfMonthFromMonthDay(monthDay: string): number {
  const day = Number(monthDay.slice(3, 5))
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : -1
}

export function monthIndexFromClaimDay(claimDay: string): number {
  const monthDay = monthDayKeyFromClaimDay(claimDay)
  return monthDay ? monthIndexFromMonthDay(monthDay) : -1
}

export function dayOfMonthFromClaimDay(claimDay: string): number {
  const monthDay = monthDayKeyFromClaimDay(claimDay)
  return monthDay ? dayOfMonthFromMonthDay(monthDay) : -1
}
