/** Browser-safe failure metadata: wrappers must not erase the original status. */
export function isHttp5xx(status: unknown): status is number {
  return typeof status === 'number' && status >= 500 && status <= 599
}

export function failureStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = error as { upstreamStatus?: unknown; status?: unknown }
  return typeof value.upstreamStatus === 'number' ? value.upstreamStatus
    : typeof value.status === 'number' ? value.status : undefined
}

export function isTerminalRequestFailure(error: unknown): boolean {
  return isHttp5xx(failureStatus(error)) || Boolean(error && typeof error === 'object' && 'retryable' in error && error.retryable === false)
}

/** Deferred/uncertain work is not a confirmed 5xx. Browser transport failures may
 * already have reached our server; that server's durable provider guard owns admission. */
export function isPendingRequest(error: unknown): boolean {
  return !isHttp5xx(failureStatus(error)) && Boolean(error && typeof error === 'object' && 'pending' in error && error.pending === true)
}

export class RequestSafetyError extends Error {
  readonly retryable = false
  readonly upstreamStatus?: number
  readonly status?: number
  readonly code: string
  readonly pending: boolean
  constructor(message: string, code = 'request_blocked', upstreamStatus?: number, pending = false) {
    super(message)
    this.name = 'RequestSafetyError'
    this.code = code
    this.status = upstreamStatus
    this.upstreamStatus = upstreamStatus
    this.pending = pending
  }
}

export function requestFailureResponse(error: unknown): Response {
  return Response.json({
    error: error instanceof Error ? error.message : 'Request stopped for safety.',
    code: 'request_blocked', retryable: false, upstreamStatus: failureStatus(error),
    pending: isPendingRequest(error),
  }, { status: 423, headers: { 'Cache-Control': 'no-store' } })
}
