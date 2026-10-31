export const ERROR_SOURCES = ['real', 'tracker', 'storage', 'catalog', 'notification', 'browser'] as const
export const ERROR_KINDS = ['http', 'network', 'timeout', 'unexpected', 'invalid_response', 'blocked', 'cancelled'] as const
export type ErrorSource = typeof ERROR_SOURCES[number]
export type ErrorKind = typeof ERROR_KINDS[number]
const operations: Record<string, string> = {
  application: 'Application', real_request: 'Real request', real_ufc_day: 'UFC daily games', catalog_request: 'Catalog request', notification_request: 'Notification delivery',
  '/': 'Dashboard', '/cards': 'Cards', '/packs': 'Packs', '/plan': 'Plan', '/sell': 'If sold', '/entry': 'Collection import', '/admin': 'Admin', '/account': 'Account', '/login': 'Sign in', '/profile': 'Profile', '/calendar': 'Calendar', '/otd': 'On this day', '/marketplace': 'Marketplace', '/marketplace-alerts': 'Marketplace', '/optimize': 'Optimization', '/overlaps': 'Overlaps', '/help': 'Help', '/admin/login': 'Admin sign in',
  '/api/account/login': 'Account sign in', '/api/account/register': 'Account registration', '/api/account/logout': 'Account sign out', '/api/account/session': 'Account session', '/api/account/data': 'Account data', '/api/account/marketplace-alerts': 'Marketplace settings', '/api/account/marketplace-scan': 'Marketplace scan',
  '/api/auth/login': 'Website sign in', '/api/auth/logout': 'Website sign out', '/api/auth/session': 'Website session',
  '/api/earnings/login': 'Marketplace access', '/api/earnings/logout': 'Marketplace access sign out', '/api/earnings/session': 'Marketplace access session',
  '/api/admin/login': 'Admin sign in', '/api/admin/logout': 'Admin sign out', '/api/admin/session': 'Admin session', '/api/admin/users': 'Import usernames', '/api/admin/events': 'Import activity', '/api/admin/errors': 'Error history', '/api/admin/ownership': 'Saved ownership', '/api/admin/tracker-profile': 'Account management', '/api/admin/catalog-import': 'Catalog override', '/api/admin/shop-earnings-crawl': 'Catalog maintenance',
  '/api/catalog/avatars': 'Cached player faces', '/api/catalog/cache': 'Catalog cache', '/api/catalog/candidates': 'Catalog candidates', '/api/catalog/candidates-bulk': 'Catalog candidates', '/api/catalog/import': 'Saved catalog import', '/api/catalog/otd-browse': 'On this day catalog', '/api/catalog/search': 'Catalog search', '/api/catalog/season-years': 'Catalog seasons',
  '/api/import/ownership': 'Ownership import', '/api/import/pack-ratings': 'Packs ratings', '/api/import/play-averages': 'Play averages', '/api/import/real-earnings': 'Collection earnings import', '/api/import/real-passes': 'Collection passes import', '/api/cron/marketplace-alerts': 'Scheduled Marketplace check', '/api/profile/sync': 'Legacy profile sync', '/api/profile/change-pin': 'Legacy profile credentials',
}
export function errorOperation(value: unknown): string { return typeof value === 'string' && Object.hasOwn(operations, value) ? value : 'application' }
export function errorOperationLabel(value: string): string { return operations[errorOperation(value)]! }
export type OperationalError = {
  id: string; at: string | null; source: ErrorSource; kind: ErrorKind; operation: string; status?: number; method?: string
  reported: boolean; confirmedReal500: boolean; endpointKey?: string; incidentId?: string; historical?: boolean
}
export type OperationalErrorInput = { source: ErrorSource; kind: ErrorKind; operation?: string; status?: number; method?: string; id?: string; endpointKey?: string; incidentId?: string; reported?: boolean }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const validStatus = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599
export function createOperationalError(input: OperationalErrorInput): OperationalError {
  const source = ERROR_SOURCES.includes(input.source) ? input.source : 'tracker'
  const kind = ERROR_KINDS.includes(input.kind) ? input.kind : 'unexpected'
  const status = validStatus(input.status) ? input.status : undefined
  const reported = input.reported === true || source === 'browser'
  return {
    id: uuid(input.id) ? input.id : crypto.randomUUID(), at: new Date().toISOString(), source, kind, operation: errorOperation(input.operation),
    ...(status !== undefined ? { status } : {}), ...(input.method && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(input.method) ? { method: input.method } : {}),
    reported, confirmedReal500: !reported && source === 'real' && kind === 'http' && status === 500,
    ...(!reported && /^request-safety:v1:[a-f0-9]{64}$/.test(input.endpointKey ?? '') ? { endpointKey: input.endpointKey } : {}),
    ...(!reported && uuid(input.incidentId) ? { incidentId: input.incidentId } : {}),
  }
}
export function parseBrowserErrorReport(raw: unknown): OperationalError | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (!uuid(value.id) || !ERROR_KINDS.includes(value.kind as ErrorKind)) return null
  return createOperationalError({ id: value.id, source: 'browser', reported: true, kind: value.kind as ErrorKind, operation: errorOperation(value.operation), status: validStatus(value.status) ? value.status : undefined })
}
export function parseOperationalError(raw: unknown): OperationalError | null {
  if (typeof raw === 'string') { try { return parseOperationalError(JSON.parse(raw)) } catch { return null } }
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (!uuid(value.id) || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) || !ERROR_SOURCES.includes(value.source as ErrorSource) || !ERROR_KINDS.includes(value.kind as ErrorKind)) return null
  return { ...createOperationalError(value as OperationalErrorInput), at: value.at }
}
export function errorSummary(event: OperationalError): string {
  if (event.kind === 'http') return `${event.source === 'real' ? 'Real' : event.source === 'browser' ? 'Browser-reported request' : 'Operation'} returned HTTP ${event.status ?? 'unknown'}.`
  return { network: 'The response was not received.', timeout: 'The operation timed out.', unexpected: 'An unexpected error interrupted the operation.', invalid_response: 'The response could not be read.', blocked: 'The operation was stopped by an existing protection.', cancelled: 'The operation was cancelled.' }[event.kind]
}
export type ErrorFilters = { query?: string; source?: ErrorSource; kind?: ErrorKind | 'confirmed'; status?: number; from?: string; to?: string }
export function matchesOperationalError(event: OperationalError, filters: ErrorFilters): boolean {
  if (filters.source && event.source !== filters.source || filters.status !== undefined && event.status !== filters.status || filters.kind === 'confirmed' && !event.confirmedReal500 || filters.kind && filters.kind !== 'confirmed' && event.kind !== filters.kind) return false
  const day = event.at?.slice(0, 10)
  if ((filters.from || filters.to) && (!day || filters.from && day < filters.from || filters.to && day > filters.to)) return false
  const text = `${errorOperationLabel(event.operation)} ${errorSummary(event)} ${event.source} ${event.kind} ${event.id} ${event.incidentId ?? ''} ${event.status ?? ''}`.toLowerCase()
  return (filters.query ?? '').toLowerCase().trim().split(/\s+/).every(term => text.includes(term))
}
