import { requireAppSession } from '../admin/_helpers'
import { listCatalogSeasonYears, type CatalogPassKind } from '../../lib/meowbotCatalogStore'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  const url = new URL(request.url)
  const sport = url.searchParams.get('sport')?.trim() ?? ''
  if (!sport) {
    return Response.json({ error: 'sport is required' }, { status: 400 })
  }

  const passKindRaw = url.searchParams.get('passKind')?.trim() ?? 'player'
  const passKind: CatalogPassKind = passKindRaw === 'team' ? 'team' : 'player'

  const result = await listCatalogSeasonYears({ sport, passKind })
  return Response.json(result)
}
