import { methodNotAllowed } from '../../lib/httpResponses'

import { requireAppSession } from '../admin/_helpers'
import { searchCatalogPasses } from '../../lib/meowbotCatalogStore'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  const url = new URL(request.url)
  const query = url.searchParams.get('q') ?? ''
  const limit = Number(url.searchParams.get('limit') ?? 24)
  const result = await searchCatalogPasses({ query, limit })

  return Response.json(result)
}

