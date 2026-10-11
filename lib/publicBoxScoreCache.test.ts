import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPublicBoxScoreMemoryCache,
  publicBoxScoreFingerprint,
  readPublicBoxScoreCache,
  writePublicBoxScoreCache,
} from './publicBoxScoreCache'

beforeEach(() => {
  vi.stubEnv('KV_REST_API_URL', '')
  vi.stubEnv('KV_REST_API_TOKEN', '')
  clearPublicBoxScoreMemoryCache()
})

describe('public box-score cache', () => {
  it('reuses exact earnings when the bulk performance is unchanged', async () => {
    const fingerprint = publicBoxScoreFingerprint({
      value: '3.5',
      gameStatus: 'inprogress',
      statValues: [{ type: 30, value: 2 }],
    })
    await writePublicBoxScoreCache([{
      id: 'box-1',
      fingerprint,
      baseEarnings: 21,
      cachedAt: '2026-10-12T10:30:00.000Z',
    }])

    expect((await readPublicBoxScoreCache(['box-1'])).get('box-1')).toMatchObject({
      fingerprint,
      baseEarnings: 21,
    })
  })

  it('changes the fingerprint whenever an in-progress stat changes', () => {
    const before = publicBoxScoreFingerprint({
      value: '3.5',
      gameStatus: 'inprogress',
      statValues: [{ type: 30, value: 2 }],
    })
    const after = publicBoxScoreFingerprint({
      value: '4.1',
      gameStatus: 'inprogress',
      statValues: [{ type: 30, value: 3 }],
    })

    expect(after).not.toBe(before)
  })
})
