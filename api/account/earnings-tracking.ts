import { methodNotAllowed } from '../../lib/httpResponses.js'
import { DAILY_EARNINGS_FEATURE_ENABLED, retiredEarningsResponse } from '../../lib/earningsFeature.js'

import {
  listPublicEarningsSnapshots,
  syncTrackedEarningsUsernames,
} from '../../lib/publicEarningsStore.js'
import { requireEarningsSession } from '../../lib/earningsAuth.js'
import { normalizeRealUsernameInput } from '../../lib/realApi.js'
import { gzipJsonToBase64 } from '../../lib/cloudSyncCompression.js'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  if (!DAILY_EARNINGS_FEATURE_ENABLED) return retiredEarningsResponse()
  const denied = await requireEarningsSession(request)
  if (denied) return denied

  let body: { usernames?: unknown; compressed?: unknown }
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
    // Keep the previous 120 per account at the maximum of 50 accounts, while allowing
    // a year of recent snapshots for smaller sets. This caps transfers at 6,000 snapshots.
    const historyLimitPerAccount = Math.min(365, Math.max(120, Math.floor(6000 / Math.max(1, tracked.length))))
    const snapshots = await listPublicEarningsSnapshots(tracked, historyLimitPerAccount)
    if (body.compressed === true) {
      return Response.json({ ok: true, tracked, snapshotsEncoding: 'gzip-base64', snapshotsPayload: await gzipJsonToBase64(snapshots), historyLimitPerAccount })
    }
    return Response.json({ ok: true, tracked, snapshots, historyLimitPerAccount })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not synchronize earnings tracking.' },
      { status: 500 },
    )
  }
}
