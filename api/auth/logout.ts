import { clearSessionCookieHeader } from '../../lib/authCookie'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
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
