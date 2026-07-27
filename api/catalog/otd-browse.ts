import { requireAppSession } from '../admin/_helpers'
import { browseCatalogPasses, type CatalogPassKind } from '../../lib/meowbotCatalogStore'

export const config = {
  runtime: 'edge',
}

function parseCsvParam(value: string | null): string[] {
  if (!value?.trim()) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseSeasonYears(value: string | null): number[] {
  return parseCsvParam(value)
    .map((part) => Number(part))
    .filter((year) => Number.isFinite(year))
    .map((year) => Math.floor(year))
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const denied = await requireAppSession(request)
    if (denied) return denied

    const url = new URL(request.url)
    const query = url.searchParams.get('q')?.trim() ?? ''
    const sports = parseCsvParam(url.searchParams.get('sports'))
    const seasonYears = parseSeasonYears(url.searchParams.get('seasonYears'))
    const monthDay = url.searchParams.get('monthDay')?.trim() ?? ''
    const otdMonth = url.searchParams.get('otdMonth')?.trim() ?? ''
    const startDate = url.searchParams.get('startDate')?.trim() ?? ''
    const endDate = url.searchParams.get('endDate')?.trim() ?? ''
    const passKindRaw = url.searchParams.get('passKind')?.trim() ?? 'all'
    const passKind: CatalogPassKind | 'all' =
      passKindRaw === 'player' || passKindRaw === 'team' ? passKindRaw : 'all'

    const limitRaw = url.searchParams.get('limit')?.trim()
    const offsetRaw = url.searchParams.get('offset')?.trim()
    const limit =
      limitRaw && Number.isFinite(Number(limitRaw)) ? Math.floor(Number(limitRaw)) : undefined
    const offset =
      offsetRaw && Number.isFinite(Number(offsetRaw)) ? Math.floor(Number(offsetRaw)) : undefined

    const result = await browseCatalogPasses({
      query,
      sports,
      seasonYears,
      passKind,
      monthDay: monthDay || undefined,
      otdMonth: otdMonth || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit,
      offset,
    })

    return Response.json(result)
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Catalog OTD browse failed.',
        storageConfigured: false,
        results: [],
        total: 0,
      },
      { status: 500 },
    )
  }
}
