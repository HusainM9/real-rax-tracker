import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
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
import type { RaxTrackerData } from '../types/rax'
import type { CloudProfileMeta } from '../lib/profileSync'

type CloudConfirmDialog =
  | {
      action: 'save'
      username: string
      pin: string
      localSummary: string
    }
  | {
      action: 'load'
      username: string
      pin: string
      meta: CloudProfileMeta
      payload: RaxTrackerData
    }

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
  const [cloudConfirm, setCloudConfirm] = useState<CloudConfirmDialog | null>(null)
  const [cloudConfirmBusy, setCloudConfirmBusy] = useState(false)
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

  const onSaveCloudProfile = () => {
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

    const localSummary = `${data.cards.length} card${data.cards.length === 1 ? '' : 's'} · ${data.performances.length} earnings row${data.performances.length === 1 ? '' : 's'}`
    setCloudConfirm({
      action: 'save',
      username,
      pin: pinResult.pin,
      localSummary,
    })
  }

  const executeSaveCloudProfile = async () => {
    if (!cloudConfirm || cloudConfirm.action !== 'save') return

    setCloudConfirmBusy(true)
    setCloudStatus('')
    try {
      const result = await saveCloudProfile(cloudConfirm.username, cloudConfirm.pin, data)
      setSettings({
        savedUsername: cloudConfirm.username,
        lastCloudSyncAt: result.meta.updatedAt,
      })
      persistRememberedCredentials()
      setCloudStatus(`Saved cloud profile · ${formatCloudProfileMeta(result.meta)}`)
      setCloudConfirm(null)
    } catch (error) {
      setCloudStatus(error instanceof Error ? error.message : 'Could not save cloud profile.')
    } finally {
      setCloudConfirmBusy(false)
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
      setCloudConfirm({
        action: 'load',
        username,
        pin: pinResult.pin,
        meta: result.meta,
        payload: result.data,
      })
    } catch (error) {
      setCloudStatus(error instanceof Error ? error.message : 'Could not load cloud profile.')
    } finally {
      setCloudBusy(false)
    }
  }

  const executeLoadCloudProfile = () => {
    if (!cloudConfirm || cloudConfirm.action !== 'load') return

    replaceData({
      ...cloudConfirm.payload,
      settings: {
        ...cloudConfirm.payload.settings,
        savedUsername: cloudConfirm.username,
        lastCloudSyncAt: cloudConfirm.meta.updatedAt,
      },
    })
    persistRememberedCredentials()
    setCloudStatus(
      `Loaded ${cloudConfirm.payload.cards.length} card${cloudConfirm.payload.cards.length === 1 ? '' : 's'} and ${cloudConfirm.payload.performances.length} earnings row${cloudConfirm.payload.performances.length === 1 ? '' : 's'} into your collection. No username import needed — open Cards or Calendar to explore.`,
    )
    setCloudConfirm(null)
  }

  const cancelCloudConfirm = () => {
    if (cloudConfirmBusy || !cloudConfirm) return
    const action = cloudConfirm.action
    setCloudConfirm(null)
    setCloudStatus(action === 'save' ? 'Cloud save cancelled.' : 'Cloud load cancelled.')
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

      <section className="panel cloud-profile-panel">
        <div className="section-heading">
          <div>
            <h2>Cloud profile</h2>
            <p>Load your collection with your Real @username and sync PIN.</p>
          </div>
        </div>
        <div className="cloud-load-block">
          <div className="sort-controls cloud-load-fields">
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
          <button
            className="button primary cloud-load-button"
            type="button"
            disabled={cloudBusy}
            onClick={() => void onLoadCloudProfile()}
          >
            {cloudBusy ? 'Loading…' : 'Load from cloud'}
          </button>
          {data.settings.lastCloudSyncAt ? (
            <p className="import-hint cloud-load-meta">
              Last cloud sync on this device:{' '}
              {new Date(data.settings.lastCloudSyncAt).toLocaleString()}
            </p>
          ) : null}
          {cloudStatus ? <p className="import-status">{cloudStatus}</p> : null}
        </div>
        <p className="import-hint">
          Cloud sync stores cards, earnings, saved profiles, potential cards, and settings.{' '}
          <strong>Load from cloud</strong> replaces your local collection — you do not need a
          separate username import afterward. Cached player earnings, sell-ranking snapshots, and
          original JSON pastes are omitted to save space. Your sync PIN is required to load or save.
          After an admin reset, sign in with the PIN they gave you, then use{' '}
          <strong>Change sync PIN</strong> below to pick your own. Forgot your PIN? Ask an admin to
          reset it.
        </p>
        <p className="import-hint">
          <strong>Large collections (Mac / Safari):</strong> if the site forgets your data after
          refresh, your browser storage may be full or you may be in Private Browsing. After
          importing, use <strong>Save to cloud</strong> with your Real @username and a sync PIN —
          then <strong>Load from cloud</strong> on your next visit. Export JSON as an extra backup.
        </p>
        <div className="cloud-sync-advanced">
          <h3 className="cloud-sync-subheading">Save or change PIN</h3>
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
          <div className="button-row cloud-save-actions">
            <button
              className="button"
              type="button"
              disabled={cloudBusy}
              onClick={onSaveCloudProfile}
            >
              {cloudBusy ? 'Saving…' : 'Save to cloud'}
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
        </div>
      </section>

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

      {cloudConfirm?.action === 'save' ? (
        <ConfirmDialog
          title={`Save cloud profile for @${cloudConfirm.username}?`}
          titleId="cloud-save-confirm-title"
          confirmLabel={cloudConfirmBusy ? 'Saving…' : 'Save to cloud'}
          busy={cloudConfirmBusy}
          onConfirm={() => void executeSaveCloudProfile()}
          onCancel={cancelCloudConfirm}
        >
          <p>
            This overwrites any existing cloud copy for this username. Cards, earnings, saved
            profiles, potential cards, and settings on this device will be uploaded.
          </p>
          <p>
            Cached player earnings, sell-ranking snapshots, and original JSON pastes are not included.
          </p>
          <p className="confirm-dialog-summary">{cloudConfirm.localSummary}</p>
        </ConfirmDialog>
      ) : null}

      {cloudConfirm?.action === 'load' ? (
        <ConfirmDialog
          title={`Load cloud profile for @${cloudConfirm.username}?`}
          titleId="cloud-load-confirm-title"
          confirmLabel="Load profile"
          onConfirm={executeLoadCloudProfile}
          onCancel={cancelCloudConfirm}
        >
          <p>
            This replaces local cards, earnings, saved profiles, and settings on this device. You do
            not need a separate username import afterward.
          </p>
          <p className="confirm-dialog-summary">{formatCloudProfileMeta(cloudConfirm.meta)}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
