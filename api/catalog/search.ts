import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'
import { isTerminalRequestFailure, requestFailureResponse } from '../../lib/httpFailurePolicy.js'

import { requireAppSession } from '../admin/_helpers.js'
import { searchCatalogPasses } from '../../lib/meowbotCatalogStore.js'

export const config = {
  runtime: 'edge',
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  const url = new URL(request.url)
  const query = url.searchParams.get('q') ?? ''
  const limit = Number(url.searchParams.get('limit') ?? 24)
  try {
    return Response.json(await searchCatalogPasses({ query, limit }))
  } catch (error) {
    if (isTerminalRequestFailure(error)) return requestFailureResponse(error)
    throw error
  }
}


export default withErrorLogging('/api/catalog/search', handler)
