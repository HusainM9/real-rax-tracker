import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { ThemedSelect } from '../components/ThemedSelect'
import { PassIdentity } from '../components/PassIdentity'
import { PackAccountRows } from '../components/PackAccountRows'
import { PlayerPackOpenings } from '../components/PlayerPackOpenings'
import { normalizePackRatingTarget, type PackRatingTarget } from '../lib/dailyPacks'
import { useRaxData } from '../context/RaxDataContext'
import { createId } from '../lib/id'
import { runWithConcurrency } from '../lib/meowbotApi'
import type { CatalogSearchResult } from '../lib/catalogApi'
import { RECOMMENDATION_SIMULATED_RARITY } from '../lib/passRecommendation'
import {
  DEFAULT_PACK_RATING_INCREMENT,
  estimatePackProgress,
  formatMarkPackFinishedConfirmMessage,
  formatProjectedFinishDate,
  hydrateWeeklyPackOpens,
  latestWeeklyPackOpenDate,
  nextWeeklyPackDate,
  normalizeDailySwaps,
  normalizePackOpenDate,
  normalizePackUsername,
  normalizeWeeklyExtraAccounts,
  projectedWeeklyFinishDate,
} from '../lib/packTracker'
import { fetchPackRatings } from '../lib/packRatingsImport'
import { fetchPlayAverages } from '../lib/playAveragesImport'
import { MIN_RATING_PER_PACK, PLAYS_PER_PACK } from '../lib/playAveragesImport'
import type {
  PackAccountTemplate,
  PackTracker,
  PackTrackerAccount,
  PlannedPass,
  WeeklyPackOpen,
} from '../types/rax'
import './PlanningPages.css'

function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'Done'
  if (days === 1) return '1 day'
  return `${days} days`
}

function formatWeeks(weeks: number | null): string {
  if (weeks === null) return '—'
  if (weeks === 0) return 'Done'
  if (weeks === 1) return '1 week'
  return `${weeks} weeks`
}

