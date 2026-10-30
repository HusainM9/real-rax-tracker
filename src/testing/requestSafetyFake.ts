import type { RequestSafetyRecord, RequestSafetyStore } from '../../lib/requestSafetyStore'

/** Test-only durable boundary. No locks/reservations and no live KV. */
export function memoryRequestSafetyStore(): RequestSafetyStore & { clear(): void; seed(key: string, record: RequestSafetyRecord): void } {
  const records = new Map<string, RequestSafetyRecord>()
  return {
    clear: () => records.clear(),
    seed: (key, record) => { records.set(key, record) },
    getFailure: async key => {
      const record = records.get(key)
      return record?.status === 500 ? { ...record } : null
    },
    recordFailure: async (key, record) => {
      if (record.status !== 500 || record.provider !== 'real') throw new Error('Not a Real 500')
      if (records.get(key)?.status !== 500) records.set(key, { ...record })
    },
  }
}
