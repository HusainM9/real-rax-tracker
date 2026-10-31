// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { createBrowserErrorReporter, installRuntimeErrorReporting } from './browserErrorReporter'
it('reports only safe metadata once per error object and never retries a failed delivery', async () => {
  const send = vi.fn().mockRejectedValue(new Error('private logger failure'))
  const report = createBrowserErrorReporter(send)
  const reason = new Error('password=secret private stack https://private.invalid')
  await report({ kind: 'unexpected', operation: '/cards' }, reason)
  await report({ kind: 'unexpected', operation: '/cards' }, reason)
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]![0]).toMatchObject({ kind: 'unexpected', operation: '/cards', source: 'browser', reported: true })
  expect(JSON.stringify(send.mock.calls)).not.toMatch(/secret|private|stack|password/)
})
it('captures runtime failures without copying their messages or stacks and removes listeners', () => {
  const report = vi.fn()
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener')
  const dispose = installRuntimeErrorReporting(report)
  const error = new Error('private')
  const listener = add.mock.calls.find(call => call[0] === 'error')![1] as EventListener
  listener(new ErrorEvent('error', { message: 'password=secret', error }))
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unexpected' }), error)
  dispose(); report.mockClear()
  expect(remove).toHaveBeenCalledWith('error', listener)
  add.mockRestore(); remove.mockRestore()
})
