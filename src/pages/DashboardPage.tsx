import { lazy, Suspense, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { computeClaimDayResults, computeYearRollup } from '../lib/claimOptimizer'
import { displayRaxValue } from '../lib/displayRax'
import { formatClaimDay, formatRax } from '../lib/format'
import { useRaxData } from '../context/RaxDataContext'
import './DashboardPage.css'

const EntryPage = lazy(() => import('./EntryPage'))

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  )
}

export default function DashboardPage() {
  const { data, setSettings, exportJson, importJson, resetAll } = useRaxData()
  const [searchParams] = useSearchParams()
  const [showImport, setShowImport] = useState(() => searchParams.get('import') === '1')
  const claimResults = useMemo(() => computeClaimDayResults(data), [data])
  const rollup = useMemo(() => computeYearRollup(data, claimResults), [data, claimResults])
  const bestDays = useMemo(
    () => [...claimResults].sort((a, b) => b.totalClaimableRax - a.totalClaimableRax).slice(0, 6),
    [claimResults],
  )

  const exportBackup = () => {
    const url = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'real-rax-tracker-backup.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const importBackup = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void file.text().then((content) => {
      try { importJson(content) } catch { window.alert('Import failed. Please choose a valid RAX tracker JSON file.') }
    })
  }

  return (
    <div className="page-stack dashboard-page">
      <section className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">Your RAX at a glance</p>
          <h1>Dashboard</h1>
          <p>Your collection, claims, and next steps in one place.</p>
        </div>
        <button className="button primary" type="button" aria-expanded={showImport} aria-controls="dashboard-import" onClick={() => setShowImport((open) => !open)}>{showImport ? 'Close import' : 'Import / add cards'}</button>
      </section>
      {showImport ? <section id="dashboard-import"><Suspense fallback={<p>Loading import tools…</p>}><EntryPage /></Suspense><details className="dashboard-data-tools"><summary>Backup and claim settings</summary><label className="toggle"><input type="checkbox" checked={data.settings.proBonusEnabled} onChange={(event) => setSettings({ proBonusEnabled: event.target.checked })} /> Include Pro bonus claim</label><div className="button-row"><button className="button" type="button" onClick={exportBackup}>Export JSON</button><label className="button">Import JSON<input className="sr-only" type="file" accept="application/json,.json" onChange={importBackup} /></label><button className="button danger" type="button" onClick={() => { if (window.confirm('Clear all cards, RAX entries, and settings? Export a backup first if you need one.')) resetAll() }}>Clear all data</button></div></details></section> : null}

      <section className="stats-grid">
        <StatCard
          label="Claimable RAX"
          value={formatRax(displayRaxValue(rollup.totalClaimableRax))}
          hint="Guaranteed plus Pro bonus (if enabled)"
        />
        <StatCard
          label="Guaranteed RAX"
          value={formatRax(displayRaxValue(rollup.totalGuaranteedRax))}
          hint="Top two player cards per sport per day"
        />
        <StatCard
          label="Pro bonus RAX"
          value={formatRax(displayRaxValue(rollup.totalProBonusRax))}
          hint="Best remaining overlap across all sports (when toggle is on)"
        />
        <StatCard
          label="Overlapped RAX"
          value={formatRax(displayRaxValue(rollup.totalOverlapRax))}
          hint="Entered RAX that loses to higher cards the same day"
        />
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="section-heading">
            <h2>Best claim days</h2>
            <Link to="/calendar">Open calendar</Link>
          </div>
          {bestDays.length === 0 ? (
            <p className="empty">
              No claim days yet. Use Import / add cards above to get started.
            </p>
          ) : (
            <div className="list">
              {bestDays.map((day) => (
                <Link className="list-row" to={`/calendar?monthDay=${day.claimDay}`} key={day.claimDay}>
                  <span>
                    <strong>{formatClaimDay(day.claimDay)}</strong>
                    <small>{day.sports.length} sport{day.sports.length === 1 ? '' : 's'}</small>
                  </span>
                  <b>{formatRax(displayRaxValue(day.totalClaimableRax))} RAX</b>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="section-heading">
            <h2>Sport totals</h2>
            <Link to="/cards">Card totals</Link>
          </div>
          {rollup.sports.length === 0 ? (
            <p className="empty">
              Sport totals appear after you import or add player cards.{' '}
              <Link to="/help">Read the guide</Link>
            </p>
          ) : (
            <div className="list">
              {rollup.sports.map((sport) => (
                <div className="list-row" key={sport.sport}>
                  <span>
                    <strong>{sport.sport}</strong>
                    <small>{sport.guaranteedClaims} guaranteed claims</small>
                  </span>
                  <b>{formatRax(displayRaxValue(sport.totalClaimableRax))} RAX</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
