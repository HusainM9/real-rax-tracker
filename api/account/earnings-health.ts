type NodeResponse = {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

export default function handler(_request: unknown, response: NodeResponse): void {
  response.statusCode = 200
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify({ ok: true, runtime: 'nodejs' }))
}
