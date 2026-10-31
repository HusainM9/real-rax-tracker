import { requireAppSession } from './_helpers.js'
import { appendOperationalErrors } from '../../lib/operationalErrorStore.js'
import { parseBrowserErrorReport } from '../../lib/operationalErrorTypes.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'
export const config = { runtime: 'edge' }
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const denied = await requireAppSession(request); if (denied) return denied
  let value: unknown
  try { value = await request.json() } catch { return Response.json({ error: 'Invalid error report.' }, { status: 400 }) }
  const event = parseBrowserErrorReport(value)
  if (!event) return Response.json({ error: 'Invalid error report.' }, { status: 400 })
  try {
    await appendOperationalErrors([event])
    return Response.json({ ok: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('operational-error fallback', event)
    return Response.json({ error: 'Error report could not be saved.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
