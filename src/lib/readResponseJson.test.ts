import { describe, expect, it } from 'vitest'
import { readResponseError, readResponseJson } from './readResponseJson'

function responseWith(body: string, init?: ResponseInit): Response {
  return new Response(body, init)
}

describe('readResponseJson', () => {
  it('parses JSON responses', async () => {
    await expect(readResponseJson(responseWith('{"ok":true}', { status: 200 }))).resolves.toEqual({
      ok: true,
    })
  })

  it('throws a readable error for plain-text failure bodies', async () => {
    await expect(
      readResponseJson(responseWith('An error occurred with this application.', { status: 500 })),
    ).rejects.toThrow('Request failed (500): An error occurred with this application.')
  })

  it('extracts JSON error messages', async () => {
    await expect(
      readResponseError(responseWith('{"error":"Catalog bulk import failed."}', { status: 500 }), 'Request failed'),
    ).resolves.toBe('Catalog bulk import failed.')
  })
})
