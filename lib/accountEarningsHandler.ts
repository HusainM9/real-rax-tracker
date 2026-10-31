import { methodNotAllowed } from './httpResponses.js'
import { retiredEarningsResponse } from './earningsFeature.js'

/** Compatibility URL only: never reconstruct earnings or touch stored history. */
export async function handleAccountEarnings(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  return retiredEarningsResponse()
}
