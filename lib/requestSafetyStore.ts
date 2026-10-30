import { getNoRetryKv } from './noRetryKv.js'

export type RequestFailureContext = {
  provider: string
  method: string
  recordedAt: string
  outcome?: 'http_5xx' | 'transport_unknown'
  reason?: string
  incidentId?: string
}
export type RequestSafetyRecord = { owner: string; status?: number; reservedAt?: string } & Partial<RequestFailureContext>
export type RequestSafetyStore = {
  /** null = admitted, record = already pending/blocked. No expiring leases. */
  reserve(key: string, owner: string, operation?: string): Promise<RequestSafetyRecord | null>
  /** With failure context, retain a block even without a confirmed HTTP status. */
  finish(key: string, owner: string, status?: number, context?: RequestFailureContext, operation?: string): Promise<void>
}

// One key for both the family failure and its active operation reservations.
// Legacy owner-only records are deliberately NOT migrated or released here.
const RESERVE_OPERATION = `
local raw = redis.call('GET', KEYS[1])
local envelope = {version = 2, operations = {}}
if raw then
  local ok, saved = pcall(cjson.decode, raw)
  if not ok or type(saved) ~= 'table' then return redis.error_reply('Invalid safety record') end
  if saved.version ~= 2 then return raw end
  if saved.status ~= nil then return raw end
  if type(saved.operations) ~= 'table' then return redis.error_reply('Invalid safety operations') end
  envelope = saved
end
local existing = envelope.operations[ARGV[3]]
if existing ~= nil then
  if type(existing) ~= 'table' or type(existing.owner) ~= 'string' then return redis.error_reply('Invalid safety operation') end
  return cjson.encode(existing)
end
envelope.operations[ARGV[3]] = {owner = ARGV[1], reservedAt = ARGV[2]}
redis.call('SET', KEYS[1], cjson.encode(envelope))
return nil
`

const FINISH = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, envelope = pcall(cjson.decode, raw)
if not ok or type(envelope) ~= 'table' then return 0 end
local operation = ARGV[7]
local scoped = operation ~= ''
local record = envelope
if scoped then
  if envelope.version ~= 2 or type(envelope.operations) ~= 'table' then return 0 end
  record = envelope.operations[operation]
  if type(record) ~= 'table' then return 0 end
elseif envelope.version == 2 then
  return 0
end
if record.owner ~= ARGV[1] then return 0 end
if ARGV[2] ~= '' or ARGV[3] ~= '' then
  if ARGV[2] ~= '' then record.status = tonumber(ARGV[2]) end
  if ARGV[3] ~= '' then record.provider = ARGV[3] end
  if ARGV[4] ~= '' then record.method = ARGV[4] end
  if ARGV[5] ~= '' then record.recordedAt = record.recordedAt or ARGV[5] end
  record.action = 'paused_until_review'
  if ARGV[6] ~= '' then
    local incident = cjson.decode(ARGV[6])
    record.outcome = incident.outcome or record.outcome
    record.reason = incident.reason or record.reason
    record.incidentId = incident.incidentId or record.incidentId
  end
  if scoped then
    envelope.operations[operation] = record
    if record.status and record.status >= 500 and record.status <= 599 and not envelope.status then
      -- Promote the first confirmed failure to a family-wide block. A late
      -- successful operation can remove itself, never this failure metadata.
      for name, value in pairs(record) do envelope[name] = value end
    end
  end
elseif scoped then
  envelope.operations[operation] = nil
elseif envelope.status then
  -- Never release a previously confirmed failure, even with its old owner.
  return 0
else
  redis.call('DEL', KEYS[1])
  return 1
end
if scoped and not envelope.status and next(envelope.operations) == nil then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], cjson.encode(envelope))
end
return 1
`

/** Separate client: the SDK's default automatic HTTP retries must NOT apply. */
function safetyClient() {
  return getNoRetryKv()
}

export const requestSafetyStore: RequestSafetyStore = {
  async reserve(key, owner, operation) {
    const client = safetyClient()
    if (operation !== undefined) {
      if (!operation) throw new Error('Request-safety operation must not be empty.')
      const existing = await client.eval<string[], RequestSafetyRecord | null>(RESERVE_OPERATION, [key], [owner, new Date().toISOString(), operation])
      if (existing !== null && (!existing || typeof existing !== 'object' || typeof existing.owner !== 'string')) {
        throw new Error('Invalid request-safety record; admission was not established.')
      }
      return existing
    }
    // Atomic admission, deliberately no EX/PX: an uncertain outcome must not auto-expire.
    if (await client.set(key, { owner, reservedAt: new Date().toISOString() }, { nx: true })) return null
    const existing = await client.get<RequestSafetyRecord>(key)
    if (!existing) throw new Error('Request-safety reservation changed; admission was not established.')
    return existing
  },
  async finish(key, owner, status, context, operation) {
    const args = [owner, status ?? '', context?.provider ?? '', context?.method ?? '', context?.recordedAt ?? '',
      context ? JSON.stringify({ outcome: context.outcome, reason: context.reason, incidentId: context.incidentId }) : '', operation ?? '']
    const result = await safetyClient().eval(FINISH, [key], args)
    if (result !== 1) throw new Error('Request-safety reservation could not be finalized.')
  },
}
