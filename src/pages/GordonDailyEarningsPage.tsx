import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { canUseGordonTools, LOCAL_DEV_ACCOUNT_USERNAME } from '../../lib/gordonAccess'
import { useAccountAuth } from '../context/AccountAuthContext'
import { useRaxData } from '../context/RaxDataContext'
import { displayRaxValue } from '../lib/displayRax'
import { formatClaimDay, formatRax } from '../lib/format'
import {
  calculateSeasonDailyForUsername,
  fetchGordonAccountList,
  loadSelectedGordonDailyAccounts,
  normalizeGordonDailyUsernames,
  parseGordonDailyUsernameInput,
  saveSelectedGordonDailyAccounts,
  seasonDailyAccountError,
  type GordonAccountProfileSummary,
  type SeasonDailyAccountSummary,
} from '../lib/gordonDailyEarnings'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { realDailyGameDay, realDailyPayoutDay } from '../lib/seasonDailyEarnings'

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  )
}

export default function GordonDailyEarningsPage() {
  const { username, devBypass } = useAccountAuth()
  if (!username || !canUseGordonTools(username, devBypass)) {
    return <Navigate to="/" replace />
  }
  return <GordonDailyEarningsContent ownUsername={username} localDev={devBypass} />
}

function GordonDailyEarningsContent({
  ownUsername,
  localDev,
}: {
  ownUsername: string
  localDev: boolean
}) {
  const { data, storageReady } = useRaxData()
  const [profiles, setProfiles] = useState<GordonAccountProfileSummary[]>([])
  const [profilesError, setProfilesError] = useState('')
  const [selected, setSelected] = useState(() => loadSelectedGordonDailyAccounts(ownUsername))
  const [addUsername, setAddUsername] = useState('')
  const [addError, setAddError] = useState('')
  const [calculating, setCalculating] = useState(false)
  const [status, setStatus] = useState('')
  const [results, setResults] = useState<SeasonDailyAccountSummary[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await fetchGordonAccountList()
        if (!cancelled) {
          setProfiles(list)
          setProfilesError('')
        }
      } catch (error) {
        if (!cancelled) {
          setProfilesError(error instanceof Error ? error.message : 'Could not load accounts.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setSelectedAccounts = useCallback(
    (usernames: string[]) => {
      const next = saveSelectedGordonDailyAccounts(usernames, ownUsername)
      setSelected(next)
      setAddError('')
    },
    [ownUsername],
  )

  const addAccount = (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseGordonDailyUsernameInput(addUsername)
    if (!parsed.ok) {
      setAddError(parsed.error)
      return
    }
    if (selected.includes(parsed.username)) {
      setAddError(`@${parsed.username} is already selected.`)
      return
    }
    setSelectedAccounts([...selected, parsed.username])
    setAddUsername('')
  }

  const toggleAccount = (username: string, checked: boolean) => {
    if (username === ownUsername) return
    if (checked) setSelectedAccounts([...selected, username])
    else setSelectedAccounts(selected.filter((value) => value !== username))
  }

  const calculate = useCallback(async () => {
    const usernames = normalizeGordonDailyUsernames(selected, ownUsername)
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    setCalculating(true)
    setStatus(`Calculating ${usernames.length} account${usernames.length === 1 ? '' : 's'}…`)

    const next: SeasonDailyAccountSummary[] = []
    setResults([])
    for (const username of usernames) {
      if (abort.signal.aborted) break
      const useLocal =
        localDev &&
        (username === ownUsername || username === LOCAL_DEV_ACCOUNT_USERNAME)
      const summary = await calculateSeasonDailyForUsername(username, {
        localData: useLocal ? data : undefined,
        signal: abort.signal,
        onProgress: (progress) => {
          setStatus(`@${username}: ${progress.label}`)
        },
      })
      if (abort.signal.aborted) break
      next.push(summary)
      setResults([...next])
    }

    if (abort.signal.aborted) return
    setCalculating(false)
    const failed = next.filter((item) => item.error).length
    const ok = next.length - failed
    setStatus(
      failed > 0
        ? `Calculated ${ok} account${ok === 1 ? '' : 's'}; ${failed} failed.`
        : `Calculated daily earnings for ${ok} account${ok === 1 ? '' : 's'}.`,
    )
  }, [data, localDev, ownUsername, selected])

  useEffect(() => {
    if (localDev && !storageReady) return
    void calculate()
    return () => abortRef.current?.abort()
    // Load today’s earnings once storage is ready; later runs are explicit Calculate clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady])

  const ready = useMemo(() => results.filter((item) => !item.error), [results])
  const gameDay = realDailyGameDay()
  const claimDay = ready[0]?.claimDay ?? gameDay
  const payoutDay = realDailyPayoutDay(claimDay)
  const combinedEarned = ready.reduce((sum, item) => sum + item.earnedRax, 0)
  const listedUsernames = useMemo(() => {
    const fromProfiles = profiles.map((profile) => profile.username)
    return normalizeGordonDailyUsernames([...fromProfiles, ...selected], ownUsername)
  }, [ownUsername, profiles, selected])
  const accountRows = useMemo(() => {
    const byUsername = new Map(results.map((summary) => [summary.username, summary]))
    return selected.map((username) => {
      const existing = byUsername.get(username)
      if (existing) return existing
      return seasonDailyAccountError(
        username,
        calculating ? 'Calculating…' : 'Click Calculate to load this account.',
        claimDay,
      )
    })
  }, [calculating, claimDay, results, selected])
  return (
    <div className="page-stack gordon-daily-page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Gordon tools</p>
          <h2>Daily earnings</h2>
          <p>
            Current estimated earnings from {formatClaimDay(claimDay)}, expected to post{' '}
            {formatClaimDay(payoutDay)} at 7am ET.
          </p>
        </div>
        <div className="hero-actions">
          <div className="button-row">
            <button className="button primary" type="button" onClick={() => void calculate()} disabled={calculating}>
              {calculating ? 'Calculating…' : 'Calculate daily earnings'}
            </button>
          </div>
          {status ? <p className="import-status">{status}</p> : null}
        </div>
      </section>

      <CollapsiblePanel
        title="Accounts"
        description={`${selected.map((username) => `@${username}`).join(', ')} · add usernames to compare today`}
        defaultOpen={false}
      >
        <div className="gordon-account-chips" aria-label="Selected accounts">
          {selected.map((username) => (
            <span className="gordon-account-chip" key={username}>
              @{username}
              {username === ownUsername ? <small>{localDev ? 'local' : 'you'}</small> : null}
              {username !== ownUsername ? (
                <button
                  type="button"
                  className="gordon-account-chip-remove"
                  aria-label={`Remove @${username}`}
                  onClick={() => toggleAccount(username, false)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>

        <form className="gordon-add-account" onSubmit={addAccount}>
          <label className="field">
            <span>Add account</span>
            <input
              value={addUsername}
              onChange={(event) => setAddUsername(event.target.value)}
              placeholder="@username"
              autoComplete="username"
            />
          </label>
          <button className="button" type="submit">
            Add
          </button>
        </form>
        {addError ? <p className="import-status import-status-error">{addError}</p> : null}
        {profilesError ? <p className="import-status import-status-error">{profilesError}</p> : null}

        {listedUsernames.length > 0 ? (
          <div className="gordon-account-checklist" role="group" aria-label="Registered accounts">
            {listedUsernames.map((username) => {
              const profile = profiles.find((entry) => entry.username === username)
              const checked = selected.includes(username)
              return (
                <label className="gordon-account-option" key={username}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={username === ownUsername}
                    onChange={(event) => toggleAccount(username, event.target.checked)}
                  />
                  <span>
                    <strong>@{username}</strong>
                    <small>
                      {username === ownUsername
                        ? localDev
                          ? 'This browser’s local collection'
                          : 'Your signed-in collection'
                        : profile
                          ? `${profile.cardCount} tracker card${profile.cardCount === 1 ? '' : 's'} on file`
                          : 'Calculate loads current Real passes for this username'}
                    </small>
                  </span>
                </label>
              )
            })}
          </div>
        ) : null}
      </CollapsiblePanel>

      <section className="stats-grid">
        <StatCard
          label="Game day"
          value={formatClaimDay(claimDay)}
          hint={`Payout ${formatClaimDay(payoutDay)} 7am ET`}
        />
        <StatCard
          label="Payout"
          value={formatClaimDay(payoutDay)}
          hint="Expected at 7am ET"
        />
        <StatCard
          label="Tomorrow RAX"
          value={formatRax(displayRaxValue(combinedEarned))}
          hint="Live box/plays calc · posts 7am ET tomorrow"
        />
        <StatCard
          label="Accounts"
          value={String(ready.length)}
          hint={`${selected.length} selected`}
        />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Account totals</h2>
            <p>What each account earns from today’s games. Real confirms it on the player link at 7am ET.</p>
          </div>
        </div>
        {accountRows.length === 0 ? (
          <p className="empty">Select at least one account.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Tomorrow RAX</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((summary) => (
                  <tr key={summary.username}>
                    <td>
                      <strong>@{summary.username}</strong>
                      <small className="table-sub">
                        {summary.error
                          ? summary.error
                          : `Payout ${formatClaimDay(realDailyPayoutDay(summary.claimDay))} at 7am ET`}
                      </small>
                    </td>
                    <td>{summary.error ? '—' : `${formatRax(displayRaxValue(summary.earnedRax))} RAX`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  )
}
