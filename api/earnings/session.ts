import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import {
  getEarningsCookieName,
  verifyEarningsSessionToken,
} from '../../lib/earningsAuth.js'
import { readCookie } from '../../lib/authCookie.js'

export const config = { runtime: 'edge' }

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const ok = await verifyEarningsSessionToken(readCookie(request, getEarningsCookieName()))
  return Response.json({ ok })
}

export default withErrorLogging('/api/earnings/session', handler)
