import {
  currentRealEarningsDay,
  reconstructPublicDailyEarnings,
} from '../../lib/publicDailyEarnings'
import { requireEarningsSession } from '../../lib/earningsAuth'
import { nodeApiHandler } from '../../lib/nodeApiHandler'
import {
  readPublicEarningsSnapshot,
  savePublicEarningsSnapshot,
} from '../../lib/publicEarningsStore'
import {
  RealApiError,
  normalizeRealUsernameInput,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi'

function errorResponse(error: unknown): Response {
  if (error instanceof RealApiError) {
    const status = error.kind === 'rate_limited' ? 429 : error.kind === 'not_found' ? 404 : 502
    return Response.json({ error: error.message, code: `real_${error.kind}` }, { status })
  }
  return Response.json(
    { error: error instanceof Error ? error.message : 'Could not load Real earnings.' },
    { status: 500 },
  )
}

async function webHandler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const denied = await requireEarningsSession(request)
  if (denied) return denied

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
    const saved = await readPublicEarningsSnapshot(username, day).catch(() => null)
    if (saved) return Response.json(saved)

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
    await savePublicEarningsSnapshot(reconstructed).catch(() => undefined)
    return Response.json(reconstructed)
  } catch (error) {
    return errorResponse(error)
  }
}

export const localWebHandler = webHandler
export default nodeApiHandler(webHandler)
