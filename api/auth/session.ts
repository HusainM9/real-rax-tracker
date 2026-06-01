import {
  authConfigured,
  getSessionCookieName,
  readCookie,
  verifySessionToken,
} from '../../lib/authCookie'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!authConfigured()) {
    return Response.json({ ok: true, devBypass: true })
  }

  const token = readCookie(request, getSessionCookieName())
  const ok = await verifySessionToken(token)
  return Response.json({ ok })
}
