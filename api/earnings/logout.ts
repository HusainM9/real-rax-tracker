import { clearEarningsCookieHeader } from '../../lib/earningsAuth'

export const config = { runtime: 'edge' }

export default function handler(request: Request): Response {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearEarningsCookieHeader() } },
  )
}
