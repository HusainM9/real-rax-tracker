import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardedUpstreamFetch } from './guardedUpstreamFetch'
import { memoryRequestSafetyStore } from '../src/testing/requestSafetyFake'

const store = memoryRequestSafetyStore()
beforeEach(() => store.clear())
afterEach(() => vi.restoreAllMocks())

async function observed(promise: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000) })]) }
  finally { clearTimeout(timer) }
}

describe('durable no-repeat admission', () => {
  it.each(Array.from({ length: 100 }, (_, index) => 500 + index))('blocks catalog HTTP %i across different query operations', async status => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }))
    vi.stubGlobal('fetch', fetcher)
    const base = `https://catalog.test/rest/v1/status_${status}`
    await expect(guardedUpstreamFetch('supabase-catalog', `${base}?select=avatar`, {}, store)).rejects.toMatchObject({ upstreamStatus: status })
    await expect(guardedUpstreamFetch('supabase-catalog', `${base}?select=earnings`, {}, store)).rejects.toMatchObject({ upstreamStatus: status })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([undefined, 503])('does not bypass a legacy catalog family record with status %s', async status => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const legacy = { ...store, reserve: async (key: string, owner: string, operation?: string) => {
      await store.reserve(key, 'legacy-owner')
      if (status) await store.finish(key, 'legacy-owner', status)
      return store.reserve(key, owner, operation)
    } }
    await expect(guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/legacy?select=earnings', {}, legacy)).rejects.toMatchObject({ retryable: false, upstreamStatus: status })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('releases only its cancelled unused catalog operation', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    const cancelledStore = { ...store, reserve: async (key: string, owner: string, operation?: string) => {
      const result = await store.reserve(key, owner, operation)
      controller.abort()
      return result
    } }
    await expect(guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/cancelled?select=avatar', { signal: controller.signal }, cancelledStore)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    expect((await guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/cancelled?select=avatar', {}, store)).ok).toBe(true)
  })
  it('keeps a warm catalog family blocked if confirmed-failure persistence fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 502 }))
    vi.stubGlobal('fetch', fetcher)
    const failedStore = { ...store, finish: async () => { throw new Error('Storage unavailable') } }
    await expect(guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/persist_failed?select=avatar', {}, failedStore)).rejects.toMatchObject({ upstreamStatus: 502 })
    await expect(guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/persist_failed?select=earnings', {}, failedStore)).rejects.toMatchObject({ upstreamStatus: 502 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not dispatch a delayed admission after another query has persisted 5xx', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let firstStarted!: () => void
    let failFirst!: (response: Response) => void
    const started = new Promise<void>(resolve => { firstStarted = resolve })
    let secondAdmitted!: () => void
    const admitted = new Promise<void>(resolve => { secondAdmitted = resolve })
    let releaseAdmission!: () => void
    const admissionReply = new Promise<void>(resolve => { releaseAdmission = resolve })
    let calls = 0
    const delayedStore = { ...store, reserve: async (key: string, owner: string, operation?: string) => {
      const result = await store.reserve(key, owner, operation)
      if (++calls === 2) { secondAdmitted(); await admissionReply }
      return result
    } }
    const fetcher = vi.fn().mockImplementationOnce(() => { firstStarted(); return new Promise<Response>(resolve => { failFirst = resolve }) }).mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetcher)
    const first = guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/admission_race?select=avatar', {}, delayedStore)
    const checkedFirst = expect(first).rejects.toMatchObject({ upstreamStatus: 503 })
    await started
    const second = guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/admission_race?select=earnings', {}, delayedStore)
    const checkedSecond = expect(second).rejects.toMatchObject({ upstreamStatus: 503 })
    try {
      await admitted
      failFirst(new Response(null, { status: 503 }))
      await checkedFirst
      releaseAdmission()
      await checkedSecond
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      failFirst(new Response(null, { status: 503 }))
      releaseAdmission()
      await Promise.allSettled([checkedFirst, checkedSecond])
    }
  })
  it('isolates an uncertain catalog query without blocking a different read of the same table', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Lost catalog connection')).mockResolvedValue(Response.json({ rows: [] }))
    vi.stubGlobal('fetch', fetcher)
    const first = 'https://catalog.test/rest/v1/meowbot_passes?select=avatar&sport=NBA'
    await expect(guardedUpstreamFetch('supabase-catalog', first, {}, store)).rejects.toMatchObject({ code: 'request_outcome_unknown' })
    await expect(guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/meowbot_passes?sport=NBA&select=avatar', {}, store)).rejects.toMatchObject({ retryable: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/meowbot_passes?select=earnings&sport=NHL', {}, store)).ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('admits different catalog reads concurrently instead of deferring an unrelated operation', async () => {
    let finishFirst!: (response: Response) => void
    let firstStarted!: () => void
    const started = new Promise<void>(resolve => { firstStarted = resolve })
    const fetcher = vi.fn().mockImplementationOnce(() => { firstStarted(); return new Promise<Response>(resolve => { finishFirst = resolve }) }).mockResolvedValue(Response.json({ rows: [] }))
    vi.stubGlobal('fetch', fetcher)
    const first = guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/meowbot_passes?select=avatar', {}, store)
    await started
    const second = guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/meowbot_passes?select=earnings', {}, store)
    try {
      // The second response can finish before the first is released.
      expect(await observed(second)).toBe(true)
      expect((await second).ok).toBe(true)
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally { finishFirst(Response.json({ rows: [] })); await Promise.allSettled([first, second]) }
  })
  it('keeps a catalog family blocked after 5xx even when another in-flight query succeeds later', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let failFirst!: (response: Response) => void
    let finishSecond!: (response: Response) => void
    let firstStarted!: () => void
    let secondStarted!: () => void
    const startedFirst = new Promise<void>(resolve => { firstStarted = resolve })
    const startedSecond = new Promise<void>(resolve => { secondStarted = resolve })
    const fetcher = vi.fn()
      .mockImplementationOnce(() => { firstStarted(); return new Promise<Response>(resolve => { failFirst = resolve }) })
      .mockImplementationOnce(() => { secondStarted(); return new Promise<Response>(resolve => { finishSecond = resolve }) })
    vi.stubGlobal('fetch', fetcher)
    const first = guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/meowbot_passes?select=avatar', {}, store)
    const checkedFirst = expect(first).rejects.toMatchObject({ upstreamStatus: 503 })
    await startedFirst
    const second = guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/meowbot_passes?select=earnings', {}, store)
    const checkedSecond = second.then(value => ({ value }), error => ({ error }))
    try {
      expect(await observed(startedSecond)).toBe(true)
      failFirst(new Response(null, { status: 503 }))
      await checkedFirst
      finishSecond(Response.json({ rows: [] }))
      expect((await second).ok).toBe(true)
      await expect(guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/rest/v1/meowbot_passes?select=name', {}, store)).rejects.toMatchObject({ upstreamStatus: 503 })
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      failFirst(new Response(null, { status: 503 }))
      finishSecond?.(Response.json({ rows: [] }))
      await Promise.allSettled([checkedFirst, checkedSecond])
    }
  })
  it.each([
    ['ENOTFOUND', 'dns_failure'],
    ['ETIMEDOUT', 'timeout'],
    ['CERT_HAS_EXPIRED', 'tls_failure'],
    ['ECONNREFUSED', 'connection_refused'],
    ['secret-code-containing-a-token', 'transport_failure'],
  ])('reports only a fixed diagnostic category for transport code %s', async (code, reason) => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn().mockRejectedValue(Object.assign(new Error('secret message'), { cause: { code } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(guardedUpstreamFetch('real', 'https://provider.test/category', {}, store)).rejects.toMatchObject({ code: 'request_outcome_unknown', upstreamStatus: undefined })
    expect(logger).toHaveBeenCalledWith('request-safety incident', expect.objectContaining({ reason, outcome: 'transport_unknown' }))
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret')
  })
  it('keeps an aborted dispatched request blocked even when incident storage fails', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = new AbortController()
    const fetcher = vi.fn().mockImplementation(async () => {
      controller.abort()
      throw new DOMException('Private connection details', 'AbortError')
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(guardedUpstreamFetch('real', 'https://provider.test/sent', { signal: controller.signal }, { ...store, finish: async () => { throw new Error('storage down') } })).rejects.toMatchObject({ retryable: false })
    await expect(guardedUpstreamFetch('real', 'https://provider.test/sent', {}, store)).rejects.toMatchObject({ retryable: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(logger).toHaveBeenCalledTimes(1)
    expect(logger).toHaveBeenCalledWith('request-safety incident', expect.objectContaining({ reason: 'aborted', outcome: 'transport_unknown' }))
  })
  it('records a redacted transport incident and keeps its reference for later callers', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn().mockRejectedValue(Object.assign(new TypeError('private-url?token=secret'), { cause: { code: 'ECONNRESET', message: 'private credentials' } }))
    vi.stubGlobal('fetch', fetcher)
    const finish = vi.spyOn(store, 'finish')
    const first = await guardedUpstreamFetch('real', 'https://provider.test/incident?token=secret', {}, store).catch((error: unknown) => error)
    expect(first).toMatchObject({ code: 'request_outcome_unknown', retryable: false })
    expect(logger).toHaveBeenCalledTimes(1)
    const incident = logger.mock.calls[0]?.[1] as { incidentId: string }
    expect(incident).toMatchObject({ provider: 'real', method: 'GET', outcome: 'transport_unknown', reason: 'connection_reset', recordedAt: expect.any(String), incidentId: expect.any(String), action: 'paused_until_review' })
    expect(finish).toHaveBeenCalledWith(expect.any(String), expect.any(String), undefined, expect.objectContaining({ outcome: 'transport_unknown', reason: 'connection_reset', incidentId: incident.incidentId }))
    expect((first as Error).message).toContain(incident.incidentId)
    const later = await guardedUpstreamFetch('real', 'https://provider.test/incident?force=true', {}, store).catch((error: unknown) => error)
    expect(later).toMatchObject({ retryable: false, pending: false })
    expect((later as Error).message).toContain(incident.incidentId)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(logger).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/secret|private credentials|provider\.test|private-url/)
  })
  it('releases its unused reservation when cancelled during admission without sending HTTP', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetcher)
    const cancelledStore = { ...store, reserve: async (key: string, owner: string) => {
      const existing = await store.reserve(key, owner)
      controller.abort()
      return existing
    } }
    await expect(guardedUpstreamFetch('real', 'https://provider.test/preflight', { signal: controller.signal }, cancelledStore)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
    expect((await guardedUpstreamFetch('real', 'https://provider.test/preflight', {}, store)).ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('keeps cancellation fail-closed if an unused reservation cannot be released', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetcher)
    const cancelledStore = { ...store, reserve: async (key: string, owner: string) => {
      const existing = await store.reserve(key, owner)
      controller.abort()
      return existing
    }, finish: async () => { throw new Error('storage failed') } }
    await expect(guardedUpstreamFetch('real', 'https://provider.test/preflight', { signal: controller.signal }, cancelledStore)).rejects.toMatchObject({ retryable: false })
    await expect(guardedUpstreamFetch('real', 'https://provider.test/preflight', {}, store)).rejects.toMatchObject({ pending: true })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('logs a redacted timestamped incident once, even when finalizing storage fails', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn().mockResolvedValue(new Response('private response', { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const failingFinish = { ...store, finish: async () => { throw new Error('storage unavailable') } }
    await expect(guardedUpstreamFetch('real', 'https://provider.test/incident?token=secret', {}, failingFinish)).rejects.toMatchObject({ upstreamStatus: 503 })
    await expect(guardedUpstreamFetch('real', 'https://provider.test/incident?force=1', {}, failingFinish)).rejects.toThrow()
    expect(logger).toHaveBeenCalledTimes(1)
    expect(logger).toHaveBeenCalledWith('request-safety incident', expect.objectContaining({ provider: 'real', status: 503, action: 'paused_until_review', recordedAt: expect.any(String), endpointKey: expect.stringMatching(/^request-safety:v1:[a-f0-9]{64}$/) }))
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/secret|private response|provider\.test/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('distinguishes another pending reservation from a confirmed 5xx, without sending HTTP', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const pendingStore = { ...store, reserve: async () => ({ owner: 'another-invocation' }) }
    await expect(guardedUpstreamFetch('real', 'https://provider.test/pending', {}, pendingStore)).rejects.toMatchObject({ pending: true, retryable: false })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(Array.from({ length: 100 }, (_, index) => 500 + index))('blocks %i across fresh callers and query variants', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(guardedUpstreamFetch('real', 'https://provider.test/earnings?day=1', {}, store)).rejects.toMatchObject({ upstreamStatus: status, retryable: false })
    await expect(guardedUpstreamFetch('real', 'https://provider.test/earnings?day=2', {}, store)).rejects.toMatchObject({ upstreamStatus: status, retryable: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('releases successful and non-5xx responses without imposing a rate quota', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 })).mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    expect((await guardedUpstreamFetch('real', 'https://provider.test/a', {}, store)).status).toBe(429)
    await guardedUpstreamFetch('real', 'https://provider.test/a', {}, store)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('serializes concurrent same-family calls and blocks queued work after a 5xx', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 502 }))
    vi.stubGlobal('fetch', fetcher)
    const results = await Promise.allSettled([1, 2, 3].map((id) => guardedUpstreamFetch('real', `https://provider.test/a?id=${id}`, {}, store)))
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('retains an uncertain request and does not probe again', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('connection lost'))
    vi.stubGlobal('fetch', fetcher)
    await expect(guardedUpstreamFetch('real', 'https://provider.test/a', {}, store)).rejects.toMatchObject({ retryable: false })
    await expect(guardedUpstreamFetch('real', 'https://provider.test/a?force=true', {}, store)).rejects.toMatchObject({ retryable: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails closed if durable storage cannot admit a request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(guardedUpstreamFetch('real', 'https://provider.test/a', {}, { ...store, reserve: async () => { throw new Error('storage down') } })).rejects.toMatchObject({ retryable: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('blocks the known failed UFC path before storage or network access', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(guardedUpstreamFetch('real', 'https://web.realapp.com/home/ufc/day?day=2026-11-01', {}, store)).rejects.toMatchObject({ upstreamStatus: 500, retryable: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps unrelated endpoint families available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response('{}')))
    await expect(guardedUpstreamFetch('real', 'https://provider.test/a', {}, store)).rejects.toThrow()
    expect((await guardedUpstreamFetch('real', 'https://provider.test/b', {}, store)).ok).toBe(true)
  })

  it('keeps a stored failure blocked after loading a fresh transport instance', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(guardedUpstreamFetch('real', 'https://provider.test/persistent', {}, store)).rejects.toThrow()
    vi.resetModules()
    const { guardedUpstreamFetch: fresh } = await import('./guardedUpstreamFetch')
    await expect(fresh('real', 'https://provider.test/persistent?newSession=1', {}, store)).rejects.toMatchObject({ upstreamStatus: 500 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
