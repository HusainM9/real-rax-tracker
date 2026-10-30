import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PassIdentity } from '../components/PassIdentity'
import { useRaxData } from '../context/RaxDataContext'
import { cacheDailyEarningsResult, cacheDailyEarningsResults, DailyEarningsRequestError, fetchAccountDailyEarnings, readCachedDailyEarningsResults, syncLinkedEarningsTracking, type DailyEarningsResult, type DailyEarningsResultCache } from '../lib/dailyEarnings'
import { filterEarningsHistory, highestAverageWeekday, highestEarningDay, rankEarningPasses, rankEarningSports, readEarningsHistory, replaceEarningsHistoryForUsernames, saveEarningsHistoryEntry, sumHistory, weeklyEarningsTotals, type EarningsHistoryEntry } from '../lib/earningsHistory'
import { formatRax } from '../lib/format'
import './EarningsPage.css'

function currentRealEarningsDay(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const offset = Number(parts.hour) < 7 ? -1 : 0
  return new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset),
  ).toISOString().slice(0, 10)
}

function normalizeUsername(value: string): string {
  return value.replace(/^@/, '').trim()
}

function percentChange(current: number, previous: number): string {
  if (previous <= 0) return current > 0 ? 'New' : '—'
  const change = Math.round(((current - previous) / previous) * 100)
  return `${change >= 0 ? '+' : ''}${change}%`
}

function displayEarningsDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function earningsChartDayLabel(day: string): { weekday: string; date: string; full: string } {
  const parsed = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return { weekday: '', date: day, full: day }
  return {
    weekday: parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    date: parsed.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }),
    full: parsed.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  }
}

function earningsChartCeiling(maximum: number): number {
  const paddedMaximum = Math.max(1, maximum) * 1.1
  const magnitude = 10 ** Math.floor(Math.log10(paddedMaximum))
  const step = Math.max(25, magnitude / 2)
  return Math.ceil(paddedMaximum / step) * step
}

