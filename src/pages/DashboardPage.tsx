import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { computeClaimDayResults, computeYearRollup } from '../lib/claimOptimizer'
import {
  loadCloudSyncCredentials,
  saveCloudSyncCredentials,
} from '../lib/cloudSyncCredentials'
import { displayRaxValue } from '../lib/displayRax'
import { formatClaimDay, formatRax } from '../lib/format'
import { dismissOnboarding, isOnboardingDismissed } from '../lib/onboarding'
import {
  changeCloudProfilePin,
  formatCloudProfileMeta,
  loadCloudProfile,
  saveCloudProfile,
} from '../lib/profileSync'
import { SYNC_PIN_HELP, SYNC_PIN_MAX_LENGTH, stripSpacesFromSyncPinInput, validateSyncPin } from '../../lib/syncPinRules'
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
  const { data, setSettings, exportJson, importJson, replaceData, resetAll } = useRaxData()
  const [showOnboarding, setShowOnboarding] = useState(
    () => data.cards.length === 0 && !isOnboardingDismissed(),
  )
  const [cloudUsername, setCloudUsername] = useState(data.settings.savedUsername)
  const [cloudPassphrase, setCloudPassphrase] = useState('')
  const [cloudNewPassphrase, setCloudNewPassphrase] = useState('')
  const [rememberCloudSync, setRememberCloudSync] = useState(false)
  const [cloudStatus, setCloudStatus] = useState('')
  const [cloudBusy, setCloudBusy] = useState(false)
  const claimResults = useMemo(() => computeClaimDayResults(data), [data])
  const rollup = useMemo(() => computeYearRollup(data, claimResults), [data, claimResults])
  const previewCards = useMemo(
    () => data.cards.filter((card) => card.simulatedRarityLabel),
    [data.cards],
  )
  const baselineRollup = useMemo(() => {
    if (previewCards.length === 0) return null
    const baselineData = {
      ...data,
      cards: data.cards.map((card) => ({ ...card, simulatedRarityLabel: undefined })),
    }
    const baselineResults = computeClaimDayResults(baselineData)
    return computeYearRollup(baselineData, baselineResults)
  }, [data, previewCards.length])
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

  useEffect(() => {
    setCloudUsername(data.settings.savedUsername)
  }, [data.settings.savedUsername])

  useEffect(() => {
    const remembered = loadCloudSyncCredentials()
    if (!remembered) return
    setCloudUsername(remembered.username)
    setCloudPassphrase(remembered.passphrase)
    setRememberCloudSync(true)
  }, [])

  const persistRememberedCredentials = () => {
    if (!rememberCloudSync) {
      saveCloudSyncCredentials(null)
      return
    }
    const pin = cloudNewPassphrase ? cloudNewPassphrase : cloudPassphrase
    if (!cloudUsername.trim() || !pin) return
    saveCloudSyncCredentials({
      username: cloudUsername.trim(),
      passphrase: pin,
    })
  }

  const onSaveCloudProfile = async () => {
    const username = cloudUsername.trim()
    if (!username) {
      setCloudStatus('Enter your Real username before saving to the cloud.')
      return
    }
    const pinResult = validateSyncPin(cloudPassphrase)
    if (!pinResult.ok) {
      setCloudStatus(pinResult.error)
      return
    }

    setCloudBusy(true)
    setCloudStatus('')
    try {
      const result = await saveCloudProfile(username, pinResult.pin, data)
      setSettings({
        savedUsername: username,
        lastCloudSyncAt: result.meta.updatedAt,
      })
      persistRememberedCredentials()
      setCloudStatus(`Saved cloud profile · ${formatCloudProfileMeta(result.meta)}`)
    } catch (error) {
      setCloudStatus(error instanceof Error ? error.message : 'Could not save cloud profile.')
    } finally {
      setCloudBusy(false)
    }
  }

  const onLoadCloudProfile = async () => {
    const username = cloudUsername.trim()
    if (!username) {
      setCloudStatus('Enter your Real username before loading from the cloud.')
      return
    }
    const pinResult = validateSyncPin(cloudPassphrase)
    if (!pinResult.ok) {
      setCloudStatus(pinResult.error)
      return
    }

    setCloudBusy(true)
    setCloudStatus('')
    try {
      const result = await loadCloudProfile(username, pinResult.pin)
      const replace = window.confirm(
        `Load cloud profile for @${username}? This replaces local cards, earnings, saved profiles, and settings on this device.\n\n${formatCloudProfileMeta(result.meta)}`,
      )
      if (!replace) {
        setCloudStatus('Cloud load cancelled.')
        return
      }
      replaceData({
        ...result.data,
        settings: {
          ...result.data.settings,
          savedUsername: username,
          lastCloudSyncAt: result.meta.updatedAt,
        },
      })
      persistRememberedCredentials()
      setCloudStatus(
        `Loaded ${result.data.cards.length} card${result.data.cards.length === 1 ? '' : 's'} and ${result.data.performances.length} earnings row${result.data.performances.length === 1 ? '' : 's'} into your collection. No username import needed — open Cards or Calendar to explore.`,
      )
    } catch (error) {
      setCloudStatus(error instanceof Error ? error.message : 'Could not load cloud profile.')
    } finally {
      setCloudBusy(false)
    }
  }

  const onChangeCloudPin = async () => {
    const username = cloudUsername.trim()
    if (!username) {
      setCloudStatus('Enter your Real username first.')
      return
    }
    const currentResult = validateSyncPin(cloudPassphrase)
    if (!currentResult.ok) {
      setCloudStatus(`Current PIN: ${currentResult.error}`)
      return
    }
    const newResult = validateSyncPin(cloudNewPassphrase)
    if (!newResult.ok) {
      setCloudStatus(`New PIN: ${newResult.error}`)
      return
    }

    setCloudBusy(true)
    setCloudStatus('')
    try {
      await changeCloudProfilePin(username, currentResult.pin, newResult.pin)
      setCloudPassphrase(newResult.pin)
      setCloudNewPassphrase('')
      if (rememberCloudSync) {
        saveCloudSyncCredentials({
          username: cloudUsername.trim(),
          passphrase: newResult.pin,
        })
      }
      setCloudStatus('Sync PIN updated. Use the new PIN on your other devices.')
    } catch (error) {
      setCloudStatus(error instanceof Error ? error.message : 'Could not change sync PIN.')
    } finally {
      setCloudBusy(false)
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

      {previewCards.length > 0 && baselineRollup ? (
        <section className="panel import-hint">
          <strong>Rarity preview active</strong> — {previewCards.length} card
          {previewCards.length === 1 ? '' : 's'} simulated at a higher rarity. Claimable RAX:{' '}
          {formatRax(baselineRollup.totalClaimableRax)} →{' '}
          {formatRax(rollup.totalClaimableRax)} (
          {rollup.totalClaimableRax >= baselineRollup.totalClaimableRax ? '+' : ''}
          {formatRax(rollup.totalClaimableRax - baselineRollup.totalClaimableRax)}). Clear previews on{' '}
          <Link to="/cards">Cards</Link> or <Link to="/entry">Entry</Link>.
        </section>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Cloud profile</h2>
            <p>
              Save your full tracker state to the server and load it on another device. Uses your
              Real @username plus a private sync PIN you choose.
            </p>
          </div>
        </div>
        <p className="import-hint">
          Cloud sync stores cards, earnings, saved profiles, potential cards, and settings.{' '}
          <strong>Load from cloud</strong> replaces your local collection — you do not need a
          separate username import afterward. Cached player earnings, sell-ranking snapshots, and
          original JSON pastes are omitted to save space. Your sync PIN is required to load or save.
          After an admin reset, sign in with
          the PIN they gave you, then use <strong>Change sync PIN</strong> below to pick your own.
          Forgot your PIN? Ask an admin to reset it.
        </p>
        <div className="sort-controls">
          <label className="field inline-field">
            <span>Real username</span>
            <input
              type="text"
              value={cloudUsername}
              disabled={cloudBusy}
              placeholder="username"
              onChange={(event) => setCloudUsername(event.target.value.replace(/^@/, ''))}
            />
          </label>
          <label className="field inline-field">
            <span>Sync PIN</span>
            <input
              type="password"
              value={cloudPassphrase}
              disabled={cloudBusy}
              placeholder="Current PIN"
              autoComplete="off"
              spellCheck={false}
              maxLength={SYNC_PIN_MAX_LENGTH}
              onChange={(event) =>
                setCloudPassphrase(stripSpacesFromSyncPinInput(event.target.value))
              }
            />
            <small className="field-hint">{SYNC_PIN_HELP}</small>
          </label>
        </div>
        <div className="sort-controls">
          <label className="field inline-field">
            <span>New sync PIN</span>
            <input
              type="password"
              value={cloudNewPassphrase}
              disabled={cloudBusy}
              placeholder="Only for changing PIN"
              autoComplete="off"
              spellCheck={false}
              maxLength={SYNC_PIN_MAX_LENGTH}
              onChange={(event) =>
                setCloudNewPassphrase(stripSpacesFromSyncPinInput(event.target.value))
              }
            />
            <small className="field-hint">Leave blank unless changing PIN. {SYNC_PIN_HELP}</small>
          </label>
        </div>
        <label className="toggle cloud-sync-remember">
          <input
            type="checkbox"
            checked={rememberCloudSync}
            disabled={cloudBusy}
            onChange={(event) => {
              const checked = event.target.checked
              setRememberCloudSync(checked)
              if (!checked) saveCloudSyncCredentials(null)
            }}
          />
          Remember sync PIN on this device
        </label>
        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={cloudBusy}
            onClick={() => void onSaveCloudProfile()}
          >
            {cloudBusy ? 'Saving…' : 'Save to cloud'}
          </button>
          <button
            className="button"
            type="button"
            disabled={cloudBusy}
            onClick={() => void onLoadCloudProfile()}
          >
            Load from cloud
          </button>
          <button
            className="button"
            type="button"
            disabled={cloudBusy || !cloudNewPassphrase}
            onClick={() => void onChangeCloudPin()}
          >
            Change sync PIN
          </button>
        </div>
        {data.settings.lastCloudSyncAt ? (
          <p className="import-hint">
            Last cloud sync on this device:{' '}
            {new Date(data.settings.lastCloudSyncAt).toLocaleString()}
          </p>
        ) : null}
        {cloudStatus ? <p className="import-status">{cloudStatus}</p> : null}
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
