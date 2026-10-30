import { expect, it } from 'vitest'
import { isTerminalRequestFailure } from './httpFailurePolicy'

it.each([
  [{ provider: 'real', upstreamStatus: 500 }, true],
  [{ provider: 'real', upstreamStatus: 503 }, false],
  [{ provider: 'kv', upstreamStatus: 500 }, false],
  [{ provider: 'supabase-catalog', status: 500 }, false],
  [{ status: 500 }, false],
])('does not mistake an ordinary internal error for a confirmed Real 500: %j', (error, expected) => {
  expect(isTerminalRequestFailure(error)).toBe(expected)
})
