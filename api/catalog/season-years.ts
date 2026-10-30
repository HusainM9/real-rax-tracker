import { methodNotAllowed } from '../../lib/httpResponses.js'
import { isTerminalRequestFailure, requestFailureResponse } from '../../lib/httpFailurePolicy.js'

import { requireAppSession } from '../admin/_helpers.js'
import { listCatalogSeasonYears, type CatalogPassKind } from '../../lib/meowbotCatalogStore.js'

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
  const sport = url.searchParams.get('sport')?.trim() ?? ''
  if (!sport) {
    return Response.json({ error: 'sport is required' }, { status: 400 })
  }

  const passKindRaw = url.searchParams.get('passKind')?.trim() ?? 'player'
  const passKind: CatalogPassKind = passKindRaw === 'team' ? 'team' : 'player'

  try {
    return Response.json(await listCatalogSeasonYears({ sport, passKind }))
  } catch (error) {
    if (isTerminalRequestFailure(error)) return requestFailureResponse(error)
    throw error
  }
}
