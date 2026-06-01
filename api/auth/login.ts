import {
  authConfigured,
  buildSessionCookieHeader,
  createSessionToken,
} from '../../lib/authCookie'

export const config = {
  runtime: 'edge',
}

type LoginBody = {
  password?: string
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!authConfigured()) {
    return Response.json({ ok: true, devBypass: true })
  }

  let body: LoginBody
  try {
    body = (await request.json()) as LoginBody
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const expectedPassword = process.env.BASIC_AUTH_PASSWORD?.trim()
  const password = body.password ?? ''

  if (!expectedPassword || password !== expectedPassword) {
    return Response.json({ error: 'Incorrect password' }, { status: 401 })
  }

  const token = await createSessionToken()
  if (!token) {
    return Response.json({ error: 'Session secret is not configured' }, { status: 500 })
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': buildSessionCookieHeader(token),
      },
    },
  )
}
