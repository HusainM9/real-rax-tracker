import {
  buildAccountSessionCookieHeader,
  createAccountSessionToken,
} from '../../lib/accountAuth'
import {
  checkLoginRateLimit,
  clearLoginRateLimitHeaders,
  delayFailedLoginAttempt,
  recordFailedLoginAttempt,
} from '../../lib/loginRateLimit'
import { accountsConfigured, registerAccount } from '../../lib/trackerProfileStore'
import { requireAppSession } from '../admin/_helpers'

export const config = {
  runtime: 'edge',
}

type Body = {
  username?: unknown
  password?: unknown
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
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  if (!accountsConfigured()) {
    return Response.json(
      { error: 'Account storage is not configured in this environment.', storageConfigured: false },
      { status: 503 },
    )
  }

  const rateLimit = await checkLoginRateLimit(request)
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Too many attempts. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    )
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''

  try {
    const result = await registerAccount({ username, password })
    if (result.alreadyExists) {
      await delayFailedLoginAttempt()
      const failureHeaders = await recordFailedLoginAttempt(request)
      return Response.json(
        { error: 'An account already exists for this Real @username.' },
        { status: 409, headers: failureHeaders.headers },
      )
    }
    if (!result.ok || !result.username) {
      return Response.json({ error: 'Could not create account.' }, { status: 500 })
    }

    const token = await createAccountSessionToken(result.username)
    if (!token) {
      return Response.json({ error: 'Session secret is not configured' }, { status: 500 })
    }

    return Response.json(
      { ok: true, username: result.username },
      {
        headers: mergeSetCookieHeaders(
          { 'Set-Cookie': buildAccountSessionCookieHeader(token) },
          clearLoginRateLimitHeaders(),
        ),
      },
    )
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not create account.' },
      { status: 400 },
    )
  }
}
