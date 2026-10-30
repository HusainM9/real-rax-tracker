import { methodNotAllowed } from '../../lib/httpResponses.js'

import { clearEarningsCookieHeader } from '../../lib/earningsAuth.js'

export const config = { runtime: 'edge' }

export default function handler(request: Request): Response {
  if (request.method !== 'POST') return methodNotAllowed()
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearEarningsCookieHeader() } },
  )
}
