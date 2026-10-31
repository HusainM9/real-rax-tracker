import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import {
  authConfigured,
  getSessionCookieName,
  readCookie,
  verifySessionToken,
} from '../../lib/authCookie.js'

export const config = {
  runtime: 'edge',
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  if (!authConfigured()) {
    return Response.json({ ok: true, devBypass: true })
  }

  const token = readCookie(request, getSessionCookieName())
  const ok = await verifySessionToken(token)
  return Response.json({ ok })
}

export default withErrorLogging('/api/auth/session', handler)
