export type NodeRequest = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export type NodeResponse = {
  statusCode: number
  headersSent?: boolean
  setHeader(name: string, value: string): void
  end(body?: string | Uint8Array): void
}

function requestBody(request: NodeRequest): BodyInit | undefined {
  const method = request.method?.toUpperCase() || 'GET'
  if (method === 'GET' || method === 'HEAD' || request.body == null) return undefined
  if (typeof request.body === 'string') return request.body
  if (request.body instanceof Uint8Array) return new Uint8Array(request.body)
  return JSON.stringify(request.body)
}

function webRequest(request: NodeRequest): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  const protocol = headers.get('x-forwarded-proto') || 'https'
  const host = headers.get('host') || 'localhost'
  const rawUrl = request.url || '/'
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${protocol}://${host}${rawUrl}`
  const body = requestBody(request)
  if (body && !headers.has('content-type') && typeof request.body === 'object') {
    headers.set('content-type', 'application/json')
  }
  return new Request(url, { method: request.method || 'GET', headers, body })
}

/** Adapts a Web Request handler to the legacy Node signature used by this Vercel Vite project. */
export function nodeApiHandler(handler: (request: Request) => Promise<Response> | Response) {
  return async (request: NodeRequest, response: NodeResponse): Promise<void> => {
    try {
      const result = await handler(webRequest(request))
      response.statusCode = result.status
      result.headers.forEach((value, name) => response.setHeader(name, value))
      response.end(new Uint8Array(await result.arrayBuffer()))
    } catch (error) {
      console.error('Node API handler failed', error)
      if (!response.headersSent) {
        response.statusCode = 500
        response.setHeader('content-type', 'application/json; charset=utf-8')
      }
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unexpected server error.',
      }))
    }
  }
}
