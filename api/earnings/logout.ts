import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import { clearEarningsCookieHeader } from '../../lib/earningsAuth.js'

export const config = { runtime: 'edge' }

function handler(request: Request): Response {
  if (request.method !== 'POST') return methodNotAllowed()
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearEarningsCookieHeader() } },
  )
}

export default withErrorLogging('/api/earnings/logout', handler)
