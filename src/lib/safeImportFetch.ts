import { failureStatus, isReal500Failure, RequestSafetyError } from '../../lib/httpFailurePolicy'
import { errorOperation } from '../../lib/operationalErrorTypes'
import { reportBrowserError } from './browserErrorReporter'

/** One ordinary browser request. Backend Real-500 history is authoritative.
 * Old route-wide browser markers are deliberately ignored, not deleted. */
export async function safeImportFetch(input: string, init?: RequestInit): Promise<Response> {
  const operation = errorOperation(input.split('?')[0])
  const reporting = operation !== 'application' && operation !== '/api/admin/errors' && !input.startsWith('/api/admin/error-report')
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  let response: Response
  try { response = await fetch(input, init) } catch (error) {
    if (reporting) void reportBrowserError({ kind: init?.signal?.aborted ? 'cancelled' : 'network', operation }, error)
    if (init?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new DOMException('Request cancelled.', 'AbortError')
    throw new Error('The response was not received. Check your connection and try again.')
  }
  if (!response.ok && reporting && response.headers.get('x-tracker-error-recorded') !== '1') void reportBrowserError({ kind: 'http', operation, status: response.status })
  const body = await response.clone().json().catch(() => null) as null | { provider?: string; upstreamStatus?: number; error?: string }
  if (isReal500Failure(body)) throw new RequestSafetyError(body?.error ?? 'Real HTTP 500: this Real endpoint is paused.', 'real_http_500', failureStatus(body), false, 'real')
  return response
}

export const safeFetch = safeImportFetch
