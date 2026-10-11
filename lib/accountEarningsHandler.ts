import {
  currentRealEarningsDay,
  reconstructPublicDailyEarnings,
} from './publicDailyEarnings'
import {
  normalizeRealUsernameInput,
  resolveRealApiConfig,
  type RealApiContext,
} from './realApi'

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Could not load Real earnings.'
  const kind = error instanceof Error && 'kind' in error ? String(error.kind) : ''
  if (kind) {
    const status = kind === 'rate_limited' ? 429 : kind === 'not_found' ? 404 : 502
    return Response.json({ error: message, code: `real_${kind}` }, { status })
  }
  return Response.json({ error: message }, { status: 500 })
}

export async function handleAccountEarnings(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: { username?: unknown; day?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const username = normalizeRealUsernameInput(
    typeof body.username === 'string' ? body.username : '',
  )
  const day = typeof body.day === 'string' ? body.day.trim() : ''
  if (!username) return Response.json({ error: 'Real username is required.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: 'Day must use YYYY-MM-DD format.' }, { status: 400 })
  }

  try {
    if (day !== currentRealEarningsDay()) {
      return Response.json(
        {
          error: `No tracked earnings are stored for @${username} on ${day}.`,
          code: 'public_earnings_snapshot_missing',
        },
        { status: 404 },
      )
    }

    const realConfig = resolveRealApiConfig()
    if (!realConfig) {
      return Response.json(
        { error: 'The Real API transport session is not configured.' },
        { status: 503 },
      )
    }
    const context: RealApiContext = { config: realConfig, signal: request.signal }
    const reconstructed = await reconstructPublicDailyEarnings(username, day, context)
    return Response.json(reconstructed)
  } catch (error) {
    return errorResponse(error)
  }
}
