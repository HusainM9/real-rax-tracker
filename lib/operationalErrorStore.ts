import { getNoRetryKv } from './noRetryKv.js'
import { createOperationalError, matchesOperationalError, parseOperationalError, type ErrorFilters, type OperationalError } from './operationalErrorTypes.js'

const JOURNAL = 'rax:operational-errors:v1'
const IDS = `${JOURNAL}:ids`
const CRITICAL = `${JOURNAL}:real-500`
const HEAD = `${JOURNAL}:head-count`
const APPEND = `
local count = 0
for _, event in ipairs(cjson.decode(ARGV[1])) do
  local identity = (event.reported and 'browser:' or 'server:') .. event.id
  if redis.call('SADD', KEYS[2], identity) == 1 then
    if ARGV[2] == 'historical' then redis.call('RPUSH', KEYS[1], cjson.encode(event)) else redis.call('LPUSH', KEYS[1], cjson.encode(event)); redis.call('INCR', KEYS[4]) end
    if event.confirmedReal500 then redis.call('LPUSH', KEYS[3], cjson.encode(event)) end
    count = count + 1
  end
end
return count
`
// An append-only journal permits stable offset cursors even as new records arrive.
const READ = `
local length = redis.call('LLEN', KEYS[1])
local snapshot = tonumber(ARGV[1])
if snapshot == 0 then snapshot = length end
local head = tonumber(redis.call('GET', KEYS[2]) or '0')
local baseHead = tonumber(ARGV[4])
if baseHead < 0 then baseHead = head end
local start = math.max(0, head - baseHead) + tonumber(ARGV[2])
return { length, redis.call('LRANGE', KEYS[1], start, start + tonumber(ARGV[3]) - 1), head }
`
export async function appendOperationalErrors(events: OperationalError[], options: { historical?: boolean } = {}): Promise<number> {
  const unique = new Map<string, OperationalError>()
  for (const input of events) { const event = parseOperationalError(input); if (event) unique.set(`${event.reported}:${event.id}`, event) }
  if (!unique.size) return 0
  const stored = Number(await getNoRetryKv().eval(APPEND, [JOURNAL, IDS, CRITICAL, HEAD], [JSON.stringify([...unique.values()]), options.historical ? 'historical' : 'current']))
  if (!Number.isSafeInteger(stored) || stored < 0) throw new Error('Error history could not be saved.')
  return stored
}
export type ErrorHistoryPage = { events: OperationalError[]; total: number; nextCursor: string | null; partialSearch: boolean }
export async function listOperationalErrors(options: ErrorFilters & { cursor?: string; limit?: number } = {}): Promise<ErrorHistoryPage> {
  if (options.cursor && !/^\d+:\d+:\d+$/.test(options.cursor)) throw new Error('Invalid history cursor.')
  let [snapshot, offset, baseHead] = options.cursor?.split(':').map(Number) ?? [0, 0, -1]
  if (![snapshot, offset].every(value => Number.isSafeInteger(value) && value >= 0) || offset > snapshot || options.cursor && (!Number.isSafeInteger(baseHead) || baseHead < 0)) throw new Error('Invalid history cursor.')
  const limit = Number.isFinite(options.limit) ? Math.min(100, Math.max(1, Math.floor(options.limit!))) : 50
  const events: OperationalError[] = []
  let total = 0, scanned = 0
  while (scanned < 1000 && events.length < limit) {
    const result = await getNoRetryKv().eval(READ, [JOURNAL, HEAD], [snapshot, offset, 200, baseHead]) as [number, unknown[], number]
    total = Number(result[0])
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(result[1])) throw new Error('Error history is unavailable.')
    if (snapshot > total) throw new Error('Invalid history cursor.')
    if (!snapshot) snapshot = total
    if (baseHead < 0) baseHead = Number(result[2] ?? 0)
    const rows = result[1]
    if (!Array.isArray(rows) || !rows.length) { offset = snapshot; break }
    for (const raw of rows) {
      offset++; scanned++
      const event = parseOperationalError(raw)
      if (event && matchesOperationalError(event, options)) events.push(event)
      if (events.length >= limit || scanned >= 1000 || offset >= snapshot) break
    }
    if (offset >= snapshot) break
  }
  const nextCursor = offset < snapshot ? `${snapshot}:${offset}:${baseHead}` : null
  return { events, total, nextCursor, partialSearch: Boolean(nextCursor && events.length < limit) }
}
function confirmedRecords(raw: unknown): Record<string, unknown>[] {
  if (typeof raw === 'string') { try { return confirmedRecords(JSON.parse(raw)) } catch { return [] } }
  if (!raw || typeof raw !== 'object') return []
  const value = raw as Record<string, unknown>
  if (value.status === 500 && (!value.provider || value.provider === 'real')) return [value]
  return value.operations && typeof value.operations === 'object' ? Object.values(value.operations).flatMap(confirmedRecords) : []
}
async function ufcFamilyKey(): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('real:GET:https://web.realapp.com/home/ufc/day'))
  return `request-safety:v1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`
}
export async function listConfirmedRealErrors(): Promise<OperationalError[]> {
  const kv = getNoRetryKv(), byIncident = new Map<string, OperationalError>(), ufcKey = await ufcFamilyKey()
  const put = (event: OperationalError) => {
    const key = event.endpointKey ?? event.incidentId ?? event.id
    const previous = byIncident.get(key)
    byIncident.set(key, { ...event, operation: event.operation === 'real_request' ? previous?.operation ?? event.operation : event.operation, at: event.at ?? previous?.at ?? null })
  }
  for (const raw of await kv.lrange(CRITICAL, 0, -1)) { const event = parseOperationalError(raw); if (event?.confirmedReal500) put(event) }
  let cursor = 0
  do {
    const result = await kv.scan(cursor, { match: 'request-safety:v1:*', count: 100 })
    cursor = Number(result[0])
    for (const key of result[1]) {
      if (!/^request-safety:v1:[a-f0-9]{64}$/.test(key)) continue
      for (const record of confirmedRecords(await kv.get(key))) {
        const event = createOperationalError({ source: 'real', kind: 'http', status: 500, operation: key === ufcKey ? 'real_ufc_day' : 'real_request', endpointKey: key, incidentId: typeof record.incidentId === 'string' ? record.incidentId : undefined, method: typeof record.method === 'string' ? record.method : undefined })
        event.id = event.incidentId ?? key
        event.at = typeof record.recordedAt === 'string' && Number.isFinite(Date.parse(record.recordedAt)) ? record.recordedAt : null
        event.historical = true; put(event)
      }
    }
  } while (cursor !== 0)
  if (!byIncident.has(ufcKey)) put({ ...createOperationalError({ source: 'real', kind: 'http', status: 500, operation: 'real_ufc_day', endpointKey: ufcKey }), id: 'historical-ufc-500', at: null, historical: true })
  return [...byIncident.values()].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
}
