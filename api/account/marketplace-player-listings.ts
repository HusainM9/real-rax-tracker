import { methodNotAllowed } from '../../lib/httpResponses.js'

export const config = { runtime: 'edge' }

/** Retired, including for old clients/direct URLs. No provider or account lookups. */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  return Response.json({ error: 'Individual player listings have been removed.', retryable: false }, {
    status: 410, headers: { 'Cache-Control': 'no-store' },
  })
}
