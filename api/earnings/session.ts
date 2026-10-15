import { methodNotAllowed } from '../../lib/httpResponses'

import {
  getEarningsCookieName,
  verifyEarningsSessionToken,
} from '../../lib/earningsAuth'
import { readCookie } from '../../lib/authCookie'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const ok = await verifyEarningsSessionToken(readCookie(request, getEarningsCookieName()))
  return Response.json({ ok })
}
