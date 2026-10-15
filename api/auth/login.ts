import { methodNotAllowed } from '../../lib/httpResponses'

import {
  authConfigured,
  buildSessionCookieHeader,
  createSessionToken,
} from '../../lib/authCookie'
import {
  checkLoginRateLimit,
  clearLoginRateLimitHeaders,
  delayFailedLoginAttempt,
  recordFailedLoginAttempt,
} from '../../lib/loginRateLimit'

export const config = {
  runtime: 'edge',
}

type LoginBody = {
  password?: string
}

function mergeSetCookieHeaders(...headerGroups: Record<string, string>[]): HeadersInit {
  const headers = new Headers()
  for (const group of headerGroups) {
    for (const [key, value] of Object.entries(group)) {
      if (key.toLowerCase() === 'set-cookie') {
        headers.append('Set-Cookie', value)
      } else {
        headers.set(key, value)
      }
    }
  }
  return headers
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  if (!authConfigured()) {
    return Response.json({ ok: true, devBypass: true })
  }

  const rateLimit = await checkLoginRateLimit(request)
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Too many login attempts. Try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    )
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
    await delayFailedLoginAttempt()
    const failureHeaders = await recordFailedLoginAttempt(request)
    return Response.json(
      { error: 'Incorrect password' },
      {
        status: 401,
        headers: failureHeaders.headers,
      },
    )
  }

  const token = await createSessionToken()
  if (!token) {
    return Response.json({ error: 'Session secret is not configured' }, { status: 500 })
  }

  return Response.json(
    { ok: true },
    {
      headers: mergeSetCookieHeaders(
        { 'Set-Cookie': buildSessionCookieHeader(token) },
        clearLoginRateLimitHeaders(),
      ),
    },
  )
}
