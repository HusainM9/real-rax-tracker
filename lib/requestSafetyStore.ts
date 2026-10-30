import { getNoRetryKv } from './noRetryKv.js'

export type RequestFailureContext = {
  provider: string
  method: string
  recordedAt: string
  outcome?: 'http_500' | 'http_5xx' | 'transport_unknown'
  reason?: string
  incidentId?: string
}
export type RequestSafetyRecord = { owner: string; status?: number; reservedAt?: string } & Partial<RequestFailureContext>
export type RequestSafetyStore = {
  getFailure(key: string): Promise<RequestSafetyRecord | null>
  recordFailure(key: string, record: RequestSafetyRecord): Promise<void>
}

/** Legacy unknown/non-500 records stay as evidence, not bans. */
function real500(value: unknown): RequestSafetyRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.status === 500 && (!record.provider || record.provider === 'real')) return record as RequestSafetyRecord
  if (record.operations && typeof record.operations === 'object') {
    for (const operation of Object.values(record.operations)) {
      const failure = real500(operation)
      if (failure) return failure
    }
  }
  return null
}

// Same family key as older releases. Retain first actual 500 and prior evidence.
const RECORD_FAILURE = `
local raw = redis.call('GET', KEYS[1])
local function has500(record)
  if type(record) ~= 'table' then return false end
  if record.status == 500 and (not record.provider or record.provider == 'real') then return true end
  if type(record.operations) == 'table' then
    for _, operation in pairs(record.operations) do
      if has500(operation) then return true end
    end
  end
  return false
end
if raw then
  local ok, existing = pcall(cjson.decode, raw)
  if ok and has500(existing) then return 1 end
end
local record = cjson.decode(ARGV[1])
if record.status ~= 500 or record.provider ~= 'real' then return redis.error_reply('Only Real HTTP 500 may be recorded') end
if raw then record.previousRecord = raw end
redis.call('SET', KEYS[1], cjson.encode(record))
return 1
`

export const requestSafetyStore: RequestSafetyStore = {
  async getFailure(key) {
    return real500(await getNoRetryKv().get(key))
  },
  async recordFailure(key, record) {
    if (record.status !== 500 || record.provider !== 'real') throw new Error('Only confirmed Real HTTP 500 may be blocked.')
    if (await getNoRetryKv().eval(RECORD_FAILURE, [key], [JSON.stringify(record)]) !== 1) throw new Error('Real HTTP 500 record could not be saved.')
  },
}