function previousDayKey(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

const DEMO_USERNAME = 'demo-collector'
const ALL_ACCOUNTS = '__all-linked-accounts__'
const ACCOUNT_RATE_LIMIT_RETRY_MS = 5_000

type RefreshLogEntry = {
  username: string
  status: 'queued' | 'fetching' | 'retrying' | 'complete' | 'failed'
  message: string
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isRateLimited(error: unknown): boolean {
  return error instanceof DailyEarningsRequestError && (
    error.status === 429 || error.code === 'real_rate_limited'
  )
}
const DEMO_HISTORY: EarningsHistoryEntry[] = Array.from({ length: 30 }, (_, index) => {
  const date = new Date('2026-10-11T12:00:00')
  date.setDate(date.getDate() - (29 - index))
  const dailyTotal = Math.max(18, Math.round(78 + Math.sin(index * 0.72) * 24 + (index % 5) * 7))
  const striker = Math.round(dailyTotal * 0.48)
  const guard = Math.round(dailyTotal * 0.32)
  return {
    username: DEMO_USERNAME,
    day: date.toISOString().slice(0, 10),
    dailyTotal,
    capturedAt: date.toISOString(),
    passes: [
      { username: DEMO_USERNAME, id: 'demo-1', label: 'Sample striker', sport: 'FC', totalEarnings: striker },
      { username: DEMO_USERNAME, id: 'demo-2', label: 'Sample guard', sport: 'NBA', totalEarnings: guard },
      { username: DEMO_USERNAME, id: 'demo-3', label: 'Sample winger', sport: 'NHL', totalEarnings: dailyTotal - striker - guard },
    ],
  }
})

const DEMO_RESULT: DailyEarningsResult = {
  username: DEMO_USERNAME,
  day: '2026-10-11',
  dayDisplay: 'October 11, 2026',
  emptyMessage: '',
  dailyTotal: 126,
  earnings: [
    { id: 'demo-1', totalEarnings: 54, pass: { id: '1', label: 'Sample striker', sport: 'FC', season: '2026', entityType: 'player', avatar: '', rarityLabel: 'Iconic' }, infos: [] },
    { id: 'demo-2', totalEarnings: 42, pass: { id: '2', label: 'Sample guard', sport: 'NBA', season: '2026-27', entityType: 'player', avatar: '', rarityLabel: 'Mystic' }, infos: [] },
    { id: 'demo-3', totalEarnings: 30, pass: { id: '3', label: 'Sample winger', sport: 'NHL', season: '2026-27', entityType: 'player', avatar: '', rarityLabel: 'Legendary' }, infos: [] },
  ],
}

function historyEntry(result: DailyEarningsResult): EarningsHistoryEntry {
  return {
    username: result.username,
    day: result.day,
    dailyTotal: result.dailyTotal,
    capturedAt: result.capturedAt ?? new Date().toISOString(),
    passes: result.earnings.map((row) => ({
      username: result.username,
      id: row.pass.id || row.id,
      label: row.pass.label,
      sport: row.pass.sport,
      totalEarnings: row.totalEarnings,
      avatar: row.pass.avatar || undefined,
    })),
  }
}

function combineDailyResults(
  loadedAccounts: DailyEarningsResult[],
  day: string,
  combineAccounts: boolean,
): DailyEarningsResult | null {
  if (loadedAccounts.length === 0) return null
  if (!combineAccounts && loadedAccounts.length === 1) return loadedAccounts[0]!
  return {
    username: `${loadedAccounts.length} linked account${loadedAccounts.length === 1 ? '' : 's'}`,
    day,
    dayDisplay: loadedAccounts[0]?.dayDisplay ?? day,
    emptyMessage: '',
    earnings: loadedAccounts.flatMap((loaded) => loaded.earnings.map((row) => ({
      ...row,
      id: `${loaded.username}:${row.id}`,
      pass: { ...row.pass, label: `${row.pass.label} · @${loaded.username}` },
    }))),
    dailyTotal: loadedAccounts.reduce((sum, loaded) => sum + loaded.dailyTotal, 0),
    source: 'public_reconstruction',
    capturedAt: loadedAccounts.map((loaded) => loaded.capturedAt ?? '').sort().at(-1),
  }
}

function EarningsBarChart({
  entries,
  compact = false,
}: {
  entries: EarningsHistoryEntry[]
  compact?: boolean
}) {
  const weekly = entries.length > 45
  const buckets = weekly ? weeklyEarningsTotals(entries) : entries
  const ceiling = earningsChartCeiling(Math.max(1, ...buckets.map((entry) => entry.dailyTotal)))
  if (entries.length === 0) return <p className="empty">No tracked days yet.</p>

  return (
    <div><p className="earnings-chart-granularity">{weekly ? 'Weekly totals · week starting Monday' : 'Daily totals'}</p><div className={`earnings-chart-layout${compact ? ' is-compact' : ''}`}>
      <div className="earnings-chart-axis" aria-hidden="true">
        <span>{formatRax(ceiling)}</span>
        <span>{formatRax(ceiling / 2)}</span>
        <span>0</span>
      </div>
      <div className={`earnings-chart${buckets.length <= 7 ? ' is-sparse' : ''}${buckets.length > 16 ? ' is-dense' : ''}`} role="img" aria-label={`${weekly ? 'Weekly' : 'Daily'} earnings for ${entries.length} tracked days`}>
        {buckets.map((entry, index) => {
          const dayLabel = earningsChartDayLabel(entry.day)
          return (
            <div className={`earnings-chart-column${index % Math.ceil(buckets.length / 8) === 0 || index === buckets.length - 1 ? ' has-label' : ''}`} key={entry.day} title={`${weekly ? 'Week of ' : ''}${dayLabel.full}: ${formatRax(entry.dailyTotal)} RAX`}>
              <strong>{formatRax(entry.dailyTotal)}</strong>
              <div className="earnings-chart-track"><span style={{ height: `${Math.max(3, (entry.dailyTotal / ceiling) * 100)}%` }} /></div>
              <small><span>{dayLabel.weekday}</span><span>{dayLabel.date}</span></small>
            </div>
          )
        })}
      </div>
    </div></div>
  )
}

export default function EarningsPage() {
  const { data, addPackAccountTemplate, updatePackAccountTemplate, removePackAccountTemplate } = useRaxData()
  const templates = data.packAccountTemplates ?? []
  const linkedAccounts = useMemo(() => templates.flatMap((template) => {
      const username = normalizeUsername(template.username)
      return username ? [{ id: template.id, name: template.name, username }] : []
    }), [templates])
  const accounts = useMemo(() => [
    ...(import.meta.env.DEV ? [{ id: 'dev-demo', name: 'Demo report', username: DEMO_USERNAME }] : []),
    { id: 'all-linked', name: 'All accounts', username: ALL_ACCOUNTS },
    ...linkedAccounts,
  ], [linkedAccounts])
  const [selectedUsername, setSelectedUsername] = useState(import.meta.env.DEV ? DEMO_USERNAME : accounts[0]?.username ?? '')
  const isDemo = import.meta.env.DEV && selectedUsername === DEMO_USERNAME
  const isAllAccounts = selectedUsername === ALL_ACCOUNTS
  const [latestDay, setLatestDay] = useState(currentRealEarningsDay)
  const [day, setDay] = useState(import.meta.env.DEV ? DEMO_RESULT.day : latestDay)
  const [accountResults, setAccountResults] = useState<DailyEarningsResultCache>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshLog, setRefreshLog] = useState<RefreshLogEntry[]>([])
  const [historyRange, setHistoryRange] = useState<'30' | '90' | 'all' | 'custom'>('30')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [historyLimit, setHistoryLimit] = useState<number | null>(null)
  const [history, setHistory] = useState<EarningsHistoryEntry[]>(() => isDemo ? DEMO_HISTORY : readEarningsHistory())
  const result = useMemo(() => {
    if (isDemo) return DEMO_RESULT
    const usernames = isAllAccounts
      ? linkedAccounts.map((account) => account.username)
      : [selectedUsername]
    const loadedAccounts = readCachedDailyEarningsResults(accountResults, usernames, day)
    return combineDailyResults(loadedAccounts, day, isAllAccounts)
  }, [accountResults, day, isAllAccounts, isDemo, linkedAccounts, selectedUsername])

  const accountHistory = useMemo(() => {
    if (!isAllAccounts) {
      return history.filter((row) => row.username.toLowerCase() === selectedUsername.toLowerCase())
    }
    const linked = new Set(linkedAccounts.map((account) => account.username.toLowerCase()))
    const byDay = new Map<string, EarningsHistoryEntry>()
    for (const row of history) {
      if (!linked.has(row.username.toLowerCase())) continue
      const existing = byDay.get(row.day)
      byDay.set(row.day, existing ? {
        ...existing,
        dailyTotal: existing.dailyTotal + row.dailyTotal,
        passes: [...existing.passes, ...row.passes],
        capturedAt: existing.capturedAt > row.capturedAt ? existing.capturedAt : row.capturedAt,
      } : { ...row, username: ALL_ACCOUNTS })
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  }, [history, isAllAccounts, linkedAccounts, selectedUsername])
  const availableDays = useMemo(
    () => [...new Set(accountHistory.map((row) => row.day))].sort((a, b) => b.localeCompare(a)),
    [accountHistory],
  )
  const reportDays = useMemo(
    () => [...new Set([latestDay, ...availableDays])].sort((a, b) => b.localeCompare(a)),
    [availableDays, latestDay],
  )
  const isHistoricalDay = day !== latestDay
  const rangeStartDay = useMemo(() => {
    if (historyRange === 'all') return ''
    if (historyRange === 'custom') return rangeStart
    const date = new Date(`${day}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - (Number(historyRange) - 1))
    return date.toISOString().slice(0, 10)
  }, [day, historyRange, rangeStart])
  const rangeEndDay = historyRange === 'custom' ? rangeEnd : historyRange === 'all' ? '' : day
  const invalidRange = Boolean(rangeStartDay && rangeEndDay && rangeStartDay > rangeEndDay)
  const rangeHistory = invalidRange ? [] : filterEarningsHistory(accountHistory, rangeStartDay, rangeEndDay)
  const selectedDate = new Date(`${day}T12:00:00`)
  const weekStart = new Date(selectedDate)
  weekStart.setDate(selectedDate.getDate() - ((selectedDate.getDay() + 6) % 7))
  const weekStartKey = weekStart.toISOString().slice(0, 10)
  const weekRows = accountHistory.filter((row) => row.day >= weekStartKey && row.day <= day)
  const weeklyTotal = sumHistory(weekRows)
  const previousWeekStart = new Date(weekStart)
  previousWeekStart.setDate(previousWeekStart.getDate() - 7)
  const previousWeekEnd = new Date(weekStart)
  previousWeekEnd.setDate(previousWeekEnd.getDate() - 1)
  const previousWeekRows = accountHistory.filter((row) => row.day >= previousWeekStart.toISOString().slice(0, 10) && row.day <= previousWeekEnd.toISOString().slice(0, 10))
  const previousWeekTotal = sumHistory(previousWeekRows)
  const monthRows = accountHistory.filter((row) => row.day.startsWith(day.slice(0, 7)))
  const monthlyTotal = sumHistory(monthRows)
  const previousMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1)
  const previousMonthKey = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`
  const previousMonthTotal = sumHistory(accountHistory.filter((row) => row.day.startsWith(previousMonthKey)))
  const weekBest = Math.max(0, ...weekRows.map((row) => row.dailyTotal))
  const monthBest = Math.max(0, ...monthRows.map((row) => row.dailyTotal))
  const yesterdayDay = previousDayKey(day)
  const yesterday = accountHistory.find((row) => row.day === yesterdayDay)
  const selectedDayTotal = result?.dailyTotal
    ?? accountHistory.find((row) => row.day === day)?.dailyTotal
    ?? 0
  const accountCharts = useMemo(() => linkedAccounts.map((account) => ({
    ...account,
    entries: history
      .filter((row) => row.username.toLowerCase() === account.username.toLowerCase())
      .sort((a, b) => a.day.localeCompare(b.day))
      .filter((row) => !invalidRange && (!rangeStartDay || row.day >= rangeStartDay) && (!rangeEndDay || row.day <= rangeEndDay)),
  })), [history, linkedAccounts, invalidRange, rangeStartDay, rangeEndDay])
  const reportSubject = isAllAccounts ? 'all linked accounts' : `@${result?.username ?? selectedUsername}`
  const highestDay = highestEarningDay(rangeHistory)
  const bestWeekday = highestAverageWeekday(rangeHistory)
  const topPasses = rankEarningPasses(rangeHistory)
  const selectedDayRows = result
    ? [historyEntry(result)]
    : accountHistory.filter((row) => row.day === day)
  const sportRankings = rankEarningSports(rangeHistory)
  const daySportTotals = new Map(
    rankEarningSports(selectedDayRows).map((row) => [row.sport.toLowerCase(), row.total]),
  )
  const weekSportTotals = new Map(
    rankEarningSports(weekRows).map((row) => [row.sport.toLowerCase(), row.total]),
  )
  const monthSportTotals = new Map(
    rankEarningSports(monthRows).map((row) => [row.sport.toLowerCase(), row.total]),
  )
  const trackedSportTotal = sportRankings.reduce((sum, row) => sum + row.total, 0)
  const topSport = sportRankings[0]
  const hasReportData = Boolean(result || accountHistory.length > 0)

  useEffect(() => {
    if (!accounts.some((account) => account.username === selectedUsername)) setSelectedUsername(accounts[0]?.username ?? '')
  }, [accounts, selectedUsername])

  useEffect(() => {
    const controller = new AbortController()
    void syncLinkedEarningsTracking(
      linkedAccounts.map((account) => account.username),
      controller.signal,
    ).then(({ snapshots, historyLimitPerAccount }) => {
      if (!isDemo) {
        setHistoryLimit(historyLimitPerAccount ?? null)
        setHistory(replaceEarningsHistoryForUsernames(
          snapshots.map(historyEntry),
          linkedAccounts.map((account) => account.username),
        ))
        setAccountResults((current) => {
          const snapshotsByAccountAndDay = cacheDailyEarningsResults({}, snapshots)
          return { ...snapshotsByAccountAndDay, ...current }
        })
      }
    }).catch((trackingError) => {
      if (!(trackingError instanceof DOMException && trackingError.name === 'AbortError')) {
        setError(trackingError instanceof Error ? trackingError.message : 'Could not synchronize linked earnings accounts.')
      }
    })
    return () => controller.abort()
  }, [isDemo, linkedAccounts])

  useEffect(() => {
    if (isDemo) {
      setDay(DEMO_RESULT.day)
      setHistory(DEMO_HISTORY)
      setError('')
    } else {
      const currentDay = currentRealEarningsDay()
      setLatestDay(currentDay)
      setDay(currentDay)
      setHistory(readEarningsHistory())
    }
  }, [isDemo])

  useEffect(() => {
    if (isDemo) return
    const updateDay = () => {
      const next = currentRealEarningsDay()
      setLatestDay((previous) => {
        setDay((selected) => selected === previous ? next : selected)
        return next
      })
    }
    updateDay()
    const timer = window.setInterval(updateDay, 60_000)
    return () => window.clearInterval(timer)
  }, [isDemo])

  async function loadEarnings() {
    if (isDemo) return
    const targets = isAllAccounts ? linkedAccounts.map((account) => account.username) : [selectedUsername]
    if (targets.length === 0 || !selectedUsername) { setError('Add a linked Real username first.'); return }
    setLoading(true); setError('')
    setRefreshLog(targets.map((username) => ({
      username,
      status: 'queued',
      message: 'Waiting to start',
    })))
    const updateLog = (username: string, patch: Partial<RefreshLogEntry>) => {
      setRefreshLog((entries) => entries.map((entry) => (
        entry.username === username ? { ...entry, ...patch } : entry
      )))
    }
    const failures: string[] = []
    const refreshId = crypto.randomUUID().replace(/-/g, '')
    try {
      // Keep account scans sequential. Shared public game data is cached server-side, so later
      // accounts are faster without multiplying Real API traffic and triggering more 429s.
      for (let index = 0; index < targets.length; index += 1) {
        const username = targets[index]!
        const startedAt = performance.now()
        updateLog(username, {
          status: 'fetching',
          message: `Fetching account ${index + 1} of ${targets.length}…`,
        })

        let loaded: DailyEarningsResult | null = null
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            loaded = await fetchAccountDailyEarnings(username, day, { refreshId })
            break
          } catch (loadError) {
            if (attempt === 0 && isRateLimited(loadError)) {
              updateLog(username, {
                status: 'retrying',
                message: 'Real rate limited the scan. Cooling down for 5 seconds, then retrying…',
              })
              await wait(ACCOUNT_RATE_LIMIT_RETRY_MS)
              updateLog(username, {
                status: 'fetching',
                message: `Retrying account ${index + 1} of ${targets.length}…`,
              })
              continue
            }
            const message = loadError instanceof Error ? loadError.message : 'Could not load earnings.'
            failures.push(`@${username}: ${message}`)
            updateLog(username, { status: 'failed', message })
            break
          }
        }

        if (!loaded) continue
        setAccountResults((current) => cacheDailyEarningsResult(current, loaded))
        setHistory(saveEarningsHistoryEntry(historyEntry(loaded)))
        const seconds = Math.max(1, Math.round((performance.now() - startedAt) / 1000))
        updateLog(username, {
          status: 'complete',
          message: `${formatRax(loaded.dailyTotal)} RAX from ${loaded.earnings.length} pass${loaded.earnings.length === 1 ? '' : 'es'} · ${seconds}s`,
        })
      }
      if (failures.length > 0) {
        setError(`${failures.length} account${failures.length === 1 ? '' : 's'} could not be refreshed. Completed accounts were kept.`)
      }
    } finally { setLoading(false) }
  }

  return (
    <div className="page-stack earnings-page refresh-page">
      <section className="earnings-hero">
        <div className="earnings-hero-copy">
          <p className="eyebrow">Earnings report</p>
          <h1>Earnings</h1>
          <p>{result?.dayDisplay ?? displayEarningsDay(day)} · Active-season player-card RAX</p>
          {isDemo ? <span className="earnings-demo-badge">Development preview data</span> : null}
        </div>
        <Link className="earnings-back-link" to="/profile">← Profile</Link>
      </section>

      <section className="earnings-controls">
        <div className="earnings-controls-heading">
          <div>
            <span className="earnings-control-label">Report scope</span>
            <strong>Whose earnings do you want to review?</strong>
          </div>
          <small>{linkedAccounts.length} linked account{linkedAccounts.length === 1 ? '' : 's'}</small>
        </div>
        <div className="earnings-controls-body">
          <div className="earnings-account-picker">
          <div className="earnings-account-tabs">
            {accounts.map((account) => {
              const active = selectedUsername === account.username
              const combined = account.username === ALL_ACCOUNTS
              return (
                <button
                  aria-pressed={active}
                  className={`earnings-account-tab${active ? ' is-active' : ''}${combined ? ' is-combined' : ''}`}
                  type="button"
                  key={account.id}
                  onClick={() => setSelectedUsername(account.username)}
                >
                  <span className="earnings-account-avatar">{combined ? 'Σ' : account.name.slice(0, 1).toUpperCase()}</span>
                  <span className="earnings-account-copy">
                    <strong>{account.name}</strong>
                    <small>{combined ? 'Combined' : `@${account.username}`}</small>
                  </span>
                  {active ? <span className="earnings-account-check" aria-hidden="true">✓</span> : null}
                </button>
              )
            })}
          </div>
        </div>
          <div className="earnings-control-actions">
            {!isDemo ? <label className="earnings-day-picker"><span className="earnings-control-label">Earnings day</span><select value={day} onChange={(event) => setDay(event.target.value)}>{reportDays.map((reportDay) => <option value={reportDay} key={reportDay}>{displayEarningsDay(reportDay)}{reportDay === latestDay ? ' · Current' : ' · Saved'}</option>)}</select></label> : null}
            <button className="button primary" type="button" disabled={loading || !day || isDemo || isHistoricalDay} onClick={() => void loadEarnings()}>{isDemo ? 'Preview report' : isHistoricalDay ? 'Saved snapshot' : loading ? 'Loading…' : isAllAccounts ? 'Refresh all accounts' : 'Refresh earnings'}</button>
          </div>
        </div>
      </section>
      {refreshLog.length > 0 ? (
        <section className="panel earnings-refresh-log" aria-live="polite">
          <div className="earnings-refresh-log-heading">
            <div>
              <span>Refresh activity</span>
              <strong>{refreshLog.filter((entry) => entry.status === 'complete').length} of {refreshLog.length} accounts complete</strong>
            </div>
            {loading ? <span className="earnings-refresh-live">Running</span> : <span>Finished</span>}
          </div>
          <div className="earnings-refresh-progress" aria-hidden="true">
            <span style={{ width: `${(refreshLog.filter((entry) => entry.status === 'complete' || entry.status === 'failed').length / refreshLog.length) * 100}%` }} />
          </div>
          <ol className="earnings-refresh-events">
            {refreshLog.map((entry) => (
              <li className={`is-${entry.status}`} key={entry.username}>
                <span className="earnings-refresh-status" aria-hidden="true" />
                <div><strong>@{entry.username}</strong><small>{entry.message}</small></div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {result?.source === 'public_reconstruction' ? <p className="earnings-source-note">Live preview from the complete active-pass collection, boosters, and Real box scores. Reports use the first successful scheduled snapshot beginning at 4:30 AM Eastern.</p> : null}

      {hasReportData ? <>
        <section className="earnings-overview" aria-label="Earnings overview">
          <div><span>Selected day</span><strong>{formatRax(selectedDayTotal)} RAX</strong></div>
          <div><span>Yesterday</span><strong>{yesterday ? `${formatRax(yesterday.dailyTotal)} RAX` : '—'}</strong></div>
          <div><span>This week</span><strong>{formatRax(weeklyTotal)} RAX</strong><small>{percentChange(weeklyTotal, previousWeekTotal)} vs prior week</small></div>
          <div><span>This month</span><strong>{formatRax(monthlyTotal)} RAX</strong><small>{percentChange(monthlyTotal, previousMonthTotal)} vs prior month</small></div>
        </section>
        <details className="earnings-period-details"><summary>Week and month details</summary><div className="earnings-period-grid">
          <div className="earnings-period-card"><div><span>Weekly report</span><strong>{formatRax(weeklyTotal)} RAX</strong></div><dl><div><dt>Average / active day</dt><dd>{formatRax(weekRows.length ? weeklyTotal / weekRows.length : 0)}</dd></div><div><dt>Best day</dt><dd>{formatRax(weekBest)}</dd></div><div><dt>Active days</dt><dd>{weekRows.length}</dd></div></dl></div>
          <div className="earnings-period-card"><div><span>Monthly report</span><strong>{formatRax(monthlyTotal)} RAX</strong></div><dl><div><dt>Average / active day</dt><dd>{formatRax(monthRows.length ? monthlyTotal / monthRows.length : 0)}</dd></div><div><dt>Best day</dt><dd>{formatRax(monthBest)}</dd></div><div><dt>Active days</dt><dd>{monthRows.length}</dd></div></dl></div>
        </div></details>
        <section className="panel earnings-report-panel"><div className="section-heading"><div><h2>Earnings history</h2><p>Daily RAX for {reportSubject} · {rangeHistory.length} tracked days. Only available snapshots are shown.</p></div><div className="earnings-chart-summary"><span>Selected range</span><strong>{formatRax(sumHistory(rangeHistory))} RAX</strong></div></div>
          <div className="earnings-range-controls" aria-label="History range">{(['30', '90', 'all', 'custom'] as const).map((range) => <button className={`button compact${historyRange === range ? ' is-selected' : ''}`} aria-pressed={historyRange === range} key={range} type="button" onClick={() => setHistoryRange(range)}>{range === 'all' ? 'All available' : range === 'custom' ? 'Custom' : `${range} days`}</button>)}</div>
          {historyRange === 'custom' ? <div className="earnings-range-dates"><label>From <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label><label>To <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label></div> : null}
          {invalidRange ? <p className="form-error">The start date must be before the end date.</p> : <EarningsBarChart entries={rangeHistory} />}
          <p className="earnings-history-note">{historyLimit && !isDemo ? `Up to ${historyLimit} recent scheduled snapshots per account are loaded, alongside locally available history. ` : ''}History begins when snapshots were captured; missing days are not estimated.</p>
          <div className="earnings-range-highlights"><span>Best day <strong>{highestDay ? `${formatRax(highestDay.dailyTotal)} RAX · ${highestDay.day}` : '—'}</strong></span><span>Best weekday average <strong>{bestWeekday ? `${bestWeekday.weekday} · ${formatRax(bestWeekday.average)} RAX` : '—'}</strong></span><span>Top sport <strong>{topSport?.sport ?? '—'}</strong></span></div>
        </section>
        {isAllAccounts ? <section className="earnings-account-chart-grid" aria-label="Earnings by account">{accountCharts.map((account) => <article className="panel earnings-account-chart" key={account.id}><div className="earnings-account-chart-heading"><div><span>{account.name}</span><strong>@{account.username}</strong></div><div><small>Selected range</small><strong>{formatRax(sumHistory(account.entries))} RAX</strong></div></div><EarningsBarChart entries={account.entries} compact /></article>)}</section> : null}
        <section className="panel earnings-report-panel">
          <div className="section-heading"><div><h2>Highest earning sports</h2><p>Ranked by total RAX in the selected history range for {reportSubject}.</p></div><div className="earnings-chart-summary"><span>Sports tracked</span><strong>{sportRankings.length}</strong></div></div>
          {sportRankings.length === 0 ? <p className="empty">No sport earnings in this range.</p> : <div className="earnings-sport-rankings">{sportRankings.map((sport, index) => {
            const key = sport.sport.toLowerCase()
            const share = trackedSportTotal > 0 ? (sport.total / trackedSportTotal) * 100 : 0
            return <article className="earnings-sport-row" key={key}>
              <div className="earnings-sport-rank"><span>{index + 1}</span><div><strong>{sport.sport}</strong><small>{sport.passes} earning pass{sport.passes === 1 ? '' : 'es'} · {sport.days} tracked day{sport.days === 1 ? '' : 's'} · best {formatRax(sport.best)} RAX</small></div></div>
              <div className="earnings-sport-bar" aria-label={`${sport.sport} accounts for ${Math.round(share)} percent of earnings in the selected range`}><span style={{ width: `${Math.max(2, share)}%` }} /></div>
              <dl className="earnings-sport-stats"><div><dt>Selected day</dt><dd>{formatRax(daySportTotals.get(key) ?? 0)}</dd></div><div><dt>This week</dt><dd>{formatRax(weekSportTotals.get(key) ?? 0)}</dd></div><div><dt>This month</dt><dd>{formatRax(monthSportTotals.get(key) ?? 0)}</dd></div><div><dt>Range total</dt><dd>{formatRax(sport.total)}</dd></div></dl>
            </article>
          })}</div>}
        </section>
        <section className="panel earnings-report-panel"><div className="section-heading"><div><h2>Highest earning passes</h2><p>Top player passes in the selected history range for {reportSubject}.</p></div></div>{topPasses.length === 0 ? <p className="empty">No pass earnings in this range.</p> : <div className="earnings-list">{topPasses.map((pass, index) => <article className="earnings-row earnings-ranked-pass" key={`${pass.username}:${pass.label}:${index}`}><div className="earnings-pass-rank"><span className="earnings-pass-rank-number">{index + 1}</span><PassIdentity name={pass.label} sport={pass.sport} avatar={pass.avatar} meta={[pass.sport, isAllAccounts ? `@${pass.username}` : '', `${pass.days} earning day${pass.days === 1 ? '' : 's'}`, `best ${formatRax(pass.best)} RAX`].filter(Boolean).join(' · ')} /></div><div className="earnings-row-total"><strong>{formatRax(pass.total)} RAX</strong><small>Selected range</small></div></article>)}</div>}</section>
        <section className="panel earnings-report-panel"><div className="section-heading"><div><h2>What earned on this day</h2><p>{result ? `${result.earnings.length} player pass${result.earnings.length === 1 ? '' : 'es'} contributed.` : `No saved snapshot for ${displayEarningsDay(day)}.`}</p></div></div>{result ? <div className="earnings-list">{result.earnings.map((row) => <article className="earnings-row" key={row.id || row.pass.id}><PassIdentity name={row.pass.label} passKind="player" sport={row.pass.sport} avatar={row.pass.avatar} meta={[row.pass.sport, row.pass.season, row.pass.rarityLabel].filter(Boolean).join(' · ')} /><div className="earnings-row-total"><strong>{formatRax(row.totalEarnings)} RAX</strong>{row.infos.length ? <small>{row.infos.map((info) => `${info.label}: ${info.value}`).join(' · ')}</small> : null}</div></article>)}</div> : <p className="empty">Choose a saved day above, or refresh the current day for a live preview.</p>}</section>
      </> : null}

      {!hasReportData && !isDemo ? <section className="panel earnings-report-panel"><div className="section-heading"><div><h2>No saved earnings yet</h2><p>The first completed snapshot from 4:30 AM Eastern will appear here automatically. You can still refresh the current day for a live preview.</p></div></div></section> : null}

      <section className="panel earnings-accounts-panel"><details className="earnings-accounts-disclosure"><summary><div><h2>Linked accounts</h2><span>{linkedAccounts.length} configured</span></div><span className="earnings-disclosure-icon" aria-hidden="true">⌄</span></summary><div className="earnings-accounts-body"><div className="earnings-accounts-intro"><p>The same account list used by Packs. There is no required primary account.</p><button className="button compact" type="button" onClick={() => addPackAccountTemplate()}>Add account</button></div>{templates.length === 0 ? <p className="empty">No linked accounts yet. The development report above is preview-only.</p> : <div className="pack-account-list">{templates.map((account) => <div className="pack-account-row" key={account.id}><label className="pack-account-field"><span>Name</span><input value={account.name} onChange={(event) => updatePackAccountTemplate(account.id, { name: event.target.value })} /></label><label className="pack-account-field"><span>Real username</span><input value={account.username} placeholder="@username" onChange={(event) => updatePackAccountTemplate(account.id, { username: event.target.value })} /></label><button className="button danger compact" type="button" onClick={() => removePackAccountTemplate(account.id)}>Remove</button></div>)}</div>}</div></details></section>
    </div>
  )
}
