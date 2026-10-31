import { methodNotAllowed } from '../../lib/httpResponses.js'
import { retiredEarningsResponse } from '../../lib/earningsFeature.js'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  return retiredEarningsResponse()
}
