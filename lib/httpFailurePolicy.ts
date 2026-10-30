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
  return isReal500Failure(error) || Boolean(error && typeof error === 'object' && 'retryable' in error && error.retryable === false)
}

export function isReal500Failure(error: unknown): boolean {
  return failureStatus(error) === 500 && Boolean(error && typeof error === 'object' && 'provider' in error && error.provider === 'real')
}

/** Deferred/uncertain work is not a confirmed 5xx. Browser transport failures may
 * already have reached our server; that server's durable provider guard owns admission. */
export function isPendingRequest(error: unknown): boolean {
  return !isReal500Failure(error) && Boolean(error && typeof error === 'object' && 'pending' in error && error.pending === true)
}

export class RequestSafetyError extends Error {
  readonly retryable = false
  readonly upstreamStatus?: number
  readonly status?: number
  readonly code: string
  readonly pending: boolean
  readonly provider?: string
  constructor(message: string, code = 'request_blocked', upstreamStatus?: number, pending = false, provider?: string) {
    super(message)
    this.name = 'RequestSafetyError'
    this.code = code
    this.status = upstreamStatus
    this.upstreamStatus = upstreamStatus
    this.pending = pending
    this.provider = provider
  }
}

export function requestFailureResponse(error: unknown): Response {
  return Response.json({
    error: error instanceof Error ? error.message : 'Request stopped for safety.',
    code: isReal500Failure(error) ? 'real_http_500' : 'request_blocked', retryable: false, upstreamStatus: failureStatus(error),
    provider: error && typeof error === 'object' && 'provider' in error ? error.provider : undefined,
    pending: isPendingRequest(error),
  }, { status: 423, headers: { 'Cache-Control': 'no-store' } })
}
