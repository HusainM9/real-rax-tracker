import { useEffect, useState } from 'react'
import { ERROR_KINDS, ERROR_SOURCES, errorOperationLabel, errorSummary, type OperationalError } from '../../../lib/operationalErrorTypes'
import { safeFetch } from '../../lib/safeImportFetch'

type History = { events: OperationalError[]; confirmed: OperationalError[]; total: number; nextCursor: string | null; partialSearch: boolean }
const sourceLabels = { real: 'Real', tracker: 'Tracker', storage: 'Storage', catalog: 'Catalog', notification: 'Notifications', browser: 'Browser' }
const kindLabels = { http: 'HTTP errors', network: 'Network', timeout: 'Timeouts', unexpected: 'Unexpected errors', invalid_response: 'Unreadable responses', blocked: 'Protected operations', cancelled: 'Cancelled operations' }
const initialFilters = { query: '', source: '', kind: '', status: '', from: '', to: '' }
const time = (at: string | null) => at ? new Date(at).toLocaleString() : 'Exact time unknown'

export default function AdminErrors() {
  const [history, setHistory] = useState<History | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(initialFilters)
  const [filters, setFilters] = useState(initialFilters)
  const [cursor, setCursor] = useState<string>()
  const [previous, setPrevious] = useState<Array<string | undefined>>([])
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void (async () => {
      try {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim())
        if (cursor) params.set('cursor', cursor)
        const response = await safeFetch(`/api/admin/errors?${params}`, { credentials: 'include', signal: controller.signal })
        if (!response.ok) throw new Error(response.status === 401 ? 'Admin session required. Sign in again to read saved history.' : 'Error history is temporarily unavailable. Existing records and Real protections are retained.')
        const body = await response.json() as History
        if (!Array.isArray(body.events) || !Array.isArray(body.confirmed) || !Number.isSafeInteger(body.total)) throw new Error('Error history is temporarily unavailable. Existing records and Real protections are retained.')
        if (!controller.signal.aborted) setHistory(body)
      } catch (failure) {
        if (!controller.signal.aborted) { setHistory(null); setError(failure instanceof Error ? failure.message : 'Error history is temporarily unavailable.') }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [filters, cursor, refresh])
  const resetPage = () => { setCursor(undefined); setPrevious([]) }
  const field = (name: keyof typeof initialFilters, value: string) => setDraft(current => ({ ...current, [name]: value }))
  return (
    <div className="admin-errors-view" aria-busy={loading}>
      <div className="admin-history-toolbar"><p>Saved error history · No automatic expiry</p><button className="button compact" type="button" disabled={loading} onClick={() => { resetPage(); setRefresh(value => value + 1) }}>{loading ? 'Reading history…' : 'Refresh history'}</button></div>
      {error ? <p className="admin-history-alert" role="alert">{error}</p> : null}
      <div className="admin-summary">
        <div className="is-critical"><span>Confirmed Real 500</span><strong>{history ? history.confirmed.length.toLocaleString() : '—'}</strong><small>Permanent safety records</small></div>
        <div><span>Recorded error events</span><strong>{history ? history.total.toLocaleString() : '—'}</strong><small>All sources and error types</small></div>
        <div><span>Retention</span><strong>Indefinite</strong><small>Kept across refreshes and releases</small></div>
      </div>
      <section className="panel admin-critical-history">
        <div className="admin-panel-heading"><div><h2>Highest priority</h2><p>Confirmed Real 500 incidents retain their original evidence and endpoint protection.</p></div>{history ? <span className="admin-error-tag is-critical">{history.confirmed.length} protected {history.confirmed.length === 1 ? 'endpoint' : 'endpoints'}</span> : null}</div>
        {!history ? <p className="admin-history-note">{loading ? 'Reading saved incident records…' : 'Saved incident list unavailable. The known UFC daily-games protection remains in place.'}</p> : history.confirmed.length === 0 ? <p className="admin-history-note">No additional confirmed incidents in the saved history.</p> : history.confirmed.map(event => (
          <article className="admin-critical-record" key={event.endpointKey ?? event.id}>
            <div><span className="admin-error-tag is-critical">Confirmed Real · HTTP 500</span><h3>{errorOperationLabel(event.operation)}</h3><p>This endpoint remains paused. Viewing history does not repeat the failed request.</p></div>
            <div className="admin-critical-meta"><strong>Permanent safety record</strong><time>{time(event.at)}</time><code>{event.incidentId ?? event.id}</code></div>
          </article>
        ))}
      </section>
      <section className="panel admin-error-history">
        <div className="admin-panel-heading"><div><h2>Error history</h2><p>All error types, with a clear source and observed status.</p></div><span className="admin-error-tag">Newest first</span></div>
        <form className="admin-error-filters" onSubmit={event => { event.preventDefault(); resetPage(); setFilters({ ...draft }) }}>
          <label className="field admin-history-search"><span>Search history</span><input name="query" type="search" placeholder="Operation, summary or reference…" maxLength={200} value={draft.query} onChange={event => field('query', event.target.value)} /></label>
          <label className="field"><span>Source</span><select name="source" value={draft.source} onChange={event => field('source', event.target.value)}><option value="">All sources</option>{ERROR_SOURCES.map(source => <option key={source} value={source}>{sourceLabels[source]}</option>)}</select></label>
          <label className="field"><span>Type</span><select name="kind" value={draft.kind} onChange={event => field('kind', event.target.value)}><option value="">All errors</option><option value="confirmed">Confirmed Real 500</option>{ERROR_KINDS.map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></label>
          <label className="field"><span>HTTP status</span><input name="status" type="number" min={100} max={599} placeholder="Any" value={draft.status} onChange={event => field('status', event.target.value)} /></label>
          <button className="button" type="submit" disabled={loading}>Search</button>
          <details className="admin-history-dates"><summary>Date range{filters.from || filters.to ? ' · active' : ''}</summary><div><label className="field"><span>From</span><input name="from" type="date" value={draft.from} onChange={event => field('from', event.target.value)} /></label><label className="field"><span>Through</span><input name="to" type="date" min={draft.from || undefined} value={draft.to} onChange={event => field('to', event.target.value)} /></label></div></details>
        </form>
        {loading ? <p className="admin-history-note" role="status">Reading saved history…</p> : null}
        {!loading && history && history.events.length === 0 ? <p className="admin-history-note">{history.nextCursor ? 'No matches in this segment. Search older records to continue through saved history.' : history.total ? 'No errors match these filters.' : 'No errors recorded in the new journal yet. Existing confirmed Real 500 evidence is shown above.'}</p> : null}
        {history && history.events.length > 0 ? <div className="table-wrap admin-error-table-wrap"><table className="admin-error-table"><thead><tr><th>When</th><th>Source / status</th><th>Error</th><th>Reference</th></tr></thead><tbody>{history.events.map(event => (
          <tr key={`${event.reported}:${event.id}`} className={event.confirmedReal500 ? 'is-critical' : ''}>
            <td data-label="When"><time>{time(event.at)}</time></td>
            <td data-label="Source / status"><strong>{sourceLabels[event.source]}{event.status !== undefined ? ` · ${event.status}` : ''}</strong><small>{event.reported ? 'Browser report' : event.status === undefined ? 'HTTP status unknown' : 'Server observation'}</small></td>
            <td data-label="Error"><strong>{errorOperationLabel(event.operation)}</strong><small>{errorSummary(event)}</small><details><summary>View safe details</summary><dl><div><dt>Type</dt><dd>{kindLabels[event.kind]}</dd></div><div><dt>HTTP status</dt><dd>{event.status ?? 'Unknown'}</dd></div><div><dt>Evidence</dt><dd>{event.confirmedReal500 ? 'Confirmed Real HTTP 500' : event.reported ? 'Browser-reported event; provider status is unverified' : 'Recorded by the server'}</dd></div>{event.method ? <div><dt>Method</dt><dd>{event.method}</dd></div> : null}{event.endpointKey ? <div><dt>Family reference</dt><dd>{event.endpointKey}</dd></div> : null}</dl></details></td>
            <td data-label="Reference"><span className={`admin-error-tag${event.confirmedReal500 ? ' is-critical' : ''}`}>{event.confirmedReal500 ? 'Highest priority' : event.kind === 'blocked' ? 'Protected operation' : event.status === 401 || event.status === 403 ? 'Access' : 'Error'}</span><code>{event.incidentId ?? event.id}</code></td>
          </tr>
        ))}</tbody></table></div> : null}
        {history ? <div className="admin-history-pagination"><span>{history.events.length} matching {history.events.length === 1 ? 'event' : 'events'} in this segment{history.partialSearch ? ' · more history available' : ''}</span><div><button className="button compact" type="button" disabled={loading || previous.length === 0} onClick={() => { setCursor(previous.at(-1)); setPrevious(current => current.slice(0, -1)) }}>Previous</button><span>Page {previous.length + 1}</span><button className="button compact" type="button" disabled={loading || !history.nextCursor} onClick={() => { if (history.nextCursor) { setPrevious(current => [...current, cursor ?? history.nextCursor!.split(':').map((value, index) => index === 1 ? '0' : value).join(':')]); setCursor(history.nextCursor) } }}>{history.partialSearch ? 'Search older records' : 'Next'}</button></div></div> : null}
      </section>
    </div>
  )
}
