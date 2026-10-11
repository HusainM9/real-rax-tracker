import { describe, expect, it } from 'vitest'
import { nodeCompatibleWebHandler } from './nodeWebHandler'

describe('nodeCompatibleWebHandler', () => {
  it('leaves Web Request handlers unchanged for local development', async () => {
    const handler = nodeCompatibleWebHandler(async (request) =>
      Response.json({ method: request.method, body: await request.json() }),
    )
    const response = await handler(new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }))

    expect(response).toBeInstanceOf(Response)
    expect(await (response as Response).json()).toEqual({ method: 'POST', body: { ok: true } })
  })

  it('adapts Vercel Node request and response objects', async () => {
    const handler = nodeCompatibleWebHandler(async (request) =>
      Response.json({ url: request.url, body: await request.json() }, { status: 201 }),
    )
    const headers = new Map<string, string>()
    let statusCode = 0
    let responseBody: Uint8Array<ArrayBufferLike> = new Uint8Array()
    await handler(
      {
        method: 'POST',
        url: '/api/test',
        headers: { host: 'example.test', 'x-forwarded-proto': 'https' },
        body: { username: 'gordon' },
      },
      {
        get statusCode() { return statusCode },
        set statusCode(value) { statusCode = value },
        setHeader(name, value) { headers.set(name, value) },
        end(body) { responseBody = body ?? new Uint8Array() },
      },
    )

    expect(statusCode).toBe(201)
    expect(headers.get('content-type')).toContain('application/json')
    expect(JSON.parse(new TextDecoder().decode(responseBody))).toEqual({
      url: 'https://example.test/api/test',
      body: { username: 'gordon' },
    })
  })
})
