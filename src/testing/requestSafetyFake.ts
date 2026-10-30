import type { RequestSafetyRecord, RequestSafetyStore } from '../../lib/requestSafetyStore'

/** Test-only storage boundary; the real guard/admission algorithm still runs. */
export function memoryRequestSafetyStore(): RequestSafetyStore & { clear(): void } {
  const records = new Map<string, RequestSafetyRecord>()
  const operations = new Map<string, Map<string, RequestSafetyRecord>>()
  return {
    clear: () => { records.clear(); operations.clear() },
    reserve: async (key, owner, operation) => {
      const existing = records.get(key)
      if (existing) return { ...existing }
      if (operation) {
        const group = operations.get(key) ?? new Map<string, RequestSafetyRecord>()
        operations.set(key, group)
        const pending = group.get(operation)
        if (pending) return { ...pending }
        group.set(operation, { owner })
        return null
      }
      if (operations.has(key)) throw new Error('Scoped family cannot be admitted without an operation')
      records.set(key, { owner })
      return null
    },
    finish: async (key, owner, status, context, operation) => {
      if (operation) {
        const group = operations.get(key)
        const record = group?.get(operation)
        if (record?.owner !== owner) throw new Error('Reservation owner mismatch')
        if (status === undefined && !context) group!.delete(operation)
        else {
          const failed = { ...record, owner, ...(status === undefined ? {} : { status }), ...context }
          group!.set(operation, failed)
          if (status !== undefined && status >= 500 && status <= 599 && !records.has(key)) records.set(key, failed)
        }
        if (!group!.size) operations.delete(key)
        return
      }
      if (records.get(key)?.owner !== owner) throw new Error('Reservation owner mismatch')
      if (status === undefined && !context) records.delete(key)
      else records.set(key, { ...records.get(key), owner, ...(status === undefined ? {} : { status }), ...context })
    },
  }
}
