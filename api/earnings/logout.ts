import { methodNotAllowed } from '../../lib/httpResponses'

import { clearEarningsCookieHeader } from '../../lib/earningsAuth'

export const config = { runtime: 'edge' }

export default function handler(request: Request): Response {
  if (request.method !== 'POST') return methodNotAllowed()
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearEarningsCookieHeader() } },
  )
}
