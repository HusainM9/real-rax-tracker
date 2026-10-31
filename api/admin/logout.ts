import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import { clearAdminSessionCookieHeader } from '../../lib/adminAuth.js'
import { requireAppSession } from './_helpers.js'

export const config = {
  runtime: 'edge',
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const appDenied = await requireAppSession(request)
  if (appDenied) return appDenied

  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': clearAdminSessionCookieHeader(),
      },
    },
  )
}

export default withErrorLogging('/api/admin/logout', handler)
