import { createOperationalError, errorOperation, type ErrorKind, type OperationalError } from '../../lib/operationalErrorTypes'
import { safeFetch } from './safeImportFetch'
type BrowserInput = { kind: ErrorKind; operation?: string; status?: number }
type Reporter = (input: BrowserInput, reason?: unknown) => void | Promise<void>
export function createBrowserErrorReporter(send: (event: OperationalError) => Promise<unknown>, disabled = false): Reporter {
  const seen = new WeakSet<object>()
  return async (input, reason) => {
    if (disabled) return
    if (reason && typeof reason === 'object') { if (seen.has(reason)) return; seen.add(reason) }
    const event = createOperationalError({ source: 'browser', reported: true, kind: input.kind, operation: errorOperation(input.operation), status: input.status })
    try { await send(event) } catch { console.error('browser-error fallback', event) }
  }
}
export const reportBrowserError = createBrowserErrorReporter(async event => {
  const response = await safeFetch('/api/admin/error-report', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) })
  if (!response.ok) throw new Error('Error report was not saved.')
}, import.meta.env.DEV)
export function installRuntimeErrorReporting(report: Reporter = reportBrowserError): () => void {
  const operation = () => errorOperation(window.location.pathname)
  const error = (event: ErrorEvent) => { void report({ kind: 'unexpected', operation: operation() }, event.error) }
  const rejection = (event: PromiseRejectionEvent) => { void report({ kind: 'unexpected', operation: operation() }, event.reason) }
  window.addEventListener('error', error); window.addEventListener('unhandledrejection', rejection)
  return () => { window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection) }
}
