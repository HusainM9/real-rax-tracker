import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('BASIC_AUTH_PASSWORD', '')
  vi.stubEnv('AUTH_SESSION_SECRET', 'offline-fixture-session-key')
  vi.stubEnv('TRACKER_SYNC_SECRET', '')
  vi.stubEnv('KV_REST_API_URL', 'https://storage.offline.invalid')
  vi.stubEnv('KV_REST_API_TOKEN', 'offline-fixture-key')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('persists a controlled error through the real journal and official SDK', async () => {
  const journal: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin !== 'https://storage.offline.invalid' || url.pathname !== '/') throw new Error('Unexpected offline destination')
    const command = JSON.parse(String(init?.body))
    if (command[0] === 'eval' && command[3] === 'rax:operational-errors:v1') {
      journal.push(...JSON.parse(command[7]))
      return Response.json({ result: 1 })
    }
    throw new Error('Unexpected offline storage command')
  })
  const { createOperationalError } = await import('../../lib/operationalErrorTypes')
  const { appendOperationalErrors } = await import('../../lib/operationalErrorStore')
  await appendOperationalErrors([createOperationalError({ source: 'storage', kind: 'http', status: 503, operation: '/api/account/login' })])
  expect(journal).toHaveLength(1)
  expect(journal[0]).toMatchObject({ source: 'storage', status: 503, operation: '/api/account/login', confirmedReal500: false })
  expect(JSON.stringify(journal)).not.toMatch(/offline-fixture-pass|offline-fixture-key|Synthetic connection|storage\.offline/)
})

// Only the external HTTP boundary is simulated. No application module is mocked.
function accountStorage({ failFirstRead = false } = {}) {
  const credentialsUpdatedAt = '2026-11-09T00:00:00.000Z'
  const passphraseHash = createHash('sha256').update('offline-fixture-session-key:fixture:offline-fixture-pass').digest('hex')
  const auth = { passphraseHash, credentialsUpdatedAt }
  const data = { cards: [{ id: 'saved-card', name: 'Saved player', sport: 'NHL' }], performances: [] }
  const profile = { username: 'fixture', ...auth, updatedAt: credentialsUpdatedAt, cardCount: 1, performanceCount: 0, data }
  const reads: string[] = []
  const journal: Array<Record<string, unknown>> = []
  let rejectNextProfile = failFirstRead
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin !== 'https://storage.offline.invalid' || url.pathname !== '/') throw new Error('Unexpected offline destination')
    const command = JSON.parse(String(init?.body))
    if (command[0] === 'get') {
      const key = command[1]
      if (!['rax:tracker-profile:fixture', 'rax:tracker-auth:fixture'].includes(key)) throw new Error('Unexpected offline read')
      reads.push(key)
      if (key === 'rax:tracker-profile:fixture' && rejectNextProfile) {
        rejectNextProfile = false
        throw new TypeError('Synthetic connection failure')
      }
      return Response.json({ result: JSON.stringify(key === 'rax:tracker-profile:fixture' ? profile : auth) })
    }
    if (command[0] === 'eval' && command[2] === 4 && command[3] === 'rax:operational-errors:v1') {
      journal.push(...JSON.parse(command[7]))
      return Response.json({ result: 1 })
    }
    throw new Error('Unexpected offline storage command')
  })
  return { reads, journal, data }
}

async function signIn() {
  const { default: login } = await import('../../api/account/login')
  return login(new Request('https://tracker.offline.invalid/api/account/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'fixture', password: 'offline-fixture-pass' }),
  }))
}

async function readSignedInData(response: Response) {
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('rax_account_session='))
  expect(Boolean(cookie)).toBe(true)
  expect(cookie?.includes('HttpOnly')).toBe(true)
  expect(cookie?.includes('SameSite=Lax')).toBe(true)
  const { default: accountData } = await import('../../api/account/data')
  return accountData(new Request('https://tracker.offline.invalid/api/account/data', { headers: { cookie: cookie!.split(';')[0] } }))
}

it('authenticates through real credentials and session validation before returning saved account data', async () => {
  const storage = accountStorage()
  const login = await signIn()
  expect(login.status).toBe(200)
  const response = await readSignedInData(login)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ username: 'fixture', cardCount: 1, data: storage.data })
  expect(storage.reads).toEqual([
    'rax:tracker-profile:fixture', 'rax:tracker-auth:fixture',
    'rax:tracker-auth:fixture', 'rax:tracker-profile:fixture',
  ])
  expect(storage.journal).toEqual([])
})

it('makes one failed storage attempt, records it as storage, and permits later explicit login and account access', async () => {
  const storage = accountStorage({ failFirstRead: true })
  const failed = await signIn()
  expect(failed.status).toBe(503)
  expect(storage.reads).toEqual(['rax:tracker-profile:fixture'])
  await vi.waitFor(() => expect(storage.journal).toHaveLength(1))
  expect(storage.journal[0]).toMatchObject({ source: 'storage', status: 503, operation: '/api/account/login', confirmedReal500: false })
  expect(JSON.stringify(storage.journal)).not.toMatch(/offline-fixture-pass|offline-fixture-key|Synthetic connection|storage\.offline/)
  const recovered = await signIn()
  expect(recovered.status).toBe(200)
  const response = await readSignedInData(recovered)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ data: storage.data })
  expect(storage.reads.filter(key => key === 'rax:tracker-profile:fixture')).toHaveLength(3)
})

it('refuses private-site access before reading account storage', async () => {
  vi.stubEnv('BASIC_AUTH_PASSWORD', 'offline-site-fixture')
  const storage = accountStorage()
  expect((await signIn()).status).toBe(401)
  expect(storage.reads).toEqual([])
  await vi.waitFor(() => expect(storage.journal).toHaveLength(1))
  expect(storage.journal[0]).toMatchObject({ source: 'tracker', status: 401, confirmedReal500: false })
})

it('denies unmocked network access in the integration project', async () => {
  await expect(fetch('https://offline.invalid')).rejects.toThrow('unmocked fetch is forbidden')
})
