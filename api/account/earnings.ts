import { handleAccountEarnings } from '../../lib/accountEarningsHandler.js'

type NodeRequest = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type NodeResponse = {
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

function toWebRequest(request: NodeRequest): Request {
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

export default async function handler(
  request: Request | NodeRequest,
  response?: NodeResponse,
): Promise<Response | void> {
  try {
    if (!response) return handleAccountEarnings(request as Request)

    const result = await handleAccountEarnings(toWebRequest(request as NodeRequest))
    response.statusCode = result.status
    result.headers.forEach((value, name) => response.setHeader(name, value))
    response.end(new Uint8Array(await result.arrayBuffer()))
  } catch (error) {
    if (!response) throw error
    console.error('Earnings API failed', error)
    if (!response.headersSent) {
      response.statusCode = 500
      response.setHeader('content-type', 'application/json; charset=utf-8')
    }
    response.end(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unexpected server error.',
    }))
  }
}
