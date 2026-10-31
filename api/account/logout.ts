import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import { clearAccountSessionCookieHeader } from '../../lib/accountAuth.js'
import { requireAppSession } from '../admin/_helpers.js'

export const config = {
  runtime: 'edge',
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': clearAccountSessionCookieHeader(),
      },
    },
  )
}

export default withErrorLogging('/api/account/logout', handler)
