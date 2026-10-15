import { describe, expect, it } from 'vitest'
import { methodNotAllowed } from './httpResponses'

describe('methodNotAllowed', () => {
  it('preserves the API method guard response contract', async () => {
    const response = methodNotAllowed()

    expect(response.status).toBe(405)
    expect(await response.text()).toBe('Method Not Allowed')
  })
})
