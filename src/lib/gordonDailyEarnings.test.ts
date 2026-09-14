import { describe, expect, it } from 'vitest'
import { normalizeGordonDailyUsernames } from './gordonDailyEarnings'

describe('normalizeGordonDailyUsernames', () => {
  it('always includes the signed-in account first and dedupes others', () => {
    expect(normalizeGordonDailyUsernames(['@Alice', 'gordon', 'alice', 'bob'], '@Gordon')).toEqual([
      'gordon',
      'alice',
      'bob',
    ])
  })
})
