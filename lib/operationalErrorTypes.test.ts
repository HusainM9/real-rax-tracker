import { expect, it } from 'vitest'
import { createOperationalError, parseBrowserErrorReport, parseOperationalError, matchesOperationalError, errorOperationLabel } from './operationalErrorTypes'

it('stores only controlled metadata and classifies confirmed Real 500 separately', () => {
  const event = createOperationalError({ source: 'real', kind: 'http', status: 500, operation: 'real_request', endpointKey: `request-safety:v1:${'a'.repeat(64)}`, message: 'password=secret https://private.invalid?token=secret', headers: { cookie: 'secret' } } as never)
  expect(event.confirmedReal500).toBe(true)
  expect(JSON.stringify(event)).not.toMatch(/secret|private.invalid|cookie|message|headers/)
  expect(createOperationalError({ source: 'tracker', kind: 'http', status: 500 }).confirmedReal500).toBe(false)
  expect(createOperationalError({ source: 'real', kind: 'http', status: 503 }).confirmedReal500).toBe(false)
  expect(createOperationalError({ source: 'real', kind: 'network' }).status).toBeUndefined()
})
it('rejects forged browser authority and never stores client messages, URLs or timestamps', () => {
  const event = parseBrowserErrorReport({ id: crypto.randomUUID(), kind: 'http', operation: '/api/account/login?password=secret', source: 'real', status: 500, confirmedReal500: true, at: '2000-01-01', message: 'secret', stack: 'private', endpointKey: 'private' })!
  expect(event).toMatchObject({ source: 'browser', status: 500, reported: true, confirmedReal500: false, operation: 'application' })
  expect(JSON.stringify(event)).not.toMatch(/secret|private|2000-01-01/)
  expect(parseBrowserErrorReport({ id: 'bad', kind: 'unexpected' })).toBeNull()
})
it('rejects malformed stored events and preserves valid unknown status without guessing', () => {
  expect(parseOperationalError({ id: 'bad', source: 'real', status: 500 })).toBeNull()
  const event = createOperationalError({ source: 'storage', kind: 'timeout', operation: '/api/account/data' })
  expect(parseOperationalError(event)).toEqual(event)
  expect(event.confirmedReal500).toBe(false)
  expect(errorOperationLabel(event.operation)).toBe('Account data')
})
it('searches controlled metadata with source, status, type and date filters', () => {
  const event = createOperationalError({ source: 'real', kind: 'http', status: 429, operation: '/api/import/pack-ratings' })
  expect(matchesOperationalError(event, { query: 'packs 429', source: 'real', status: 429, kind: 'http', from: '2000-01-01', to: '2099-01-01' })).toBe(true)
  expect(matchesOperationalError(event, { source: 'tracker' })).toBe(false)
  expect(matchesOperationalError(event, { status: 500 })).toBe(false)
  expect(matchesOperationalError(event, { query: 'password' })).toBe(false)
})
