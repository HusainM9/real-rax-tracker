import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAccountAuth } from '../context/AccountAuthContext'
import { useRaxData } from '../context/RaxDataContext'
import { usernameImportDisabled } from '../lib/importShutdown'
import { reportImportAdminEvents } from '../lib/adminEvents'
import { getFailedPlayerPasses, type FailedPlayerPassImport, type UsernameImportProgress } from '../lib/usernameImport'
import type { EarningsBackfillPass } from '../lib/realEarningsImport'
import { failureStatus, isTerminalRequestFailure } from '../../lib/httpFailurePolicy'

/** Collection editing is import-only. Backup/restore remains on Dashboard. */
export default function EntryPage() {
  const { data, importFromUsername, retryFailedEarnings, setSettings } = useRaxData()
  const { username: accountUsername } = useAccountAuth()
  const [username, setUsername] = useState(accountUsername || data.settings.savedUsername || '')
  const [busy, setBusy] = useState<'import' | 'retry' | null>(null)
  const [status, setStatus] = useState('')
  const [hasPausedEndpoint, setHasPausedEndpoint] = useState(false)
  const [progress, setProgress] = useState<UsernameImportProgress | null>(null)
  const [failures, setFailures] = useState<FailedPlayerPassImport[]>([])
  const [retryable, setRetryable] = useState<EarningsBackfillPass[]>([])
  const controllerRef = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const disabled = usernameImportDisabled()
  const includeRare = Boolean(data.settings.importRarePasses)
  const includeEpic = Boolean(data.settings.importEpicPasses)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controllerRef.current?.abort() }
  }, [])

  const runImport = async (retry: boolean) => {
    if (busy || disabled || (retry ? retryable.length === 0 : !username.trim())) return
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(retry ? 'retry' : 'import')
    setStatus('')
    setProgress(null)
    if (!retry) { setFailures([]); setRetryable([]) }
    try {
      const options = { signal: controller.signal, onProgress: (value: UsernameImportProgress) => {
        if (mounted.current) setProgress(value)
      } }
      const result = retry
        ? await retryFailedEarnings(retryable, options)
        : await importFromUsername(username.trim(), { ...options, includeRare, includeEpic })
      if (!mounted.current) return
      setFailures(getFailedPlayerPasses(result))
      setRetryable(result.retryableEarningsPasses)
      const paused = result.passFetchErrors.some((failure) => failureStatus(failure) === 500 && isTerminalRequestFailure(failure))
      if (paused) setHasPausedEndpoint(true)
      if (!retry) void reportImportAdminEvents(username.trim(), result)
      const remaining = result.retryableEarningsPasses.length
      const prefix = result.dailyRaxBackfill?.cancelled ? 'Cancelled after importing' : retry ? 'Retry imported' : 'Imported'
      setStatus(`${prefix} ${result.rowsImported.toLocaleString()} RAX rows from ${result.passesFetched.toLocaleString()} passes. ${
        paused ? `The Real endpoint that returned 500 is paused.${remaining ? ` ${remaining} other passes can be attempted later.` : ''}` : remaining ? `${remaining} passes need another try.` : 'No retryable earnings failures.'
      }${result.passesWithNoEarnings.length ? ` ${result.passesWithNoEarnings.length} passes have no daily earnings yet.` : ''}`)
    } catch (error) {
      if (!mounted.current) return
      if (failureStatus(error) === 500 && isTerminalRequestFailure(error)) setHasPausedEndpoint(true)
      setStatus(error instanceof DOMException && error.name === 'AbortError'
        ? 'Import cancelled.' : error instanceof Error ? error.message : 'Import failed. Try again.')
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (mounted.current) { setBusy(null); setProgress(null) }
      }
    }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void runImport(false) }

  return <div className="page-stack">
    <form className="panel form-panel import-panel" onSubmit={submit}>
      <div className="section-heading"><div>
        <h2>Username import</h2>
        <p>Import your Real collection and daily earnings. Retry failed earnings without scanning your passes again.</p>
      </div><span className="badge">{hasPausedEndpoint ? 'Real endpoint paused' : disabled ? 'Unavailable' : 'Primary'}</span></div>
      <div className="form-grid">
        <label className="field"><span>Real username</span>
          <input value={username} placeholder="yourname" disabled={Boolean(busy)} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <div className="field import-tier-field"><span>Also import</span>
          <div className="import-tier-toggles" role="group" aria-label="Optional rarities">
            <label className={`import-tier-toggle${includeRare ? ' active' : ''}`}>
              <input type="checkbox" checked={includeRare} disabled={Boolean(busy) || disabled} onChange={(event) => setSettings({ importRarePasses: event.target.checked })} />
              <span className="import-tier-dot rare" aria-hidden="true" />Rare
            </label>
            <label className={`import-tier-toggle${includeEpic ? ' active' : ''}`}>
              <input type="checkbox" checked={includeEpic} disabled={Boolean(busy) || disabled} onChange={(event) => setSettings({ importEpicPasses: event.target.checked })} />
              <span className="import-tier-dot epic" aria-hidden="true" />Epic
            </label>
          </div>
        </div>
      </div>
      <p className="import-hint">Legendary+{includeRare ? ', Rare' : ''}{includeEpic ? ', Epic' : ''}. Import replaces your collection with current ownership; retry keeps the pass list unchanged. Export a backup from Dashboard before major changes.</p>
      {disabled ? <p className="import-status">Username import is unavailable. Your saved collection and Dashboard backups remain available.</p> : null}
      <div className="button-row">
        <button className="button primary" type="submit" disabled={Boolean(busy) || disabled || !username.trim()}>{busy === 'import' ? 'Importing…' : 'Import collection'}</button>
        {busy ? <button className="button" type="button" onClick={() => controllerRef.current?.abort()}>Cancel</button> : null}
        <Link className="button" to="/help">How it works</Link>
      </div>
      {progress ? <p className="import-progress" role="status">{progress.label}{progress.total > 0 ? ` · ${progress.current}/${progress.total}` : ''}</p> : null}
      {status ? <p className="import-status" role="status">{status}</p> : null}
      {hasPausedEndpoint ? <p className="import-status" role="alert">The Real endpoint that returned HTTP 500 remains blocked until operator review. Other imports and unrequested passes are still available; the server will not repeat the blocked endpoint. Previously saved collection data remains available.</p> : null}
      {failures.length > 0 && !busy ? <section className="import-failures">
        <p className="import-hint">{failures.length} player passes need attention. {hasPausedEndpoint ? 'Confirmed Real 500 failures are excluded from retry; other deferred passes remain available.' : 'Passes with no earnings stay in your collection; import again when earnings become available.'}</p>
        {retryable.length ? <button className="button primary" type="button" disabled={disabled} onClick={() => void runImport(true)}>Retry failed earnings ({retryable.length})</button> : null}
        <div className="table-wrap"><table><thead><tr><th>Player pass</th><th>Sport</th><th>Season</th><th>Issue</th></tr></thead><tbody>
          {failures.map((pass, index) => <tr key={`${pass.externalKey || pass.name}-${index}`}>
            <td>{pass.name}{pass.rarityLabel ? <small className="table-sub"> · {pass.rarityLabel}</small> : null}</td>
            <td>{pass.sport}</td><td>{pass.season || '—'}</td><td>{pass.detail}</td>
          </tr>)}
        </tbody></table></div>
      </section> : null}
      {status && !busy ? <div className="button-row"><Link className="button" to="/cards">Review cards</Link><Link className="button" to="/calendar">Open Calendar</Link></div> : null}
    </form>
  </div>
}
