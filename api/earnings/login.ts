import { methodNotAllowed } from '../../lib/httpResponses'

import {
  buildEarningsCookieHeader,
  createEarningsSessionToken,
  earningsPasswordMatches,
} from '../../lib/earningsAuth'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  let body: { password?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (typeof body.password !== 'string' || !earningsPasswordMatches(body.password)) {
    return Response.json({ error: 'Incorrect earnings password.' }, { status: 401 })
  }

  const token = await createEarningsSessionToken()
  if (!token) return Response.json({ error: 'Session signing is not configured.' }, { status: 500 })
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': buildEarningsCookieHeader(token) } },
  )
}
