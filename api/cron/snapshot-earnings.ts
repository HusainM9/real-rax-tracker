import { methodNotAllowed } from '../../lib/httpResponses.js'
import { retiredEarningsResponse } from '../../lib/earningsFeature.js'
import { nodeApiHandler, type NodeRequest, type NodeResponse } from '../../lib/nodeApiHandler.js'

/** Acknowledge stale scheduler deliveries without auth, storage or provider work. */
async function handleSnapshot(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed()
  return retiredEarningsResponse(true)
}

const handleNodeRequest = nodeApiHandler(handleSnapshot)

export default async function handler(request: Request | NodeRequest, response?: NodeResponse): Promise<Response | void> {
  if (!response) return handleSnapshot(request as Request)
  await handleNodeRequest(request as NodeRequest, response)
}
