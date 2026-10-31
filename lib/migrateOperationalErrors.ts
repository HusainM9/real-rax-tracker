import { getNoRetryKv } from './noRetryKv.js'
import { appendOperationalErrors } from './operationalErrorStore.js'
import { parseOperationalError, type OperationalError } from './operationalErrorTypes.js'

/** Explicit one-time, idempotent copy. The old activity list is never modified. */
export async function migrateRetainedImportErrors(): Promise<{ examined: number; eligible: number; stored: number }> {
  const raw = await getNoRetryKv().lrange('rax:events', 0, -1)
  const events: OperationalError[] = []
  for (const item of raw) {
    let value: Record<string, unknown>
    try { value = (typeof item === 'string' ? JSON.parse(item) : item) as Record<string, unknown> } catch { continue }
    if (!value || value.type !== 'pass_fetch_error') continue
    const event = parseOperationalError({ id: value.id, at: value.at, source: 'browser', reported: true, kind: 'unexpected', operation: '/api/import/real-earnings' })
    if (event) events.push(event)
  }
  let stored = 0
  for (let offset = 0; offset < events.length; offset += 100) stored += await appendOperationalErrors(events.slice(offset, offset + 100))
  return { examined: raw.length, eligible: events.length, stored }
}
