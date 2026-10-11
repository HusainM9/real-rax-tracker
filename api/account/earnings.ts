import {
  nodeApiHandler,
  type NodeRequest,
  type NodeResponse,
} from '../../lib/nodeApiHandler'

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Could not load Real earnings.'
  const kind = error instanceof Error && 'kind' in error ? String(error.kind) : ''
  if (kind) {
    const status = kind === 'rate_limited' ? 429 : kind === 'not_found' ? 404 : 502
    return Response.json({ error: message, code: `real_${kind}` }, { status })
  }
  return Response.json({ error: message }, { status: 500 })
}

async function webHandler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const [earningsAuth, publicDailyEarnings, publicEarningsStore, realApi] = await Promise.all([
    import('../../lib/earningsAuth'),
    import('../../lib/publicDailyEarnings'),
    import('../../lib/publicEarningsStore'),
    import('../../lib/realApi'),
  ])

  const denied = await earningsAuth.requireEarningsSession(request)
  if (denied) return denied

  let body: { username?: unknown; day?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const username = realApi.normalizeRealUsernameInput(
    typeof body.username === 'string' ? body.username : '',
  )
  const day = typeof body.day === 'string' ? body.day.trim() : ''
  if (!username) return Response.json({ error: 'Real username is required.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: 'Day must use YYYY-MM-DD format.' }, { status: 400 })
  }

  try {
    const saved = await publicEarningsStore.readPublicEarningsSnapshot(username, day).catch(() => null)
    if (saved) return Response.json(saved)

    if (day !== publicDailyEarnings.currentRealEarningsDay()) {
      return Response.json(
        {
          error: `No tracked earnings are stored for @${username} on ${day}.`,
          code: 'public_earnings_snapshot_missing',
        },
        { status: 404 },
      )
    }

    const realConfig = realApi.resolveRealApiConfig()
    if (!realConfig) {
      return Response.json(
        { error: 'The Real API transport session is not configured.' },
        { status: 503 },
      )
    }
    const context: import('../../lib/realApi').RealApiContext = {
      config: realConfig,
      signal: request.signal,
    }
    const reconstructed = await publicDailyEarnings.reconstructPublicDailyEarnings(username, day, context)
    await publicEarningsStore.savePublicEarningsSnapshot(reconstructed).catch(() => undefined)
    return Response.json(reconstructed)
  } catch (error) {
    return errorResponse(error)
  }
}

export const localWebHandler = webHandler
const handleNodeRequest = nodeApiHandler(webHandler)

export default async function handler(
  request: NodeRequest,
  response: NodeResponse,
): Promise<void> {
  await handleNodeRequest(request, response)
}
