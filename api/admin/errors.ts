import { requireAdminSession } from './_helpers.js'
import { listConfirmedRealErrors, listOperationalErrors } from '../../lib/operationalErrorStore.js'
import { ERROR_KINDS, ERROR_SOURCES, type ErrorKind, type ErrorSource } from '../../lib/operationalErrorTypes.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'
export const config = { runtime: 'edge' }
const date = (value: string | null) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value)
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const denied = await requireAdminSession(request); if (denied) return denied
  const params = new URL(request.url).searchParams
  const source = params.get('source'), kind = params.get('kind'), status = params.has('status') ? Number(params.get('status')) : undefined
  const from = params.get('from'), to = params.get('to'), cursor = params.get('cursor'), limit = Number(params.get('limit') ?? 50)
  if (source && !ERROR_SOURCES.includes(source as ErrorSource) || kind && kind !== 'confirmed' && !ERROR_KINDS.includes(kind as ErrorKind) || status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599) || !date(from) || !date(to) || from && to && from > to || cursor && !/^\d+:\d+$/.test(cursor) || !Number.isInteger(limit) || limit < 1 || limit > 100) return Response.json({ error: 'Invalid error-history filters.' }, { status: 400 })
  try {
    const [history, confirmed] = await Promise.all([
      listOperationalErrors({ query: (params.get('query') ?? '').slice(0, 200), source: source as ErrorSource || undefined, kind: kind as ErrorKind | 'confirmed' || undefined, status, from: from ?? undefined, to: to ?? undefined, cursor: cursor ?? undefined, limit }),
      listConfirmedRealErrors(),
    ])
    return Response.json({ ...history, confirmed, retention: 'indefinite' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('error-history unavailable', { source: 'storage', recordedAt: new Date().toISOString() })
    return Response.json({ error: 'Error history is temporarily unavailable. Existing records and Real protections are retained.', unavailable: true }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
