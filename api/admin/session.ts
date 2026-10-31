import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import { adminConfigured } from '../../lib/adminAuth.js'
import { authConfigured } from '../../lib/authCookie.js'
import { hasAdminSession, requireAppSession } from './_helpers.js'

export const config = {
  runtime: 'edge',
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const appDenied = await requireAppSession(request)
  if (appDenied) return appDenied

  if (!authConfigured() || !adminConfigured()) {
    return Response.json({ ok: true, devBypass: true, storageConfigured: false })
  }

  const ok = await hasAdminSession(request)
  return Response.json({ ok })
}

export default withErrorLogging('/api/admin/session', handler)
