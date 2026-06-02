import { clearAdminSessionCookieHeader } from '../../lib/adminAuth'
import { requireAppSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
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
