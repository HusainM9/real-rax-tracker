import { observeRequestErrors, reportOperationalError } from './operationalErrorReporter.js'
import { errorOperation } from './operationalErrorTypes.js'

/** Observe active application handlers. Retired no-network stubs and the journal routes stay separate. */
export function withErrorLogging(operation: string, handler: (request: Request) => Response | Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const observed = observeRequestErrors(request.signal, errorOperation(operation))
    let response: Response
    try { response = await handler(request) } catch {
      if (!observed.count) reportOperationalError({ source: 'tracker', kind: 'unexpected', status: 500, method: request.method }, request.signal)
      response = Response.json({ error: 'An unexpected server error interrupted this operation.' }, { status: 500 })
    }
    if (response.status >= 400 && !observed.count) {
      // Read only controlled classification flags, never copy content into an event.
      const metadata = await response.clone().json().catch(() => null) as null | { code?: string; storageConfigured?: boolean }
      const storage = metadata?.code === 'account_storage_unavailable' || metadata?.storageConfigured === false
      reportOperationalError({ source: storage ? 'storage' : 'tracker', kind: 'http', status: response.status, method: request.method }, request.signal)
    }
    if (!observed.count) return response
    const headers = new Headers(response.headers)
    headers.set('X-Tracker-Error-Recorded', '1')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}
