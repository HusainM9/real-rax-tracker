import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import {
  adminConfigured,
  buildAdminSessionCookieHeader,
  createAdminSessionToken,
  readAdminPasswordEnv,
} from '../../lib/adminAuth.js'
import { authConfigured } from '../../lib/authCookie.js'
import { requireAppSession } from './_helpers.js'

export const config = {
  runtime: 'edge',
}

type AdminLoginBody = {
  password?: string
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const appDenied = await requireAppSession(request)
  if (appDenied) return appDenied

  if (!authConfigured() || !adminConfigured()) {
    return Response.json({ ok: true, devBypass: true })
  }

  let body: AdminLoginBody
  try {
    body = (await request.json()) as AdminLoginBody
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const expectedPassword = readAdminPasswordEnv()
  const password = body.password ?? ''

  if (!expectedPassword || password !== expectedPassword) {
    return Response.json({ error: 'Incorrect admin password' }, { status: 401 })
  }

  const token = await createAdminSessionToken()
  if (!token) {
    return Response.json({ error: 'Admin session secret is not configured' }, { status: 500 })
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': buildAdminSessionCookieHeader(token),
      },
    },
  )
}

export default withErrorLogging('/api/admin/login', handler)
