import { requireEarningsSession } from '../../lib/earningsAuth'

export async function POST(request: Request): Promise<Response> {
  const denied = await requireEarningsSession(request)
  if (denied) return denied
  return Response.json({ ok: true, runtime: 'nodejs' })
}
