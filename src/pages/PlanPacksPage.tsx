import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { useRaxData } from '../context/RaxDataContext'
import {
  DEFAULT_PACK_RATING_INCREMENT,
  estimatePackProgress,
  formatMarkPackFinishedConfirmMessage,
  formatProjectedFinishDate,
  ICONIC_RATING_TARGET,
  normalizePackUsername,
} from '../lib/packTracker'
import { fetchPackRatings } from '../lib/packRatingsImport'
import type { PackAccountTemplate, PackTracker, PackTrackerAccount, PlannedPass } from '../types/rax'

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="stat-card panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className="table-sub">{hint}</small>
    </article>
  )
}

function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'Done'
  if (days === 1) return '1 day'
  return `${days} days`
}

function accountUsername(account: PackTrackerAccount): string {
  return normalizePackUsername(account.username)
}

function PackPassRow({
  pass,
  tracker,
  importBusy,
  importBusyLabel,
  importStatus,
  onEnsureTracker,
  onUpdateRatingPerPack,
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  onIgnoreMissing,
  onImportAccount,
  onImportAll,
  onMarkFinished,
}: {
  pass: PlannedPass
  tracker: PackTracker | undefined
  importBusy: boolean
  importBusyLabel: string
  importStatus: string
  onEnsureTracker: () => void
  onUpdateRatingPerPack: (value: number) => void
  onAddAccount: () => void
  onUpdateAccount: (
    accountId: string,
    patch: Partial<
      Pick<PackTrackerAccount, 'name' | 'rating' | 'opensPacks' | 'username'>
    >,
  ) => void
  onRemoveAccount: (accountId: string) => void
  onIgnoreMissing: (accountId: string) => void
  onImportAccount: (account: PackTrackerAccount) => void
  onImportAll: () => void
  onMarkFinished: () => void
}) {
  const estimate = tracker
    ? estimatePackProgress(tracker)
    : estimatePackProgress({
        accounts: [],
        ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
      })
  const accountCount = tracker?.accounts.length ?? 0
  const importableCount = tracker
    ? tracker.accounts.filter((account) => Boolean(accountUsername(account))).length
    : 0
  const [open, setOpen] = useState(false)
  const hasIncompleteOwnership = Boolean(
    tracker?.accounts.some(
      (account) => account.ownershipStatus === 'missing' && !account.ignoredMissing,
    ),
  )
  const showPassMissingWarn = hasIncompleteOwnership && !open

  const summary = !tracker
    ? `${pass.passKind === 'team' ? 'Team' : 'Player'} · ${pass.sport} · ${pass.season} · Not tracking yet`
    : [
        `${pass.sport} · ${pass.season}`,
        `${estimate.totalRating.toLocaleString()} / ${ICONIC_RATING_TARGET.toLocaleString()}`,
        formatDays(estimate.daysRemaining) === 'Done'
          ? 'Done'
          : `${formatDays(estimate.daysRemaining)} left`,
        `${accountCount} account${accountCount === 1 ? '' : 's'}`,
      ].join(' · ')

  return (
    <CollapsiblePanel
      className={`pack-tracker-row${showPassMissingWarn ? ' pack-tracker-row-incomplete' : ''}`}
      title={pass.name}
      description={summary}
      defaultOpen={false}
      open={open}
      onOpenChange={setOpen}
      badge={tracker && estimate.atTarget ? 'Iconic' : undefined}
      actions={
        !tracker ? (
          <button className="button compact" type="button" onClick={onEnsureTracker}>
            Track packs
          </button>
        ) : (
          <>
            <button
              className="button compact"
              type="button"
              disabled={importBusy || importableCount === 0}
              onClick={onImportAll}
            >
              {importBusyLabel || 'Import all'}
            </button>
            <button
              className="button danger compact"
              type="button"
              disabled={importBusy}
              onClick={onMarkFinished}
            >
              Finished
            </button>
          </>
        )
      }
    >
      {!tracker ? (
        <p className="import-hint">
          Import Real ratings for your accounts to track progress to Iconic ({ICONIC_RATING_TARGET}).
        </p>
      ) : (
        <div className="pack-tracker-body">
          <div className="pack-progress-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(estimate.progressRatio * 100)}%` }} />
          </div>

          <div className="pack-stat-strip">
            <div className="pack-stat">
              <span>Remaining</span>
              <strong>{estimate.remaining.toLocaleString()}</strong>
            </div>
            <div className="pack-stat">
              <span>Packs needed</span>
              <strong>{estimate.packsNeeded.toLocaleString()}</strong>
              <small>est. at {estimate.ratingPerPack}/pack</small>
            </div>
            <div className="pack-stat">
              <span>Days remaining</span>
              <strong>{formatDays(estimate.daysRemaining)}</strong>
              <small>
                {estimate.openingAccounts} open · est. {estimate.dailyGain}/day
              </small>
            </div>
            <label className="pack-stat pack-stat-input">
              <span>Rating / pack</span>
              <input
                type="number"
                min={1}
                step={1}
                value={tracker.ratingPerPack ?? DEFAULT_PACK_RATING_INCREMENT}
                onChange={(event) => onUpdateRatingPerPack(Number(event.target.value))}
                aria-label={`Rating per pack for ${pass.name}`}
              />
            </label>
          </div>

          <div className="pack-accounts">
            <div className="pack-accounts-header">
              <h4>Accounts</h4>
              <button className="button compact" type="button" onClick={onAddAccount}>
                Add account
              </button>
            </div>

            {tracker.accounts.length === 0 ? (
              <p className="import-hint">No accounts yet. Add one to start tracking.</p>
            ) : (
              <div className="pack-account-list">
                {tracker.accounts.map((account) => {
                  const showMissing =
                    account.ownershipStatus === 'missing' && !account.ignoredMissing
                  return (
                  <div
                    className={`pack-account-row${showMissing ? ' pack-account-row-missing' : ''}`}
                    key={account.id}
                  >
                    <label className="pack-account-field pack-account-name">
                      <span>Name</span>
                      <input
                        type="text"
                        value={account.name}
                        onChange={(event) =>
                          onUpdateAccount(account.id, { name: event.target.value })
                        }
                      />
                    </label>
                    <label className="pack-account-field pack-account-username">
                      <span>Real username</span>
                      <input
                        type="text"
                        placeholder="@username"
                        value={account.username ?? ''}
                        onChange={(event) =>
                          onUpdateAccount(account.id, { username: event.target.value })
                        }
                      />
                    </label>
                    <label className="pack-account-field pack-account-rating">
                      <span>Rating</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={account.rating}
                        onChange={(event) =>
                          onUpdateAccount(account.id, { rating: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="pack-opens-toggle">
                      <input
                        type="checkbox"
                        checked={account.opensPacks}
                        onChange={(event) =>
                          onUpdateAccount(account.id, { opensPacks: event.target.checked })
                        }
                      />
                      <span>Opens packs</span>
                    </label>
                    <div className="pack-account-actions">
                      <button
                        className="button compact"
                        type="button"
                        disabled={importBusy || !accountUsername(account)}
                        onClick={() => onImportAccount(account)}
                      >
                        Import this
                      </button>
                      <button
                        className="button danger compact"
                        type="button"
                        onClick={() => onRemoveAccount(account.id)}
                        disabled={tracker.accounts.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                    {showMissing ? (
                      <div className="pack-account-ownership-flag">
                        <p className="pack-account-ownership-warning">Doesn't own this pass</p>
                        <button
                          className="button compact"
                          type="button"
                          onClick={() => onIgnoreMissing(account.id)}
                        >
                          Ignore
                        </button>
                      </div>
                    ) : null}
                    {account.rarityLabel || account.lastImportedAt ? (
                      <p className="pack-account-import-meta">
                        {account.rarityLabel ? account.rarityLabel : null}
                        {account.rarityLabel && account.lastImportedAt ? ' · ' : null}
                        {account.lastImportedAt
                          ? `Imported ${new Date(account.lastImportedAt).toLocaleString()}`
                          : null}
                      </p>
                    ) : null}
                  </div>
                  )
                })}
              </div>
            )}

            {importStatus ? <p className="import-status">{importStatus}</p> : null}
          </div>

          {estimate.atTarget ? (
            <p className="import-hint plan-pass-status owned">Reached Iconic rating target.</p>
          ) : estimate.daysRemaining === null ? (
            <p className="import-hint plan-pass-status warning">
              No effective pack openers for estimates — enable “Opens packs” on an owned account, or
              Ignore missing ownership.
            </p>
          ) : null}
        </div>
      )}
    </CollapsiblePanel>
  )
}

export default function PlanPacksPage() {
  const {
    data,
    removePlannedPass,
    upsertPackTracker,
    trackAllUntrackedPlayerPacks,
    updatePackTracker,
    addPackTrackerAccount,
    updatePackTrackerAccount,
    removePackTrackerAccount,
    applyPackRatingsFromImport,
    addPackAccountTemplate,
    updatePackAccountTemplate,
    removePackAccountTemplate,
    applyPackAccountTemplatesToTracked,
  } = useRaxData()

  const [syncBusyUsername, setSyncBusyUsername] = useState('')
  const [syncAllProgress, setSyncAllProgress] = useState<{
    index: number
    total: number
  } | null>(null)
  const [syncStatus, setSyncStatus] = useState('')
  const [applyTemplatesStatus, setApplyTemplatesStatus] = useState('')
  const [trackAllStatus, setTrackAllStatus] = useState('')
  const [importBusyKey, setImportBusyKey] = useState('')
  const [importStatusByPass, setImportStatusByPass] = useState<Record<string, string>>({})

  const plannedPasses = data.plannedPasses ?? []
  const packTrackers = data.packTrackers ?? []
  const packAccountTemplates = data.packAccountTemplates ?? []
  const anyImportBusy = syncBusyUsername !== '' || importBusyKey !== ''
  const isSyncAllRunning = syncAllProgress !== null

  const playerPasses = useMemo(
    () => plannedPasses.filter((pass) => pass.passKind !== 'team'),
    [plannedPasses],
  )

  const knownUsernames = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    const pushUsername = (raw: string) => {
      if (!raw || /^account\s*\d*$/i.test(raw)) return
      const key = raw.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      list.push(raw)
    }
    for (const template of packAccountTemplates) {
      pushUsername(normalizePackUsername(template.username))
    }
    for (const tracker of packTrackers) {
      for (const account of tracker.accounts) {
        pushUsername(accountUsername(account))
      }
    }
    return list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [packAccountTemplates, packTrackers])

  const trackerByPassId = useMemo(() => {
    const map = new Map<string, PackTracker>()
    for (const tracker of packTrackers) {
      map.set(tracker.plannedPassId, tracker)
    }
    return map
  }, [packTrackers])

  const trackedEstimates = useMemo(() => {
    return packTrackers
      .filter((tracker) => playerPasses.some((pass) => pass.id === tracker.plannedPassId))
      .map((tracker) => estimatePackProgress(tracker))
  }, [packTrackers, playerPasses])

  const finishOrder = useMemo(() => {
    return playerPasses
      .map((pass) => {
        const tracker = trackerByPassId.get(pass.id)
        if (!tracker) return null
        const estimate = estimatePackProgress(tracker)
        return {
          pass,
          estimate,
          finishLabel: formatProjectedFinishDate(estimate.daysRemaining),
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => {
        if (a.estimate.daysRemaining === null && b.estimate.daysRemaining === null) {
          return a.pass.name.localeCompare(b.pass.name)
        }
        if (a.estimate.daysRemaining === null) return 1
        if (b.estimate.daysRemaining === null) return -1
        if (a.estimate.daysRemaining !== b.estimate.daysRemaining) {
          return a.estimate.daysRemaining - b.estimate.daysRemaining
        }
        return a.pass.name.localeCompare(b.pass.name)
      })
  }, [playerPasses, trackerByPassId])

  const summary = useMemo(() => {
    const tracked = trackedEstimates.length
    const complete = trackedEstimates.filter((estimate) => estimate.atTarget).length
    const soonest = trackedEstimates
      .map((estimate) => estimate.daysRemaining)
      .filter((days): days is number => days !== null)
      .sort((a, b) => a - b)[0]
    return { tracked, complete, soonest: soonest ?? null }
  }, [trackedEstimates])

  const untrackedPlayerPasses = useMemo(
    () => playerPasses.filter((pass) => !trackerByPassId.has(pass.id)),
    [playerPasses, trackerByPassId],
  )

  const trackAllUntracked = () => {
    if (untrackedPlayerPasses.length === 0) {
      setTrackAllStatus('All planned player passes are already tracked.')
      return
    }
    const result = trackAllUntrackedPlayerPacks()
    setTrackAllStatus(
      result.tracked > 0
        ? `Started tracking ${result.tracked} player pass${result.tracked === 1 ? '' : 'es'}.`
        : 'All planned player passes are already tracked.',
    )
  }

  const markPassFinished = (pass: PlannedPass) => {
    if (!window.confirm(formatMarkPackFinishedConfirmMessage(pass.name))) return
    removePlannedPass(pass.id)
    setImportStatusByPass((current) => {
      if (!(pass.id in current)) return current
      const next = { ...current }
      delete next[pass.id]
      return next
    })
  }

  const ratingsMapFromResult = (
    passes: Awaited<ReturnType<typeof fetchPackRatings>>['passes'],
  ) => {
    const ratingsByExternalKey: Record<string, { rating: number; rarityLabel?: string }> = {}
    for (const imported of passes) {
      if (imported.rating == null) continue
      ratingsByExternalKey[imported.externalKey] = {
        rating: imported.rating,
        rarityLabel: imported.rarityLabel,
      }
    }
    return ratingsByExternalKey
  }

  const runSyncUsername = async (
    rawUsername: string,
  ): Promise<
    | { ok: true; username: string; updatedAccounts: number; missingPasses: number }
    | { ok: false; username: string; error: string }
  > => {
    const username = rawUsername.replace(/^@/, '').trim()
    if (!username) {
      return { ok: false, username: rawUsername, error: 'Empty username.' }
    }
    try {
      const result = await fetchPackRatings(username)
      const ratingsByExternalKey = ratingsMapFromResult(result.passes)
      const applied = applyPackRatingsFromImport(result.username, ratingsByExternalKey, {
        ensureAccounts: true,
      })
      return {
        ok: true,
        username: result.username,
        updatedAccounts: applied.updatedAccounts,
        missingPasses: applied.missingPasses,
      }
    } catch (error) {
      return {
        ok: false,
        username,
        error: error instanceof Error ? error.message : 'Could not sync pack ratings.',
      }
    }
  }

  const syncAllTracked = async (rawUsername: string) => {
    const username = rawUsername.replace(/^@/, '').trim()
    if (!username) {
      setSyncStatus('Enter a Real username on an account below first.')
      return
    }
    if (packTrackers.length === 0) {
      setSyncStatus('Track at least one player pack before syncing.')
      return
    }

    setSyncBusyUsername(username)
    setSyncStatus(`Fetching ratings for @${username}…`)
    try {
      const outcome = await runSyncUsername(username)
      if (!outcome.ok) {
        setSyncStatus(outcome.error)
        return
      }
      setSyncStatus(
        outcome.updatedAccounts > 0
          ? `Synced ${outcome.updatedAccounts} account row${outcome.updatedAccounts === 1 ? '' : 's'} for @${outcome.username} across tracked passes.${outcome.missingPasses ? ` ${outcome.missingPasses} not owned.` : ''}`
          : `@${outcome.username} does not own any of your currently tracked passes.`,
      )
    } finally {
      setSyncBusyUsername('')
    }
  }

  const syncAllKnownUsernames = async () => {
    if (knownUsernames.length === 0) {
      setSyncStatus('Add a Real username on a shared account or pass row below, then sync from here.')
      return
    }
    if (packTrackers.length === 0) {
      setSyncStatus('Track at least one player pack before syncing.')
      return
    }

    const total = knownUsernames.length
    let syncedOk = 0
    let totalUpdated = 0
    let totalMissing = 0
    const errors: string[] = []

    try {
      for (let i = 0; i < knownUsernames.length; i++) {
        const username = knownUsernames[i]!
        setSyncBusyUsername(username)
        setSyncAllProgress({ index: i + 1, total })
        setSyncStatus(`Syncing @${username}… ${i + 1}/${total}`)

        const outcome = await runSyncUsername(username)
        if (!outcome.ok) {
          errors.push(`@${username}: ${outcome.error}`)
          continue
        }
        syncedOk += 1
        totalUpdated += outcome.updatedAccounts
        totalMissing += outcome.missingPasses
      }

      const parts = [
        `Synced ${syncedOk}/${total} account${total === 1 ? '' : 's'}.`,
      ]
      if (totalUpdated > 0) {
        parts.push(
          `Updated ${totalUpdated} account row${totalUpdated === 1 ? '' : 's'}.`,
        )
      }
      if (totalMissing > 0) {
        parts.push(`${totalMissing} not owned.`)
      }
      if (errors.length > 0) {
        parts.push(errors.join(' '))
      }
      setSyncStatus(parts.join(' '))
    } finally {
      setSyncBusyUsername('')
      setSyncAllProgress(null)
    }
  }

  const applySharedAccounts = () => {
    if (packAccountTemplates.length === 0) {
      setApplyTemplatesStatus('Add at least one shared account first.')
      return
    }
    if (packTrackers.length === 0) {
      setApplyTemplatesStatus('Track at least one player pack first, then apply.')
      return
    }
    const result = applyPackAccountTemplatesToTracked()
    if (result.trackersTouched === 0) {
      setApplyTemplatesStatus('All tracked passes already have these shared accounts.')
      return
    }
    const parts = [
      `Updated ${result.trackersTouched} tracked pass${result.trackersTouched === 1 ? '' : 'es'}.`,
    ]
    if (result.accountsAdded > 0) {
      parts.push(
        `Added ${result.accountsAdded} account${result.accountsAdded === 1 ? '' : 's'}.`,
      )
    }
    if (result.accountsUpdated > 0) {
      parts.push(
        `Updated ${result.accountsUpdated} existing row${result.accountsUpdated === 1 ? '' : 's'}.`,
      )
    }
    setApplyTemplatesStatus(parts.join(' '))
  }

  const importOneAccount = async (
    pass: PlannedPass,
    tracker: PackTracker,
    account: PackTrackerAccount,
  ) => {
    const username = accountUsername(account)
    if (!username || /^account\s*\d*$/i.test(username)) {
      setImportStatusByPass((current) => ({
        ...current,
        [pass.id]: 'Enter a Real username on the account before importing.',
      }))
      return
    }

    setImportBusyKey(`${tracker.id}:${account.id}`)
    setImportStatusByPass((current) => ({
      ...current,
      [pass.id]: `Fetching ratings for @${username}…`,
    }))

    try {
      const result = await fetchPackRatings(username)
      const ratingsByExternalKey = ratingsMapFromResult(result.passes)
      const match = ratingsByExternalKey[pass.externalKey]
      if (!match) {
        applyPackRatingsFromImport(result.username, ratingsByExternalKey, {
          plannedPassId: pass.id,
          accountId: account.id,
        })
        setImportStatusByPass((current) => ({
          ...current,
          [pass.id]: `@${result.username} does not own ${pass.name} (or rating was unavailable).`,
        }))
        return
      }
      applyPackRatingsFromImport(result.username, ratingsByExternalKey, {
        plannedPassId: pass.id,
        accountId: account.id,
      })
      setImportStatusByPass((current) => ({
        ...current,
        [pass.id]: `Imported ${match.rating.toLocaleString()} rating for ${pass.name} on @${result.username}${match.rarityLabel ? ` (${match.rarityLabel})` : ''}.`,
      }))
    } catch (error) {
      setImportStatusByPass((current) => ({
        ...current,
        [pass.id]: error instanceof Error ? error.message : 'Could not import pack ratings.',
      }))
    } finally {
      setImportBusyKey('')
    }
  }

  const importAllAccounts = async (pass: PlannedPass, tracker: PackTracker) => {
    const accounts = tracker.accounts.filter((account) => Boolean(accountUsername(account)))
    if (accounts.length === 0) {
      setImportStatusByPass((current) => ({
        ...current,
        [pass.id]: 'Add Real usernames on accounts before importing.',
      }))
      return
    }

    const byUsername = new Map<string, PackTrackerAccount[]>()
    for (const account of accounts) {
      const key = accountUsername(account).toLowerCase()
      const list = byUsername.get(key) ?? []
      list.push(account)
      byUsername.set(key, list)
    }

    setImportBusyKey(`${tracker.id}:all`)
    setImportStatusByPass((current) => ({
      ...current,
      [pass.id]: `Importing ${byUsername.size} account${byUsername.size === 1 ? '' : 's'} for ${pass.name}…`,
    }))

    let updated = 0
    let missing = 0
    const errors: string[] = []

    try {
      for (const [usernameKey, group] of byUsername) {
        const username = accountUsername(group[0]!) || usernameKey
        try {
          const result = await fetchPackRatings(username)
          const ratingsByExternalKey = ratingsMapFromResult(result.passes)
          if (!ratingsByExternalKey[pass.externalKey]) {
            missing += group.length
            applyPackRatingsFromImport(result.username, ratingsByExternalKey, {
              plannedPassId: pass.id,
            })
            continue
          }
          for (const account of group) {
            const applied = applyPackRatingsFromImport(result.username, ratingsByExternalKey, {
              plannedPassId: pass.id,
              accountId: account.id,
            })
            updated += applied.updatedAccounts
          }
        } catch (error) {
          errors.push(
            `@${username}: ${error instanceof Error ? error.message : 'import failed'}`,
          )
        }
      }

      const parts = [
        updated > 0
          ? `Imported ${updated} account${updated === 1 ? '' : 's'} for ${pass.name}.`
          : `No ratings imported for ${pass.name}.`,
      ]
      if (missing > 0) parts.push(`${missing} account${missing === 1 ? '' : 's'} do not own this pass.`)
      if (errors.length > 0) parts.push(errors.join(' '))
      setImportStatusByPass((current) => ({
        ...current,
        [pass.id]: parts.join(' '),
      }))
    } finally {
      setImportBusyKey('')
    }
  }

  return (
    <div className="page-stack plan-packs-page">
      <section className="hero-card">
        <p className="eyebrow">Daily player packs</p>
        <h1>Player packs</h1>
        <p>
          Track rating across accounts toward Iconic ({ICONIC_RATING_TARGET.toLocaleString()}). Sync a
          Real username to pull live play ratings for every tracked pass that account owns.
        </p>
        <div className="button-row">
          <Link className="button" to="/plan">
            Back to purchase plan
          </Link>
        </div>
      </section>

      <section className="panel pack-sync-panel">
        <div className="pack-sync-copy">
          <h2>Sync all tracked</h2>
          <p className="table-sub">
            Sync one Real account, or Sync all to walk each username one by one — pulls live ratings
            across every tracked player.
          </p>
        </div>
        {knownUsernames.length === 0 ? (
          <p className="import-hint">
            Add a Real username on a shared account or pass row below, then sync from here.
          </p>
        ) : (
          <div className="button-row pack-sync-accounts">
            <button
              className="button"
              type="button"
              disabled={anyImportBusy}
              onClick={() => void syncAllKnownUsernames()}
            >
              {isSyncAllRunning && syncAllProgress
                ? `Syncing @${syncBusyUsername}… ${syncAllProgress.index}/${syncAllProgress.total}`
                : 'Sync all'}
            </button>
            {knownUsernames.map((username) => (
              <button
                key={username.toLowerCase()}
                className="button"
                type="button"
                disabled={anyImportBusy}
                onClick={() => void syncAllTracked(username)}
              >
                {syncBusyUsername.toLowerCase() === username.toLowerCase()
                  ? `Syncing @${username}…`
                  : `Sync @${username}`}
              </button>
            ))}
          </div>
        )}
        {syncStatus ? <p className="import-status">{syncStatus}</p> : null}
      </section>

      <CollapsiblePanel
        className="pack-shared-accounts-panel"
        title="Shared accounts"
        description="Define your Real accounts once. New “Track packs” rows seed from these, or apply them to every tracked pass without retyping."
        defaultOpen={false}
        badge={`${packAccountTemplates.length}`}
        actions={
          <>
            <button className="button compact" type="button" onClick={() => addPackAccountTemplate()}>
              Add shared account
            </button>
            <button
              className="button compact"
              type="button"
              disabled={packAccountTemplates.length === 0 || packTrackers.length === 0}
              onClick={applySharedAccounts}
            >
              Apply shared accounts to all tracked passes
            </button>
          </>
        }
      >
        {packAccountTemplates.length === 0 ? (
          <p className="import-hint">
            No shared accounts yet. Add the accounts you open packs on, then apply to tracked
            passes.
          </p>
        ) : (
          <div className="pack-account-list">
            {packAccountTemplates.map((template: PackAccountTemplate) => (
              <div className="pack-account-row" key={template.id}>
                <label className="pack-account-field pack-account-name">
                  <span>Name</span>
                  <input
                    type="text"
                    value={template.name}
                    onChange={(event) =>
                      updatePackAccountTemplate(template.id, { name: event.target.value })
                    }
                  />
                </label>
                <label className="pack-account-field pack-account-username">
                  <span>Real username</span>
                  <input
                    type="text"
                    placeholder="@username"
                    value={template.username}
                    onChange={(event) =>
                      updatePackAccountTemplate(template.id, { username: event.target.value })
                    }
                  />
                </label>
                <label className="pack-opens-toggle">
                  <input
                    type="checkbox"
                    checked={template.opensPacks}
                    onChange={(event) =>
                      updatePackAccountTemplate(template.id, {
                        opensPacks: event.target.checked,
                      })
                    }
                  />
                  <span>Opens packs</span>
                </label>
                <div className="pack-account-actions">
                  <button
                    className="button danger compact"
                    type="button"
                    onClick={() => removePackAccountTemplate(template.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {applyTemplatesStatus ? <p className="import-status">{applyTemplatesStatus}</p> : null}
      </CollapsiblePanel>

      <section className="stats-grid plan-summary-grid">
        <StatCard
          label="Planned players"
          value={String(playerPasses.length)}
          hint="From your purchase plan"
        />
        <StatCard
          label="Tracking"
          value={String(summary.tracked)}
          hint={`${summary.complete} at Iconic target`}
        />
        <StatCard
          label="Soonest finish"
          value={formatDays(summary.soonest)}
          hint={
            summary.soonest === null
              ? `Target ${ICONIC_RATING_TARGET.toLocaleString()} rating`
              : formatProjectedFinishDate(summary.soonest)
          }
        />
      </section>

      {finishOrder.length > 0 ? (
        <CollapsiblePanel
          className="pack-finish-summary"
          title="Finish order"
          description="Tracked passes sorted by soonest estimated Iconic date (using each pass’s rating/pack and opening accounts)."
          defaultOpen={false}
          badge={`${finishOrder.length}`}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pass</th>
                  <th>Rating</th>
                  <th>Days left</th>
                  <th>Finish date</th>
                </tr>
              </thead>
              <tbody>
                {finishOrder.map((row, index) => (
                  <tr key={row.pass.id}>
                    <td>{index + 1}</td>
                    <td>
                      {row.pass.name}
                      <br />
                      <small className="table-sub">
                        {row.pass.sport} · {row.pass.season}
                      </small>
                    </td>
                    <td>
                      {row.estimate.totalRating.toLocaleString()} /{' '}
                      {ICONIC_RATING_TARGET.toLocaleString()}
                    </td>
                    <td>{formatDays(row.estimate.daysRemaining)}</td>
                    <td>
                      <strong>{row.finishLabel}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsiblePanel>
      ) : null}

      {playerPasses.length === 0 ? (
        <section className="panel plan-empty">
          <p className="empty">
            Add player passes on the{' '}
            <Link className="link-button" to="/plan">
              purchase plan
            </Link>{' '}
            first, then track pack progress here.
          </p>
        </section>
      ) : (
        <section className="pack-tracker-list">
          <div className="pack-tracker-list-header">
            <div className="pack-sync-copy">
              <h2>Planned players</h2>
              <p className="table-sub">
                {untrackedPlayerPasses.length === 0
                  ? 'Every planned player pass is already tracked.'
                  : `${untrackedPlayerPasses.length} pass${untrackedPlayerPasses.length === 1 ? '' : 'es'} not tracking yet — same seeding as “Track packs” (shared accounts when set).`}
              </p>
            </div>
            <button
              className="button compact"
              type="button"
              disabled={untrackedPlayerPasses.length === 0}
              onClick={trackAllUntracked}
            >
              Track all
              {untrackedPlayerPasses.length > 0 ? ` (${untrackedPlayerPasses.length})` : ''}
            </button>
          </div>
          {trackAllStatus ? <p className="import-status">{trackAllStatus}</p> : null}
          {playerPasses.map((pass) => {
            const tracker = trackerByPassId.get(pass.id)
            const busyAll = importBusyKey === `${tracker?.id ?? ''}:all`
            return (
              <PackPassRow
                key={pass.id}
                pass={pass}
                tracker={tracker}
                importBusy={anyImportBusy}
                importBusyLabel={busyAll ? 'Importing…' : ''}
                importStatus={importStatusByPass[pass.id] ?? ''}
                onEnsureTracker={() => upsertPackTracker(pass.id)}
                onUpdateRatingPerPack={(value) => {
                  if (!tracker) return
                  updatePackTracker(tracker.id, { ratingPerPack: value })
                }}
                onAddAccount={() => {
                  const id = tracker?.id ?? upsertPackTracker(pass.id)
                  if (id) addPackTrackerAccount(id)
                }}
                onUpdateAccount={(accountId, patch) => {
                  if (!tracker) return
                  updatePackTrackerAccount(tracker.id, accountId, patch)
                }}
                onRemoveAccount={(accountId) => {
                  if (!tracker) return
                  removePackTrackerAccount(tracker.id, accountId)
                }}
                onIgnoreMissing={(accountId) => {
                  if (!tracker) return
                  updatePackTrackerAccount(tracker.id, accountId, { ignoredMissing: true })
                }}
                onImportAccount={(account) => {
                  if (!tracker) return
                  void importOneAccount(pass, tracker, account)
                }}
                onImportAll={() => {
                  if (!tracker) return
                  void importAllAccounts(pass, tracker)
                }}
                onMarkFinished={() => markPassFinished(pass)}
              />
            )
          })}
        </section>
      )}
    </div>
  )
}
