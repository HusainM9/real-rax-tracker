import { clearAccountSessionCookieHeader } from '../../lib/accountAuth'
import { requireAppSession } from '../admin/_helpers'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
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
