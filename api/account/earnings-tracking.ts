import { requireAppSession } from '../admin/_helpers'
import {
  listPublicEarningsSnapshots,
  syncTrackedEarningsUsernames,
} from '../../lib/publicEarningsStore'
import { normalizeRealUsernameInput } from '../../lib/realApi'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const denied = await requireAppSession(request)
  if (denied) return denied

  let body: { usernames?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const usernames = Array.isArray(body.usernames)
    ? [...new Set(
        body.usernames
          .flatMap((value) => typeof value === 'string' ? [normalizeRealUsernameInput(value)] : [])
          .filter(Boolean),
      )].slice(0, 50)
    : []

  try {
    const tracked = await syncTrackedEarningsUsernames(usernames)
    const snapshots = await listPublicEarningsSnapshots(tracked, 120)
    return Response.json({ ok: true, tracked, snapshots })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not synchronize earnings tracking.' },
      { status: 500 },
    )
  }
}
