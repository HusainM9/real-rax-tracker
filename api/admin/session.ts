import { adminConfigured } from '../../lib/adminAuth'
import { authConfigured } from '../../lib/authCookie'
import { hasAdminSession, requireAppSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const appDenied = await requireAppSession(request)
  if (appDenied) return appDenied

  if (!authConfigured() || !adminConfigured()) {
    return Response.json({ ok: true, devBypass: true, storageConfigured: false })
  }

  const ok = await hasAdminSession(request)
  return Response.json({ ok })
}