function todayLocalDay(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatOpenDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const parsed = new Date(year!, month! - 1, date!)
  if (Number.isNaN(parsed.getTime())) return day
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type PackPassSortMode = 'soonest' | 'most-upgraded' | 'least-upgraded' | 'name' | 'plan'

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
  onUpdateRatingTarget,
  now,
  onUpdateDailySwaps,
  onSetWeeklyPacksOnly,
  onUpdateWeeklyExtraAccounts,
  onAddWeeklyPackOpen,
  onRemoveWeeklyPackOpen,
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  onIgnoreMissing,
  onImportAccount,
  onImportAll,
  onImportPlayAverage,
  onMarkFinished,
}: {
  pass: PlannedPass
  tracker: PackTracker | undefined
  importBusy: boolean
  importBusyLabel: string
  importStatus: string
  onEnsureTracker: () => void
  onUpdateRatingPerPack: (value: number) => void
  onUpdateRatingTarget: (value: PackRatingTarget) => void
  now: Date
  onUpdateDailySwaps: (value: number | undefined) => void
  onSetWeeklyPacksOnly: (enabled: boolean) => void
  onUpdateWeeklyExtraAccounts: (value: number | undefined) => void
  onAddWeeklyPackOpen: (openedOn: string, accountId?: string) => void
  onRemoveWeeklyPackOpen: (openId: string) => void
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
  onImportPlayAverage: () => void
  onMarkFinished: () => void
}) {
  const estimate = tracker
    ? estimatePackProgress(tracker)
    : estimatePackProgress({
        accounts: [],
        ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
      })
  const isDone = Boolean(tracker && estimate.atTarget)
  const weeklyOnly = Boolean(tracker?.weeklyPacksOnly)
  const accountCount = tracker?.accounts.length ?? 0
  const importableCount = tracker
    ? tracker.accounts.filter((account) => Boolean(accountUsername(account))).length
    : 0
  const [open, setOpen] = useState(false)
  const hasDailySwaps = Boolean(tracker && normalizeDailySwaps(tracker.dailySwaps) > 0)
  const [showDailySwaps, setShowDailySwaps] = useState(hasDailySwaps)
  const [weeklyOpenDay, setWeeklyOpenDay] = useState(todayLocalDay)
  const [weeklyOpenAccountId, setWeeklyOpenAccountId] = useState('')
  const weeklyOpens = tracker?.weeklyPackOpens ?? []
  const latestOpen = latestWeeklyPackOpenDate(weeklyOpens)
  const nextOpen = weeklyOnly ? nextWeeklyPackDate(weeklyOpens) : null
  const weeklyFinish = weeklyOnly
    ? projectedWeeklyFinishDate(estimate.weeksRemaining, weeklyOpens)
    : null
  const hasIncompleteOwnership = Boolean(
    tracker?.accounts.some(
      (account) => account.ownershipStatus === 'missing' && !account.ignoredMissing,
    ),
  )
  // Yellow incomplete-ownership only for unfinished passes (collapsed).
  const showPassMissingWarn = hasIncompleteOwnership && !open && !isDone

  const cadenceLabel = weeklyOnly ? 'Weekly packs' : 'Daily packs'
  const timeLeftLabel = weeklyOnly
    ? formatWeeks(estimate.weeksRemaining)
    : formatDays(estimate.daysRemaining)

  return (
    <CollapsiblePanel
      className={`pack-tracker-row pack-compact-player${isDone ? ' pack-tracker-row-done' : ''}${showPassMissingWarn ? ' pack-tracker-row-incomplete' : ''}`}
      title={
        <span className="pack-pass-heading">
          <PassIdentity
            name={pass.name}
            passKind={pass.passKind}
            sport={pass.sport}
            avatar={pass.avatar}
            meta={`${pass.sport} · ${pass.season}${tracker ? ` · ${cadenceLabel}` : ''}`}
          />
          {tracker && !open ? (
            <span className="pack-pass-glance">
              <span><small>Rating</small><strong>{estimate.totalRating.toLocaleString()}</strong></span>
              <span><small>{isDone ? 'Status' : 'Time left'}</small><strong>{isDone ? 'Complete' : timeLeftLabel}</strong></span>
              <span><small>Accounts</small><strong>{accountCount}</strong></span>
              <span className="pack-pass-mini-progress" aria-hidden="true"><i style={{ width: `${Math.round(estimate.progressRatio * 100)}%` }} /></span>
            </span>
          ) : !tracker ? <span className="pack-pass-untracked">Not tracking</span> : null}
        </span>
      }
      defaultOpen={false}
      open={open}
      onOpenChange={setOpen}
      badge={isDone ? 'DONE' : undefined}
      preview={tracker && !open && !weeklyOnly && !isDone ? <PlayerPackOpenings player={pass.name} accounts={tracker.accounts} now={now} expanded={open} /> : null}
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
              disabled={importBusy}
              onClick={onImportPlayAverage}
            >
              Avg from plays
            </button>
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
          Import Real ratings for your accounts and choose a target to track pack progress.
        </p>
      ) : (
        <div className="pack-tracker-body">
          <div className="pack-player-overview">
            <label className="pack-rating-target"><span>Target</span><select aria-label={`Rating target for ${pass.name}`} value={normalizePackRatingTarget(tracker.ratingTarget)} onChange={event => onUpdateRatingTarget(normalizePackRatingTarget(Number(event.target.value)))}><option value={380}>380 · Legendary</option><option value={1380}>1,380 · Mystic</option><option value={3380}>3,380 · Iconic</option></select></label>
            <div className="pack-player-progress">
              <div><strong>{estimate.totalRating.toLocaleString()}</strong><span> / {normalizePackRatingTarget(tracker.ratingTarget).toLocaleString()} rating · {estimate.remaining.toLocaleString()} remaining</span></div>
              <div className="pack-progress-bar" aria-hidden="true"><span style={{ width: `${Math.round(estimate.progressRatio * 100)}%` }} /></div>
            </div>
            <div className="pack-player-eta"><strong>{timeLeftLabel}</strong><small>{estimate.packsNeeded.toLocaleString()} packs remaining</small></div>
          </div>
          <PackAccountRows player={pass.name} accounts={tracker.accounts} now={now} weeklyOnly={weeklyOnly} showOpenings={!weeklyOnly && !isDone} busy={importBusy} onAdd={onAddAccount} onUpdate={onUpdateAccount} onImport={onImportAccount} onRemove={onRemoveAccount} onIgnoreMissing={onIgnoreMissing} />
          {importStatus ? <p className="import-status">{importStatus}</p> : null}
          <details className="pack-player-settings">
            <summary><strong>Estimates & settings</strong><span>{estimate.ratingPerPack} rating / pack · {weeklyOnly ? 'Weekly' : 'Daily'} · {weeklyOnly ? `${estimate.weeklyExtraAccounts} extra accounts` : estimate.dailySwaps ? `${estimate.dailySwaps} swaps / day` : 'No swaps'}</span></summary>
            <div className="pack-player-settings-body">
              <div className="pack-estimate-inputs">
                <label className="pack-stat pack-stat-input"><span>Rating / pack</span><input type="number" min={1} step={0.1} value={tracker.ratingPerPack ?? DEFAULT_PACK_RATING_INCREMENT} onChange={event => onUpdateRatingPerPack(Number(event.target.value))} aria-label={`Rating per pack for ${pass.name}`} /></label>
                <p className="table-sub">{estimate.openingAccounts} opening accounts · Estimated {weeklyOnly ? `${estimate.weeklyGain} / week` : `${estimate.dailyGain} / day`}{weeklyFinish ? ` · Finish ~ ${weeklyFinish.toLocaleDateString()}` : ''}</p>
              </div>
          <div className="pack-cadence-controls">
            {weeklyOnly ? (
              <div className="pack-weekly-mode">
                <div className="pack-weekly-mode-header">
                  <p className="table-sub pack-weekly-mode-hint">
                    Weekly packs only — listed openers plus any extra accounts each contribute one
                    pack per week (assumed same day as account 1 / your logged open dates).
                  </p>
                  <button
                    className="button compact"
                    type="button"
                    onClick={() => onSetWeeklyPacksOnly(false)}
                  >
                    Use daily packs
                  </button>
                </div>

                <div className="pack-daily-swaps-row">
                  <label className="pack-stat pack-stat-input">
                    <span>Extra accounts opening</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={tracker.weeklyExtraAccounts ?? 0}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        onUpdateWeeklyExtraAccounts(
                          Number.isFinite(next) && next > 0 ? next : undefined,
                        )
                      }}
                      aria-label={`Extra weekly accounts for ${pass.name}`}
                    />
                  </label>
                  <p className="table-sub pack-daily-swaps-hint">
                    Extra accounts not listed below that also open this weekly pack. Assumed to open
                    on the same day as account 1. Adds{' '}
                    {normalizeWeeklyExtraAccounts(tracker.weeklyExtraAccounts) *
                      estimate.ratingPerPack}
                    /week to the estimate.
                  </p>
                </div>

                <div className="pack-weekly-opens">
                  <div className="pack-accounts-header">
                    <h4>Weekly pack opens</h4>
                  </div>
                  <p className="table-sub pack-weekly-opens-hint">
                    Log when account 1 (or any account) opened this weekly pack. Extra accounts are
                    assumed to open on that same day. Used for next-pack and finish estimates.
                    {latestOpen ? ` Last logged ${formatOpenDay(latestOpen)}.` : ''}
                    {nextOpen
                      ? ` Next pack ~ ${nextOpen.toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}.`
                      : ''}
                  </p>
                  <div className="pack-weekly-opens-form">
                    <label className="pack-account-field">
                      <span>Opened on</span>
                      <input
                        type="date"
                        value={weeklyOpenDay}
                        onChange={(event) => setWeeklyOpenDay(event.target.value)}
                        aria-label={`Weekly pack open date for ${pass.name}`}
                      />
                    </label>
                    <ThemedSelect
                      label="Account"
                      value={weeklyOpenAccountId}
                      onChange={(value) => setWeeklyOpenAccountId(value)}
                      ariaLabel={`Account that opened weekly pack for ${pass.name}`}
                      options={[
                        { value: '', label: 'Any / unspecified' },
                        ...tracker.accounts.map((account) => ({
                          value: account.id,
                          label: account.name.trim() || accountUsername(account) || 'Account',
                        })),
                      ]}
                    />
                    <button
                      className="button compact"
                      type="button"
                      onClick={() => {
                        const day = normalizePackOpenDate(weeklyOpenDay)
                        if (!day) return
                        onAddWeeklyPackOpen(day, weeklyOpenAccountId || undefined)
                        setWeeklyOpenDay(todayLocalDay())
                      }}
                    >
                      Add open date
                    </button>
                  </div>
                  {weeklyOpens.length === 0 ? (
                    <p className="import-hint">No opens logged yet.</p>
                  ) : (
                    <ul className="pack-weekly-opens-list">
                      {[...weeklyOpens].reverse().map((entry) => {
                        const account = entry.accountId
                          ? tracker.accounts.find((row) => row.id === entry.accountId)
                          : undefined
                        return (
                          <li key={entry.id}>
                            <span>
                              {formatOpenDay(entry.openedOn)}
                              {account
                                ? ` · ${account.name.trim() || accountUsername(account) || 'Account'}`
                                : ''}
                            </span>
                            <button
                              className="button danger compact"
                              type="button"
                              onClick={() => onRemoveWeeklyPackOpen(entry.id)}
                            >
                              Remove
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="pack-daily-swaps">
                  {showDailySwaps || hasDailySwaps ? (
                    <div className="pack-daily-swaps-row">
                      <label className="pack-stat pack-stat-input">
                        <span>Daily swaps</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={tracker.dailySwaps ?? 0}
                          onChange={(event) => {
                            const next = Number(event.target.value)
                            onUpdateDailySwaps(
                              Number.isFinite(next) && next > 0 ? next : undefined,
                            )
                          }}
                          aria-label={`Daily swaps for ${pass.name}`}
                        />
                      </label>
                      <p className="table-sub pack-daily-swaps-hint">
                        Extra packs of this player per day from swapping unrelated player packs. Adds{' '}
                        {estimate.dailySwaps * estimate.ratingPerPack}/day to the estimate.
                      </p>
                      <button
                        className="button danger compact"
                        type="button"
                        onClick={() => {
                          onUpdateDailySwaps(undefined)
                          setShowDailySwaps(false)
                        }}
                      >
                        Remove swaps
                      </button>
                    </div>
                  ) : (
                    <button
                      className="button compact"
                      type="button"
                      onClick={() => {
                        setShowDailySwaps(true)
                        onUpdateDailySwaps(1)
                      }}
                    >
                      Add daily swaps
                    </button>
                  )}
                </div>
                <button
                  className="button compact"
                  type="button"
                  onClick={() => {
                    setShowDailySwaps(false)
                    onSetWeeklyPacksOnly(true)
                  }}
                >
                  Weekly packs only
                </button>
              </>
            )}
          </div>

          {tracker.playCount != null && tracker.playCount === 0 ? (
            <p className="import-hint pack-play-average-hint">
              Real returned no play ratings for this player — using min {MIN_RATING_PER_PACK}/pack.
              {tracker.lastPlaysImportedAt
                ? ` · Checked ${new Date(tracker.lastPlaysImportedAt).toLocaleString()}`
                : ''}
            </p>
          ) : tracker.averagePlayRating != null && tracker.playCount != null ? (
            <p className="import-hint pack-play-average-hint">
              Avg play rating {tracker.averagePlayRating.toFixed(2)} across {tracker.playCount}{' '}
              play{tracker.playCount === 1 ? '' : 's'}
              {` · ≈ ${Math.max(MIN_RATING_PER_PACK, tracker.averagePlayRating * PLAYS_PER_PACK).toFixed(1)}/pack (${PLAYS_PER_PACK} plays/pack, min ${MIN_RATING_PER_PACK})`}
              {tracker.lastPlaysImportedAt
                ? ` · Imported ${new Date(tracker.lastPlaysImportedAt).toLocaleString()}`
                : ''}
            </p>
          ) : (
            <p className="import-hint pack-play-average-hint">
              Use Avg from plays to sample recent Real play ratings for this player (packs have{' '}
              {PLAYS_PER_PACK} plays, rating/pack min {MIN_RATING_PER_PACK}).
            </p>
          )}


            </div>
          </details>

          {estimate.atTarget ? (
            <p className="import-hint plan-pass-status owned">DONE — reached {normalizePackRatingTarget(tracker.ratingTarget).toLocaleString()} rating target.</p>
          ) : estimate.daysRemaining === null ? (
            <p className="import-hint plan-pass-status warning">
              {weeklyOnly
                ? 'No weekly pack openers for estimates — enable “Opens weekly pack” on an owned account, add extra accounts opening, or Ignore missing ownership.'
                : 'No effective pack openers for estimates — enable “Opens packs” on an owned account, add daily swaps, or Ignore missing ownership.'}
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
    addPlannedPassFromCatalog,
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
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update) }
  }, [])
  const [scanInfo, setScanInfo] = useState<Record<string, { fetchedAt?: string; source?: string }>>({})
  const [forceRefreshRatings, setForceRefreshRatings] = useState(false)
  const [lastRatingsCheck, setLastRatingsCheck] = useState<{
    username: string; fetchedAt: string; source?: 'real' | 'cache'
  } | null>(null)
  const [applyTemplatesStatus, setApplyTemplatesStatus] = useState('')
  const [trackAllStatus, setTrackAllStatus] = useState('')
  const [importBusyKey, setImportBusyKey] = useState('')
  const [importStatusByPass, setImportStatusByPass] = useState<Record<string, string>>({})
  const [passSortMode, setPassSortMode] = useState<PackPassSortMode>('soonest')
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickAddLoadingKey, setQuickAddLoadingKey] = useState('')
  const [quickAddStatus, setQuickAddStatus] = useState('')
  const [pendingQuickTrackId, setPendingQuickTrackId] = useState<string | null>(null)

  const plannedPasses = data.plannedPasses ?? []
  const packTrackers = data.packTrackers ?? []
  const packAccountTemplates = data.packAccountTemplates ?? []
  const anyImportBusy = syncBusyUsername !== '' || syncAllProgress !== null || importBusyKey !== ''
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

  useEffect(() => {
    if (!pendingQuickTrackId) return
    if (!playerPasses.some((pass) => pass.id === pendingQuickTrackId)) return
    upsertPackTracker(pendingQuickTrackId)
    setPendingQuickTrackId(null)
  }, [pendingQuickTrackId, playerPasses, upsertPackTracker])

  const addPlayerFromCatalog = (result: CatalogSearchResult) => {
    setQuickAddLoadingKey(result.externalKey)
    setQuickAddStatus('')
    try {
      const id = addPlannedPassFromCatalog(
        result,
        result.rarityLabel || RECOMMENDATION_SIMULATED_RARITY,
        'catalog',
      )
      if (!id) {
        setQuickAddStatus(`${result.name} is already on the pack board.`)
        return
      }
      setPendingQuickTrackId(id)
      setQuickAddStatus(`Added ${result.name} and started pack tracking.`)
    } finally {
      setQuickAddLoadingKey('')
    }
  }

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
        const weeklyFinish = estimate.weeklyPacksOnly
          ? projectedWeeklyFinishDate(estimate.weeksRemaining, tracker.weeklyPackOpens)
          : null
        return {
          pass,
          tracker,
          estimate,
          finishLabel: weeklyFinish
            ? weeklyFinish.toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : formatProjectedFinishDate(estimate.daysRemaining),
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => {
        // DONE (at target) first, then soonest estimated finish.
        if (a.estimate.atTarget !== b.estimate.atTarget) {
          return a.estimate.atTarget ? -1 : 1
        }
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

  const packDashboard = useMemo(() => {
    const weekly = packTrackers.filter((tracker) => tracker.weeklyPacksOnly).length
    const openingAccounts = packTrackers.reduce(
      (sum, tracker) => sum + tracker.accounts.filter((account) => account.opensPacks).length,
      0,
    )
    const attention = packTrackers.filter((tracker) => tracker.accounts.some(
      (account) => account.ownershipStatus === 'missing' && !account.ignoredMissing,
    )).length
    return { weekly, openingAccounts, attention }
  }, [packTrackers])

  const untrackedPlayerPasses = useMemo(
    () => playerPasses.filter((pass) => !trackerByPassId.has(pass.id)),
    [playerPasses, trackerByPassId],
  )

  /** Sort planned players; DONE (at target) stays first for finish-based sorts. */
  const sortedPlayerPasses = useMemo(() => {
    const indexed = playerPasses.map((pass, index) => ({ pass, index }))
    return indexed
      .sort((a, b) => {
        if (passSortMode === 'plan') return a.index - b.index
        if (passSortMode === 'name') {
          return a.pass.name.localeCompare(b.pass.name, undefined, { sensitivity: 'base' })
        }

        const aTracker = trackerByPassId.get(a.pass.id)
        const bTracker = trackerByPassId.get(b.pass.id)
        const aEstimate = aTracker
          ? estimatePackProgress(aTracker)
          : null
        const bEstimate = bTracker
          ? estimatePackProgress(bTracker)
          : null

        // Untracked after tracked for progress/finish sorts.
        if ((aEstimate === null) !== (bEstimate === null)) {
          return aEstimate === null ? 1 : -1
        }
        if (aEstimate === null || bEstimate === null) {
          return a.pass.name.localeCompare(b.pass.name)
        }

        if (aEstimate.atTarget !== bEstimate.atTarget) {
          return aEstimate.atTarget ? -1 : 1
        }

        if (passSortMode === 'most-upgraded') {
          if (aEstimate.totalRating !== bEstimate.totalRating) {
            return bEstimate.totalRating - aEstimate.totalRating
          }
          return a.pass.name.localeCompare(b.pass.name)
        }

        if (passSortMode === 'least-upgraded') {
          if (aEstimate.totalRating !== bEstimate.totalRating) {
            return aEstimate.totalRating - bEstimate.totalRating
          }
          return a.pass.name.localeCompare(b.pass.name)
        }

        // soonest finish
        if (aEstimate.daysRemaining === null && bEstimate.daysRemaining === null) {
          return a.pass.name.localeCompare(b.pass.name)
        }
        if (aEstimate.daysRemaining === null) return 1
        if (bEstimate.daysRemaining === null) return -1
        if (aEstimate.daysRemaining !== bEstimate.daysRemaining) {
          return aEstimate.daysRemaining - bEstimate.daysRemaining
        }
        return a.pass.name.localeCompare(b.pass.name)
      })
      .map((entry) => entry.pass)
  }, [passSortMode, playerPasses, trackerByPassId])

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

  const loadPackRatings = async (username: string) => {
    const result = await fetchPackRatings(username, undefined, { forceRefresh: forceRefreshRatings })
    if (result.username.toLowerCase() !== normalizePackUsername(username).toLowerCase()) throw new Error('Account response did not match the requested username.')
    if (result.fetchedAt && Number.isFinite(Date.parse(result.fetchedAt))) {
      setNow(new Date())
      setScanInfo(previous => ({ ...previous, [result.username.toLowerCase()]: { fetchedAt: result.fetchedAt, source: result.source } }))
      setLastRatingsCheck({ username: result.username, fetchedAt: result.fetchedAt, source: result.source })
    }
    return result
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
      const result = await loadPackRatings(username)
      const ratingsByExternalKey = ratingsMapFromResult(result.passes)
      const applied = applyPackRatingsFromImport(result.username, ratingsByExternalKey, {
        scan: result,
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
        `Synced ratings for @${outcome.username}. Check tracked passes for ownership status.`,
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
    let completed = 0

    try {
      setSyncAllProgress({ index: 0, total })
      setSyncStatus(`Syncing accounts… 0/${total}`)
      const outcomes = await runWithConcurrency(knownUsernames, 2, async (username) => {
        const outcome = await runSyncUsername(username)
        completed += 1
        setSyncAllProgress({ index: completed, total })
        setSyncStatus(`Syncing accounts… ${completed}/${total}`)
        return outcome
      })

      const syncedOk = outcomes.filter((outcome) => outcome.ok).length
      const errors = outcomes.flatMap((outcome) => outcome.ok ? [] : [`@${outcome.username}: ${outcome.error}`])
      const parts = [
        `Synced ${syncedOk}/${total} account${total === 1 ? '' : 's'}.`,
      ]
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
    const templatesWithUsername = packAccountTemplates.filter((template) =>
      Boolean(normalizePackUsername(template.username)),
    )
    if (templatesWithUsername.length === 0) {
      setApplyTemplatesStatus(
        'Enter a Real username on each shared account before applying — blank usernames are skipped.',
      )
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
    if (result.accountsRemoved > 0) {
      parts.push(
        `Removed ${result.accountsRemoved} blank placeholder${result.accountsRemoved === 1 ? '' : 's'}.`,
      )
    }
    if (templatesWithUsername.length < packAccountTemplates.length) {
      parts.push(
        `Skipped ${packAccountTemplates.length - templatesWithUsername.length} shared account${
          packAccountTemplates.length - templatesWithUsername.length === 1 ? '' : 's'
        } without a username.`,
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
      const result = await loadPackRatings(username)
      const ratingsByExternalKey = ratingsMapFromResult(result.passes)
      const match = ratingsByExternalKey[pass.externalKey]
      if (!match) {
        applyPackRatingsFromImport(result.username, ratingsByExternalKey, {

          scan: result,
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

        scan: result,
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
    let unchanged = 0
    let checked = 0
    const errors: string[] = []

    try {
      await runWithConcurrency([...byUsername], 2, async ([usernameKey, group]) => {
        const username = accountUsername(group[0]!) || usernameKey
        try {
          const result = await loadPackRatings(username)
          const ratingsByExternalKey = ratingsMapFromResult(result.passes)
          const applied = applyPackRatingsFromImport(result.username, ratingsByExternalKey, {
            scan: result,
            plannedPassId: pass.id,
          })
          checked += group.length
          updated += applied.updatedAccounts
          missing += applied.missingPasses
          unchanged += applied.unchangedAccounts ?? 0
        } catch (error) {
          errors.push(
            `@${username}: ${error instanceof Error ? error.message : 'import failed'}`,
          )
        }
      })

      const parts = [
        `Checked ${checked}/${tracker.accounts.length} accounts for ${pass.name}.`,
        `${updated} updated.`,
      ]
      if (unchanged > 0) parts.push(`${unchanged} already current from the same or a newer scan.`)
      if (missing > 0) parts.push(`${missing} account${missing === 1 ? '' : 's'} do not own this pass.`)
      const skipped = tracker.accounts.length - accounts.length
      if (skipped > 0) parts.push(`${skipped} account${skipped === 1 ? ' has' : 's have'} no Real username.`)
      if (errors.length > 0) parts.push(errors.join(' '))
      setImportStatusByPass((current) => ({
        ...current,
        [pass.id]: parts.join(' '),
      }))
    } finally {
      setImportBusyKey('')
    }
  }

  const importPlayAverageForPass = async (pass: PlannedPass, tracker: PackTracker) => {
    setImportBusyKey(`${tracker.id}:avg`)
    setImportStatusByPass((current) => ({
      ...current,
      [pass.id]: `Fetching play ratings for ${pass.name}…`,
    }))
    try {
      const { results, errors } = await fetchPlayAverages([
        {
          externalKey: pass.externalKey,
          sport: pass.sport,
        },
      ])
      const result = results.find((row) => row.externalKey === pass.externalKey) ?? results[0]
      if (!result) {
        const detail = errors[0]?.error ?? 'No play average returned.'
        setImportStatusByPass((current) => ({
          ...current,
          [pass.id]: detail,
        }))
        return
      }
      updatePackTracker(tracker.id, {
        averagePlayRating: result.noPlaysFallback ? 0 : result.averagePlayRating,
        playCount: result.playCount,
        lastPlaysImportedAt: new Date().toISOString(),
        ratingPerPack: result.ratingPerPack,
      })
      setImportStatusByPass((current) => ({
        ...current,
        [pass.id]: result.noPlaysFallback
          ? `Real has no play ratings for ${pass.name} — using min ${result.ratingPerPack}/pack.`
          : `Avg ${result.averagePlayRating.toFixed(2)}/play across ${result.playCount} plays → ${result.ratingPerPack}/pack (${PLAYS_PER_PACK} plays/pack).`,
      }))
    } catch (error) {
      setImportStatusByPass((current) => ({
        ...current,
        [pass.id]: error instanceof Error ? error.message : 'Could not import play averages.',
      }))
    } finally {
      setImportBusyKey('')
    }
  }

  const importPlayAveragesForAllTracked = async () => {
    const targets = playerPasses
      .map((pass) => {
        const tracker = trackerByPassId.get(pass.id)
        return tracker ? { pass, tracker } : null
      })
      .filter((row): row is { pass: PlannedPass; tracker: PackTracker } => row !== null)

    if (targets.length === 0) {
      setSyncStatus('Track at least one player pass before averaging plays.')
      return
    }

    // One pass per request — avoids Vercel FUNCTION_INVOCATION_TIMEOUT on batched Real fetches.
    const CHUNK_SIZE = 1
    setImportBusyKey('play-avg:all')
    setSyncStatus(`Averaging plays… 0/${targets.length}`)

    let updated = 0
    const errorNotes: string[] = []

    try {
      for (let offset = 0; offset < targets.length; offset += CHUNK_SIZE) {
        const chunk = targets.slice(offset, offset + CHUNK_SIZE)
        const current = chunk[0]!
        setSyncStatus(
          `Averaging ${current.pass.name}… ${offset + 1}/${targets.length}`,
        )

        try {
          const controller = new AbortController()
          const timeoutId = window.setTimeout(() => controller.abort(), 55_000)
          let batch: Awaited<ReturnType<typeof fetchPlayAverages>>
          try {
            batch = await fetchPlayAverages(
              chunk.map(({ pass }) => ({
                externalKey: pass.externalKey,
                sport: pass.sport,
              })),
              controller.signal,
            )
          } finally {
            window.clearTimeout(timeoutId)
          }
          const { results, errors } = batch
          const byKey = new Map(results.map((row) => [row.externalKey, row]))
          const importedAt = new Date().toISOString()

          for (const err of errors) {
            const name =
              chunk.find(({ pass }) => pass.externalKey === err.externalKey)?.pass.name ??
              err.externalKey
            errorNotes.push(`${name}: ${err.error}`)
          }

          for (const { pass, tracker } of chunk) {
            const result = byKey.get(pass.externalKey)
            if (!result) {
              if (!errors.some((row) => row.externalKey === pass.externalKey)) {
                errorNotes.push(`${pass.name}: no play average returned`)
              }
              continue
            }
            updatePackTracker(tracker.id, {
              averagePlayRating: result.noPlaysFallback ? 0 : result.averagePlayRating,
              playCount: result.playCount,
              lastPlaysImportedAt: importedAt,
              ratingPerPack: result.ratingPerPack,
            })
            updated += 1
            if (result.noPlaysFallback) {
              errorNotes.push(
                `${pass.name}: no Real play ratings (using min ${result.ratingPerPack}/pack)`,
              )
            }
          }
        } catch (error) {
          const detail =
            error instanceof DOMException && error.name === 'AbortError'
              ? 'timed out'
              : error instanceof Error
                ? error.message
                : 'failed'
          for (const { pass } of chunk) {
            errorNotes.push(`${pass.name}: ${detail}`)
          }
        }
      }

      const parts = [
        `Updated ${updated}/${targets.length} pass${targets.length === 1 ? '' : 'es'} from play averages (${PLAYS_PER_PACK} plays/pack).`,
      ]
      if (errorNotes.length > 0) {
        parts.push(errorNotes.slice(0, 4).join(' · '))
        if (errorNotes.length > 4) parts.push(`(+${errorNotes.length - 4} more)`)
      }
      setSyncStatus(parts.join(' '))
    } finally {
      setImportBusyKey('')
    }
  }

  return (
    <div className="page-stack plan-packs-page">
      <section className="packs-command-hero">
        <div className="packs-command-copy">
          <div>
            <p className="eyebrow">Player pack tracking</p>
            <h1>Packs</h1>
            <p>Track progress toward your chosen rating targets across players and accounts.</p>
          </div>
          <div className="packs-command-actions">
            <button className="button primary compact" type="button" aria-expanded={showQuickAdd} onClick={() => setShowQuickAdd((current) => !current)}>
              {showQuickAdd ? 'Close player search' : 'Add player'}
            </button>
            <Link className="button compact" to="/plan">Purchase plan</Link>
          </div>
        </div>
        {showQuickAdd ? (
          <div className="packs-quick-add">
            <CatalogSearchPanel
              embedded
              passKind="player"
              description="Search the shared catalog and add a player directly to pack tracking."
              actionLabel="Add to packs"
              loadingKey={quickAddLoadingKey}
              loadingLabel="Adding…"
              emptyHint="Type a player name to add it directly to this pack board."
              onSelect={(result) => addPlayerFromCatalog(result)}
            />
            {quickAddStatus ? <p className="import-status">{quickAddStatus}</p> : null}
          </div>
        ) : null}
        <div className="packs-command-metrics">
          <div className="packs-command-metric is-primary"><span>Tracked players</span><strong>{summary.tracked}</strong><small>{summary.complete} complete</small></div>
          <div className="packs-command-metric"><span>Soonest finish</span><strong>{formatDays(summary.soonest)}</strong><small>{summary.soonest === null ? 'No estimate yet' : formatProjectedFinishDate(summary.soonest)}</small></div>
          <div className="packs-command-metric"><span>Opening accounts</span><strong>{packDashboard.openingAccounts}</strong><small>Across all players</small></div>
          <div className={`packs-command-metric${packDashboard.attention > 0 ? ' needs-attention' : ''}`}><span>Needs attention</span><strong>{packDashboard.attention}</strong><small>{packDashboard.weekly} weekly tracker{packDashboard.weekly === 1 ? '' : 's'}</small></div>
        </div>
      </section>

      <p className="pack-opening-help">Opening indicators update when you sync/import ratings. Resets at 7am New York time. A first reading stays Unknown; rating transfers can also suggest an opening.</p>
      <details className="planning-tools packs-settings">
        <summary><span><strong>Sync and account settings</strong><small>Update ratings, manage shared accounts, and view finish order</small></span></summary>
      <section className="panel pack-sync-panel pack-sync-dock">
        <div className="pack-sync-panel-heading">
        <div className="pack-sync-copy">
          <span className="pack-sync-kicker">Live ratings</span>
          <h2>Sync account ratings</h2>
          <p className="table-sub">
            Update every tracked player from one account, or sync all your accounts together.
          </p>
        </div>
        <div className="pack-sync-bulk-actions">
          <button
            className="button"
            type="button"
            disabled={anyImportBusy || packTrackers.length === 0}
            onClick={() => void importPlayAveragesForAllTracked()}
          >
            {importBusyKey === 'play-avg:all' ? 'Averaging plays…' : 'Avg from plays (all)'}
          </button>
          {knownUsernames.length === 0 ? null : (
            <>
              <button
                className="button primary"
                type="button"
                disabled={anyImportBusy}
                onClick={() => void syncAllKnownUsernames()}
              >
                {isSyncAllRunning && syncAllProgress
                  ? `Syncing… ${syncAllProgress.index}/${syncAllProgress.total}`
                  : 'Sync all'}
              </button>
            </>
          )}
        </div>
        </div>
        <label className="pack-sync-fresh-choice"><input type="checkbox" aria-label="Always refresh ratings from Real" checked={forceRefreshRatings} disabled={anyImportBusy} onChange={event=>setForceRefreshRatings(event.target.checked)}/><span><strong>Always refresh from Real</strong><small>Fetch a new reading instead of reusing a recent scan.</small></span></label>
        <div className="pack-sync-account-grid">
              {knownUsernames.map((username) => (
                <div className="pack-sync-account-entry" key={username.toLowerCase()}>
                  <div className="pack-sync-account-info"><strong>@{username}</strong><small>{scanInfo[username.toLowerCase()]?.fetchedAt?<>{scanInfo[username.toLowerCase()].source==='cache'?'Recent scan':'Fresh scan'} · <time dateTime={scanInfo[username.toLowerCase()].fetchedAt}>{new Date(scanInfo[username.toLowerCase()].fetchedAt!).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time></>:'Not synced this visit'}</small></div>
                <button
                  className="button compact"
                  type="button"
                  aria-label={`Sync @${username}`}
                  disabled={anyImportBusy}
                  onClick={() => void syncAllTracked(username)}
                >
                  {syncBusyUsername.toLowerCase() === username.toLowerCase()
                    ? 'Syncing…'
                    : 'Sync'}
                </button>
                </div>
              ))}
        </div>
        {lastRatingsCheck ? <p className="pack-sync-footnote">Last reading · @{lastRatingsCheck.username} · <time dateTime={lastRatingsCheck.fetchedAt}>{new Date(lastRatingsCheck.fetchedAt).toLocaleTimeString()}</time></p> : null}
        <p className="pack-sync-footnote">Avg from plays updates rating-per-pack estimates using {PLAYS_PER_PACK} plays per pack.</p>
        {knownUsernames.length === 0 ? (
          <p className="import-hint">
            Add a Real username on a shared account or pass row below to sync live ownership ratings.
          </p>
        ) : null}
        {syncStatus ? <p className="import-status">{syncStatus}</p> : null}
      </section>

      <CollapsiblePanel
        className="pack-shared-accounts-panel"
        title="Shared accounts"
        description="Reusable accounts for your tracked players."
        defaultOpen={false}
        badge={`${packAccountTemplates.length}`}
        actions={
          <>
            <button className="button compact" type="button" onClick={() => addPackAccountTemplate()}>
              Add shared account
            </button>
          </>
        }
      >
        <div className="pack-shared-apply"><p className="table-sub">Editing a username renames it on every tracked pass. Apply adds missing shared accounts and removes usernames no longer in this list.</p><button className="button compact" type="button" disabled={packAccountTemplates.length===0||packTrackers.length===0} onClick={applySharedAccounts}>Apply to tracked players</button></div>
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

      {finishOrder.length > 0 ? (
        <CollapsiblePanel
          className="pack-finish-summary"
          title="Finish order"
          description="Players ordered by estimated target date."
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
                      {normalizePackRatingTarget(row.tracker.ratingTarget).toLocaleString()}
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
      </details>

      {playerPasses.length === 0 ? (
        <section className="panel plan-empty">
          <p className="empty">
            Add a player above, or add passes to your{' '}
            <Link className="link-button" to="/plan">
              purchase plan
            </Link>{' '}
            to track pack progress here.
          </p>
        </section>
      ) : (
        <section className="pack-tracker-list">
          <div className="pack-tracker-list-header">
            <div className="pack-sync-copy">
              <h2>Your players</h2>
              <p className="table-sub">
                {untrackedPlayerPasses.length === 0
                  ? 'Every planned player pass is already tracked.'
                  : `${untrackedPlayerPasses.length} pass${untrackedPlayerPasses.length === 1 ? '' : 'es'} not tracking yet — same seeding as “Track packs” (shared accounts when set).`}
              </p>
            </div>
            <div className="pack-tracker-list-actions">
              <ThemedSelect
                label="Sort"
                value={passSortMode}
                onChange={(value) => setPassSortMode(value as PackPassSortMode)}
                options={[
                  { value: 'soonest', label: 'Soonest finish' },
                  { value: 'most-upgraded', label: 'Most upgraded' },
                  { value: 'least-upgraded', label: 'Least upgraded' },
                  { value: 'name', label: 'Name A–Z' },
                  { value: 'plan', label: 'Plan order' },
                ]}
              />
              <button
                className="button compact"
                type="button"
                disabled={untrackedPlayerPasses.length === 0}
                onClick={trackAllUntracked}
              >
                Track all
                {untrackedPlayerPasses.length > 0 ? ` (${untrackedPlayerPasses.length})` : ''}
              </button>
              <button className="button primary compact" type="button" aria-label="Import all tracked player ratings" disabled={anyImportBusy || packTrackers.length === 0 || knownUsernames.length === 0} onClick={() => void syncAllKnownUsernames()}>
                {isSyncAllRunning && syncAllProgress ? `Importing… ${syncAllProgress.index}/${syncAllProgress.total}` : 'Import all'}
              </button>
            </div>
          </div>
          {syncStatus ? <p className="import-status pack-board-import-status" role="status">{syncStatus}</p> : null}
          {trackAllStatus ? <p className="import-status">{trackAllStatus}</p> : null}
          {sortedPlayerPasses.map((pass) => {
            const tracker = trackerByPassId.get(pass.id)
            const busyAll = importBusyKey === `${tracker?.id ?? ''}:all`
            const busyAvg = importBusyKey === `${tracker?.id ?? ''}:avg`
            return (
              <PackPassRow
                key={pass.id}
                pass={pass}
                tracker={tracker}
                importBusy={anyImportBusy}
                importBusyLabel={busyAll ? 'Importing…' : busyAvg ? 'Averaging…' : ''}
                importStatus={importStatusByPass[pass.id] ?? ''}
                onEnsureTracker={() => upsertPackTracker(pass.id)}
                now={now}
                onUpdateRatingTarget={value => { if (tracker) updatePackTracker(tracker.id, { ratingTarget: value }) }}
                onUpdateRatingPerPack={(value) => {
                  if (!tracker) return
                  updatePackTracker(tracker.id, { ratingPerPack: value })
                }}
                onUpdateDailySwaps={(value) => {
                  if (!tracker) return
                  updatePackTracker(tracker.id, { dailySwaps: value })
                }}
                onSetWeeklyPacksOnly={(enabled) => {
                  if (!tracker) return
                  updatePackTracker(tracker.id, {
                    weeklyPacksOnly: enabled,
                    ...(enabled
                      ? { dailySwaps: undefined }
                      : { weeklyExtraAccounts: undefined }),
                  })
                }}
                onUpdateWeeklyExtraAccounts={(value) => {
                  if (!tracker) return
                  updatePackTracker(tracker.id, { weeklyExtraAccounts: value })
                }}
                onAddWeeklyPackOpen={(openedOn, accountId) => {
                  if (!tracker) return
                  const next: WeeklyPackOpen[] = hydrateWeeklyPackOpens([
                    ...(tracker.weeklyPackOpens ?? []),
                    {
                      id: createId('wpo'),
                      openedOn,
                      accountId,
                    },
                  ])
                  updatePackTracker(tracker.id, { weeklyPackOpens: next })
                }}
                onRemoveWeeklyPackOpen={(openId) => {
                  if (!tracker) return
                  const next = (tracker.weeklyPackOpens ?? []).filter((entry) => entry.id !== openId)
                  updatePackTracker(tracker.id, { weeklyPackOpens: next })
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
                onImportPlayAverage={() => {
                  if (!tracker) return
                  void importPlayAverageForPass(pass, tracker)
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
