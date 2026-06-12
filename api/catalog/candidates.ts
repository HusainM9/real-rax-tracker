import { requireAppSession } from '../admin/_helpers'
import { listCatalogPassSummaries, type CatalogPassKind } from '../../lib/meowbotCatalogStore'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  try {
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
    const seasonYearRaw = url.searchParams.get('seasonYear')?.trim()
    const seasonYear =
      seasonYearRaw && Number.isFinite(Number(seasonYearRaw)) ? Number(seasonYearRaw) : undefined
    const limitRaw = url.searchParams.get('limit')?.trim()
    const limit =
      limitRaw && Number.isFinite(Number(limitRaw))
        ? Math.max(1, Math.floor(Number(limitRaw)))
        : undefined

    const result = await listCatalogPassSummaries({
      sport,
      passKind,
      seasonYear,
      hasEarnings: true,
      limit,
    })

    return Response.json(result)
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Catalog candidates failed.',
        storageConfigured: false,
        results: [],
      },
      { status: 500 },
    )
  }
}
