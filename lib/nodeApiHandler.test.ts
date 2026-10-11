import { describe, expect, it } from 'vitest'
import { nodeApiHandler } from './nodeApiHandler'

describe('nodeApiHandler', () => {
  it('adapts parsed Vercel request bodies and Web responses', async () => {
    const handler = nodeApiHandler(async (request) =>
      Response.json({ url: request.url, body: await request.json() }, { status: 201 }),
    )
    let statusCode = 0
    const headers = new Map<string, string>()
    let body: string | Uint8Array = ''
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
        end(value) { body = value ?? '' },
      },
    )
    expect(statusCode).toBe(201)
    expect(headers.get('content-type')).toContain('application/json')
    expect(JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body))).toEqual({
      url: 'https://example.test/api/test',
      body: { username: 'gordon' },
    })
  })

  it('turns uncaught handler failures into useful JSON responses', async () => {
    const handler = nodeApiHandler(() => { throw new Error('boom') })
    let statusCode = 0
    let body: string | Uint8Array = ''
    await handler(
      { method: 'POST', url: '/api/test', headers: { host: 'example.test' } },
      {
        get statusCode() { return statusCode },
        set statusCode(value) { statusCode = value },
        setHeader() {},
        end(value) { body = value ?? '' },
      },
    )
    expect(statusCode).toBe(500)
    expect(JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body))).toEqual({ error: 'boom' })
  })
})
