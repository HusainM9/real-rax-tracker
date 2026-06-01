export function formatRax(value: number): string {
  return Math.round(value).toLocaleString()
}

export function formatClaimDay(value: string): string {
  const monthDay = /^(\d{2})-(\d{2})$/.exec(value)
  if (monthDay) {
    return `${monthDay[1]}/${monthDay[2]}`
  }
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (full) {
    return `${full[2]}/${full[3]}/${full[1]}`
  }
  return value
}

export function todayIsoLocal(): string {
  const now = new Date()
  const offsetMs = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10)
}

export function currentYear(): number {
  return Number(todayIsoLocal().slice(0, 4))
}
