import { useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { computeClaimDayResults, computeYearRollup } from '../lib/claimOptimizer'
import { displayRaxValue } from '../lib/displayRax'
import { formatClaimDay, formatRax } from '../lib/format'
import { dismissOnboarding, isOnboardingDismissed } from '../lib/onboarding'
import { useRaxData } from '../context/RaxDataContext'

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
  const [showOnboarding, setShowOnboarding] = useState(
    () => data.cards.length === 0 && !isOnboardingDismissed(),
  )
  const claimResults = useMemo(() => computeClaimDayResults(data), [data])
  const rollup = useMemo(() => computeYearRollup(data, claimResults), [data, claimResults])
  const bestDays = useMemo(
    () => [...claimResults].sort((a, b) => b.totalClaimableRax - a.totalClaimableRax).slice(0, 6),
    [claimResults],
  )

  const onExport = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `real-rax-tracker-backup.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const onImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    file.text().then((text) => {
      try {
        importJson(text)
      } catch {
        alert('Import failed. Please choose a valid RAX tracker JSON file.')
      }
    })
  }

  const onReset = () => {
    if (
      window.confirm(
        'Clear all cards, RAX entries, and settings? Export a backup first if you need one.',
      )
    ) {
      resetAll()
      setShowOnboarding(true)
    }
  }

  const closeOnboarding = () => {
    dismissOnboarding()
    setShowOnboarding(false)
  }

  return (
    <div className="page-stack">
      {showOnboarding ? (
        <section className="panel onboarding-panel">
          <div className="section-heading">
            <div>
              <h2>Getting started</h2>
              <p>Three steps to plan your RAX On This Day claims.</p>
            </div>
            <button className="button" type="button" onClick={closeOnboarding}>
              Dismiss
            </button>
          </div>
          <ol className="onboarding-steps">
            <li>
              <strong>Import or add cards</strong> — use username import while realapp.tools is
              available, then add future cards manually or from cached earnings.
            </li>
            <li>
              <strong>Check the Dashboard</strong> — see claimable vs overlapped RAX across your
              collection and toggle Pro bonus if you use it.
            </li>
            <li>
              <strong>Plan with Calendar and Overlaps</strong> — pick the best claim days and
              spot wasted RAX before you spend in the app.
            </li>
          </ol>
          <div className="button-row">
              <Link className="button primary" to="/entry">
                Import / add cards
            </Link>
            <Link className="button" to="/help">
              How it works
            </Link>
          </div>
        </section>
      ) : null}

      <section className="hero-card">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Know what to claim before overlaps waste RAX.</h2>
          <p>
            Each OTD day shows which player cards are claimable vs overlapped. The calendar groups
            by month/day so you can plan across your full collection.
          </p>
          <p className="import-hint">
            Your collection auto-saves to your signed-in account. Export JSON anytime for an extra
            backup.
          </p>
        </div>
        <div className="hero-actions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={data.settings.proBonusEnabled}
              onChange={(event) => setSettings({ proBonusEnabled: event.target.checked })}
            />
            Include Pro bonus claim
          </label>
          <div className="button-row">
            <Link className="button primary" to="/entry">
              Import / add RAX
            </Link>
            <Link className="button" to="/overlaps">
              Review overlaps
            </Link>
            <button className="button" type="button" onClick={onExport}>
              Export JSON
            </button>
            <label className="button">
              Import JSON
              <input className="sr-only" type="file" accept="application/json,.json" onChange={onImport} />
            </label>
            <button className="button danger" type="button" onClick={onReset}>
              Clear all data
            </button>
          </div>
        </div>
      </section>

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
              No claim days yet. <Link to="/entry">Import or add cards</Link> to get started.
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
