export type AdminEventType = 'import_complete' | 'pass_no_earnings' | 'pass_fetch_error'

export type AdminEvent = {
  id: string
  at: string
  type: AdminEventType
  realUsername: string
  clientId: string
  passName?: string
  sport?: string
  season?: string
  rarityLabel?: string
  passKind?: 'player' | 'team'
  externalKey?: string
  message?: string
}

export type AdminEventInput = Omit<AdminEvent, 'id' | 'at'>

export type AdminUserSummary = {
  realUsername: string
  lastAt: string
  importCompleteCount: number
  passNoEarningsCount: number
  passFetchErrorCount: number
}

export const ADMIN_EVENT_TYPES: AdminEventType[] = [
  'import_complete',
  'pass_no_earnings',
  'pass_fetch_error',
]

const SPORTS = new Set([
  'NBA',
  'WNBA',
  'NFL',
  'CFB',
  'MLB',
  'NHL',
  'CBB',
  'Golf',
  'FC',
  'UFC',
  'Other',
])

export function normalizeRealUsername(value: string): string {
  return value.replace(/^@/, '').trim().toLowerCase()
}

export function isAdminEventType(value: string): value is AdminEventType {
  return ADMIN_EVENT_TYPES.includes(value as AdminEventType)
}

export function validateAdminEventInput(input: unknown): AdminEventInput | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''
  const realUsername =
    typeof record.realUsername === 'string' ? normalizeRealUsername(record.realUsername) : ''
  const clientId = typeof record.clientId === 'string' ? record.clientId.trim() : ''

  if (!isAdminEventType(type) || !realUsername || !clientId) return null

  const passKind =
    record.passKind === 'team' ? 'team' : record.passKind === 'player' ? 'player' : undefined
  const sport =
    typeof record.sport === 'string' && SPORTS.has(record.sport) ? record.sport : undefined

  return {
    type,
    realUsername,
    clientId,
    passName: typeof record.passName === 'string' ? record.passName.slice(0, 200) : undefined,
    sport,
    season: typeof record.season === 'string' ? record.season.slice(0, 120) : undefined,
    rarityLabel:
      typeof record.rarityLabel === 'string' ? record.rarityLabel.slice(0, 80) : undefined,
    passKind,
    externalKey:
      typeof record.externalKey === 'string' ? record.externalKey.slice(0, 120) : undefined,
    message: typeof record.message === 'string' ? record.message.slice(0, 500) : undefined,
  }
}

export function parseAdminEvent(raw: unknown): AdminEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.at !== 'string') return null
  const input = validateAdminEventInput(record)
  if (!input) return null
  return { ...input, id: record.id, at: record.at }
}

export function createAdminEvent(input: AdminEventInput): AdminEvent {
  return {
    ...input,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  }
}

export function filterAdminEvents(
  events: AdminEvent[],
  filters: { type?: AdminEventType; username?: string },
): AdminEvent[] {
  let filtered = events
  if (filters.type) {
    filtered = filtered.filter((event) => event.type === filters.type)
  }
  const username = filters.username?.trim().toLowerCase()
  if (username) {
    filtered = filtered.filter((event) => event.realUsername.includes(username))
  }
  return filtered
}

export function mergeUserSummary(
  current: AdminUserSummary | null,
  event: AdminEvent,
): AdminUserSummary {
  const base: AdminUserSummary = current ?? {
    realUsername: event.realUsername,
    lastAt: event.at,
    importCompleteCount: 0,
    passNoEarningsCount: 0,
    passFetchErrorCount: 0,
  }

  return {
    realUsername: event.realUsername,
    lastAt: event.at > base.lastAt ? event.at : base.lastAt,
    importCompleteCount:
      base.importCompleteCount + (event.type === 'import_complete' ? 1 : 0),
    passNoEarningsCount:
      base.passNoEarningsCount + (event.type === 'pass_no_earnings' ? 1 : 0),
    passFetchErrorCount:
      base.passFetchErrorCount + (event.type === 'pass_fetch_error' ? 1 : 0),
  }
}
