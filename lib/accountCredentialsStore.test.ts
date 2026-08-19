import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()

vi.mock('@vercel/kv', () => ({
  kv: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, value)
    },
    del: async (key: string) => {
      store.delete(key)
    },
  },
}))

vi.mock('./adminEventStore', () => ({
  adminStorageConfigured: () => true,
}))

import {
  accountSessionIsRevoked,
  authKey,
  persistProfileAuth,
} from './accountCredentialsStore'

describe('account credentials store', () => {
  beforeEach(() => {
    store.clear()
  })

  it('revokes sessions issued before a password reset', async () => {
    await persistProfileAuth('gordon', 'hash', '2026-08-19T20:00:00.000Z')

    await expect(accountSessionIsRevoked('gordon', '')).resolves.toBe(true)
    await expect(accountSessionIsRevoked('gordon', '2026-08-19T19:00:00.000Z')).resolves.toBe(true)
    await expect(accountSessionIsRevoked('gordon', '2026-08-19T20:00:00.000Z')).resolves.toBe(false)
  })

  it('stores credentials on a dedicated key without a TTL', async () => {
    await persistProfileAuth('gordon', 'new-hash', '2026-08-19T20:00:00.000Z')
    expect(store.get(authKey('gordon'))).toEqual({
      passphraseHash: 'new-hash',
      credentialsUpdatedAt: '2026-08-19T20:00:00.000Z',
    })
  })
})
