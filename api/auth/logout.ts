import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import { clearSessionCookieHeader } from '../../lib/authCookie.js'

export const config = {
  runtime: 'edge',
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': clearSessionCookieHeader(),
      },
    },
  )
}

export default withErrorLogging('/api/auth/logout', handler)
