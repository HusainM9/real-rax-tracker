import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { CatalogImportProfile } from '../lib/catalogApi'
import { defaultRankExcludedSportSeasonKeys, rankAndRecommendAsync, recommendationCapsForSports } from '../lib/passRecommendation'
import { createEmptyData, normalizeData } from '../lib/storage'
import { importFromUsername } from '../lib/usernameImport'
import { benchmarkHash, probePackRatings } from '../testing/previewBenchmarks'
import { SPORTS, type RaxTrackerData, type Sport } from '../types/rax'

/** Enabled for one protected preview build only; deliberately outside RaxDataProvider. */
export default function PreviewPerformancePage() {
  const [data, setData] = useState<RaxTrackerData | null>(null)
  const [profiles, setProfiles] = useState<CatalogImportProfile[]>([])
  const [sports, setSports] = useState<Sport[]>(['NBA'])
  const [size, setSize] = useState(3)
  const [username, setUsername] = useState('gordon')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [report, setReport] = useState<unknown>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const load = async (event: ChangeEvent<HTMLInputElement>, kind: 'collection' | 'catalog') => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (kind === 'collection') setData(normalizeData(parsed.data ?? parsed))
      else if (Array.isArray(parsed.profiles)) setProfiles(parsed.profiles)
      else throw new Error('Expected a catalog profiles file.')
      setStatus(`Loaded ${kind} in memory. Nothing saved to your account.`)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid file.') }
  }
  const run = async (job: (signal: AbortSignal) => Promise<unknown>) => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setBusy(true); setReport(null); setStatus('Running…')
    try { const result = await job(next.signal); if (!next.signal.aborted) { setReport(result); setStatus('Complete') } }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Probe failed.') }
    finally { setBusy(false) }
  }
  const rank = () => run(async (signal) => {
    if (!data) throw new Error('Load an isolated collection first.')
    const pool = profiles.filter((profile) => sports.includes(profile.sport as Sport))
    const samples = []
    for (let iteration = 0; iteration < 6; iteration++) {
      const start = performance.now()
      const result = await rankAndRecommendAsync(data, pool, size, {
        caps: recommendationCapsForSports(sports), excludedSportSeasonKeys: defaultRankExcludedSportSeasonKeys(), signal,
      })
      const ms = performance.now() - start
      samples.push({ iteration, ms, requested: size, actual: result.bundle.picks.length, analyzed: result.ranked.analyzedCount, trimmed: result.ranked.prefilterTrimmed, rankingHash: await benchmarkHash(result.ranked.rows), picksHash: await benchmarkHash(result.bundle.picks), gain: result.bundle.combinedNetDelta, guaranteedGain: result.bundle.picks.reduce((sum, pick) => sum + pick.netGuaranteedDelta, 0) })
      setReport({ sports, pool: pool.length, samples }); setStatus(`Ranking ${iteration + 1}/6`)
    }
    return { mode: 'deployed-browser-recorded-pool', sports, pool: pool.length, cards: data.cards.length, rows: data.performances.length, samples }
  })
  const importCollection = () => run(async (signal) => {
    const samples = []
    for (let iteration = 0; iteration < 6; iteration++) {
      const start = performance.now()
      const result = await importFromUsername(createEmptyData(), username, { signal })
      const ms = performance.now() - start
      const keys = new Map(result.data.cards.map((card) => [card.id, card.externalKey]))
      const rows = result.data.performances.map((row) => [keys.get(row.cardId), row.claimDay, row.raxEarned]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      samples.push({ iteration, ms, cards: result.data.cards.length, rows: result.data.performances.length, failures: result.result.passFetchErrors.length, backfill: result.result.dailyRaxBackfill, hash: await benchmarkHash(rows) })
      setReport(samples); setStatus(`Collection import ${iteration + 1}/6`)
    }
    return { mode: 'deployed-memory-only-import', samples }
  })

  return <main className="page-shell">
    <h1>Protected preview performance checks</h1>
    <p>Memory only. No account collection or Plan writes. Local files stay in this tab; no fixture upload endpoint exists. Closing the tab discards them.</p>
    <p>This page is build-flagged, absent from normal navigation and excluded from the normal production build.</p>
    <section className="panel">
      <label>Collection fixture <input type="file" accept=".json" disabled={busy} onChange={(event) => void load(event, 'collection')} /></label>
      <label>Catalog pool <input type="file" accept=".json" disabled={busy} onChange={(event) => void load(event, 'catalog')} /></label>
      <p>{data ? `${data.cards.length} cards · ${data.performances.length} rows` : 'No collection loaded'} · {profiles.length} catalog profiles</p>
      <div className="sort-controls">{SPORTS.filter((sport) => sport !== 'Other').map((sport) => <label key={sport}><input type="checkbox" aria-label={sport} disabled={busy} checked={sports.includes(sport)} onChange={() => setSports((current) => current.includes(sport) ? current.filter((item) => item !== sport) : [...current, sport])} />{sport}</label>)}</div>
      <label>Bundle size <select aria-label="Bundle size" value={size} disabled={busy} onChange={(event) => setSize(Number(event.target.value))}>{[1, 3, 5, 10, 20].map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className="button" disabled={busy || !data || !profiles.length || !sports.length} onClick={() => void rank()}>Measure rankings (6 runs)</button>
    </section>
    <section className="panel">
      <label>Real username <input aria-label="Real username" value={username} disabled={busy} onChange={(event) => setUsername(event.target.value)} /></label>
      <button className="button" disabled={busy || !username.trim()} onClick={() => void run((signal) => probePackRatings(username, signal, (samples) => { setReport(samples); setStatus(`Packs ${samples.length}/10`) }))}>Measure Packs (10 reads)</button>
      <button className="button" disabled={busy || !username.trim()} onClick={() => void importCollection()}>Measure collection import (6 memory-only runs)</button>
    </section>
    {busy ? <button className="button" onClick={() => controller.current?.abort()}>Cancel probe</button> : null}
    <p role="status">{status}</p><pre data-testid="performance-report" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report ? JSON.stringify(report, null, 2) : ''}</pre>
  </main>
}
