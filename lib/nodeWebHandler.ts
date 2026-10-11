type NodeLikeRequest = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type NodeLikeResponse = {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: Uint8Array): void
}

function requestBody(request: NodeLikeRequest): BodyInit | undefined {
  if (request.method === 'GET' || request.method === 'HEAD' || request.body == null) return undefined
  if (typeof request.body === 'string') return request.body
  if (request.body instanceof Uint8Array) return new Uint8Array(request.body)
  return JSON.stringify(request.body)
}

function toWebRequest(request: NodeLikeRequest): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  const protocol = headers.get('x-forwarded-proto') || 'https'
  const host = headers.get('host') || 'localhost'
  const body = requestBody(request)
  if (body && !headers.has('content-type') && typeof request.body === 'object') {
    headers.set('content-type', 'application/json')
  }
  return new Request(`${protocol}://${host}${request.url || '/'}`, {
    method: request.method || 'GET',
    headers,
    body,
  })
}

/**
 * Keeps the app's Web Request handlers usable in local Vite and adapts them to Vercel's Node
 * `req, res` function signature for long-running production work.
 */
export function nodeCompatibleWebHandler(
  webHandler: (request: Request) => Promise<Response> | Response,
) {
  return async (
    request: Request | NodeLikeRequest,
    response?: NodeLikeResponse,
  ): Promise<Response | void> => {
    if (request instanceof Request) return webHandler(request)
    if (!response) throw new Error('Node response object is required.')

    const webResponse = await webHandler(toWebRequest(request))
    response.statusCode = webResponse.status
    webResponse.headers.forEach((value, name) => response.setHeader(name, value))
    response.end(new Uint8Array(await webResponse.arrayBuffer()))
  }
}
