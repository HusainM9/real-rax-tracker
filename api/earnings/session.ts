import {
  getEarningsCookieName,
  verifyEarningsSessionToken,
} from '../../lib/earningsAuth'
import { readCookie } from '../../lib/authCookie'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
  if (process.env.NODE_ENV === 'development') {
    return Response.json({ ok: true, devBypass: true })
  }
  const ok = await verifyEarningsSessionToken(readCookie(request, getEarningsCookieName()))
  return Response.json({ ok })
}
