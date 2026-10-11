import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PassIdentity } from '../components/PassIdentity'
import { useRaxData } from '../context/RaxDataContext'
import { fetchAccountDailyEarnings, syncLinkedEarningsTracking, type DailyEarningsResult } from '../lib/dailyEarnings'
import { highestAverageWeekday, highestEarningDay, rankEarningPasses, readEarningsHistory, saveEarningsHistoryEntries, saveEarningsHistoryEntry, sumHistory, type EarningsHistoryEntry } from '../lib/earningsHistory'
import { formatRax } from '../lib/format'

function localDay(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function normalizeUsername(value: string): string {
  return value.replace(/^@/, '').trim()
}

function percentChange(current: number, previous: number): string {
  if (previous <= 0) return current > 0 ? 'New' : '—'
  const change = Math.round(((current - previous) / previous) * 100)
  return `${change >= 0 ? '+' : ''}${change}%`
}

const DEMO_USERNAME = 'demo-collector'
const ALL_ACCOUNTS = '__all-linked-accounts__'
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
  const [day, setDay] = useState(import.meta.env.DEV ? DEMO_RESULT.day : localDay)
  const [result, setResult] = useState<DailyEarningsResult | null>(isDemo ? DEMO_RESULT : null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<EarningsHistoryEntry[]>(() => isDemo ? DEMO_HISTORY : readEarningsHistory())

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
  const recentHistory = accountHistory.slice(-30)
  const maxDaily = Math.max(1, ...recentHistory.map((row) => row.dailyTotal))
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
  const chartCeiling = Math.max(25, Math.ceil(maxDaily / 25) * 25)
  const reportSubject = isAllAccounts ? 'all linked accounts' : `@${result?.username ?? selectedUsername}`
  const highestDay = highestEarningDay(accountHistory)
  const bestWeekday = highestAverageWeekday(accountHistory)
  const topPasses = rankEarningPasses(accountHistory)

  useEffect(() => {
    if (!accounts.some((account) => account.username === selectedUsername)) setSelectedUsername(accounts[0]?.username ?? '')
  }, [accounts, selectedUsername])

  useEffect(() => {
    const controller = new AbortController()
    void syncLinkedEarningsTracking(
      linkedAccounts.map((account) => account.username),
      controller.signal,
    ).then(({ snapshots }) => {
      if (!isDemo && snapshots.length > 0) {
        setHistory(saveEarningsHistoryEntries(snapshots.map(historyEntry)))
        const scoped = isAllAccounts
          ? snapshots
          : snapshots.filter((snapshot) => snapshot.username.toLowerCase() === selectedUsername.toLowerCase())
        const latestDay = scoped.map((snapshot) => snapshot.day).sort().at(-1)
        if (latestDay) {
          setDay(latestDay)
          setResult(combineDailyResults(
            scoped.filter((snapshot) => snapshot.day === latestDay),
            latestDay,
            isAllAccounts,
          ))
        }
      }
    }).catch((trackingError) => {
      if (!(trackingError instanceof DOMException && trackingError.name === 'AbortError')) {
        setError(trackingError instanceof Error ? trackingError.message : 'Could not synchronize linked earnings accounts.')
      }
    })
    return () => controller.abort()
  }, [isAllAccounts, isDemo, linkedAccounts, selectedUsername])

  useEffect(() => {
    if (isDemo) {
      setDay(DEMO_RESULT.day)
      setResult(DEMO_RESULT)
      setHistory(DEMO_HISTORY)
      setError('')
    } else {
      setResult(null)
      setHistory(readEarningsHistory())
    }
  }, [isDemo])

  useEffect(() => {
    if (!isDemo) setResult(null)
  }, [isDemo, selectedUsername])

  async function loadEarnings() {
    if (isDemo) return
    const targets = isAllAccounts ? linkedAccounts.map((account) => account.username) : [selectedUsername]
    if (targets.length === 0 || !selectedUsername) { setError('Add a linked Real username first.'); return }
    setLoading(true); setError('')
    try {
      const loadedAccounts = await Promise.all(targets.map((username) => fetchAccountDailyEarnings(username, day)))
      let nextHistory = readEarningsHistory()
      for (const loaded of loadedAccounts) {
        nextHistory = saveEarningsHistoryEntry(historyEntry(loaded))
      }
      setHistory(nextHistory)
      setResult(combineDailyResults(loadedAccounts, day, isAllAccounts))
    } catch (loadError) {
      setResult(null)
      setError(loadError instanceof Error ? loadError.message : 'Could not load earnings.')
    } finally { setLoading(false) }
  }

  return (
    <div className="page-stack earnings-page">
      <section className="earnings-hero">
        <div className="earnings-hero-copy">
          <p className="eyebrow">Earnings report</p>
          <h1>Daily player-card earnings</h1>
          <p>Active-season RAX by account and date. On This Day claims are tracked separately.</p>
          {isDemo ? <span className="earnings-demo-badge">Development preview data</span> : null}
        </div>
        <div className="earnings-hero-total"><span>{result?.dayDisplay ?? 'Selected day'}</span><strong>{formatRax(result?.dailyTotal ?? 0)}</strong><small>RAX earned</small></div>
        <Link className="earnings-back-link" to="/profile">← Profile</Link>
      </section>

      <section className="earnings-controls">
        <div className="earnings-account-picker">
          <span className="earnings-control-label">Report scope</span>
          <div className="earnings-account-tabs">
            {accounts.map((account) => <button className={`earnings-account-tab${selectedUsername === account.username ? ' is-active' : ''}`} type="button" key={account.id} onClick={() => setSelectedUsername(account.username)}><span>{account.username === ALL_ACCOUNTS ? 'Σ' : account.name.slice(0, 1).toUpperCase()}</span><strong>{account.name}</strong>{account.username !== ALL_ACCOUNTS ? <small>@{account.username}</small> : <small>{linkedAccounts.length} linked</small>}</button>)}
          </div>
        </div>
        <label className="earnings-date-control"><span>Report date</span><input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>
        <button className="button primary" type="button" disabled={loading || !day || isDemo} onClick={() => void loadEarnings()}>{isDemo ? 'Preview report' : loading ? 'Loading…' : 'Refresh earnings'}</button>
      </section>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {result?.source === 'public_reconstruction' ? <p className="earnings-source-note">Calculated from public active passes, boosters, and Real box scores. Linked accounts are refreshed automatically each morning.</p> : null}

      {result ? <>
        <section className="earnings-summary-grid">
          <div className="panel earnings-summary-card earnings-summary-primary"><span>Daily earnings</span><strong>{formatRax(result.dailyTotal)} RAX</strong><small>{result.dayDisplay}</small></div>
          <div className="panel earnings-summary-card"><span>This week</span><strong>{formatRax(weeklyTotal)} RAX</strong><small>Monday through selected day</small></div>
          <div className="panel earnings-summary-card"><span>This month</span><strong>{formatRax(monthlyTotal)} RAX</strong><small>{selectedDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</small></div>
          <div className="panel earnings-summary-card"><span>Highest earned day</span><strong>{formatRax(highestDay?.dailyTotal ?? 0)} RAX</strong><small>{highestDay?.day ?? 'No tracked days yet'}</small></div>
          <div className="panel earnings-summary-card"><span>Best average weekday</span><strong>{bestWeekday?.weekday ?? '—'}</strong><small>{bestWeekday ? `${formatRax(bestWeekday.average)} RAX average across ${bestWeekday.days} day${bestWeekday.days === 1 ? '' : 's'}` : 'No tracked days yet'}</small></div>
        </section>
        <section className="earnings-period-grid">
          <div className="panel earnings-period-card"><div><span>Weekly report</span><strong>{formatRax(weeklyTotal)} RAX</strong></div><dl><div><dt>Average / active day</dt><dd>{formatRax(weekRows.length ? weeklyTotal / weekRows.length : 0)}</dd></div><div><dt>Best day</dt><dd>{formatRax(weekBest)}</dd></div><div><dt>Active days</dt><dd>{weekRows.length}</dd></div><div><dt>vs prior week</dt><dd className={weeklyTotal >= previousWeekTotal ? 'is-positive' : 'is-negative'}>{percentChange(weeklyTotal, previousWeekTotal)}</dd></div></dl></div>
          <div className="panel earnings-period-card"><div><span>Monthly report</span><strong>{formatRax(monthlyTotal)} RAX</strong></div><dl><div><dt>Average / active day</dt><dd>{formatRax(monthRows.length ? monthlyTotal / monthRows.length : 0)}</dd></div><div><dt>Best day</dt><dd>{formatRax(monthBest)}</dd></div><div><dt>Active days</dt><dd>{monthRows.length}</dd></div><div><dt>vs prior month</dt><dd className={monthlyTotal >= previousMonthTotal ? 'is-positive' : 'is-negative'}>{percentChange(monthlyTotal, previousMonthTotal)}</dd></div></dl></div>
        </section>
        <section className="panel earnings-report-panel"><div className="section-heading"><div><h2>Last 30 tracked days</h2><p>Daily RAX for {reportSubject}. Hover a bar for the exact date and amount.</p></div><div className="earnings-chart-summary"><span>30-day total</span><strong>{formatRax(sumHistory(recentHistory))} RAX</strong></div></div>
          <div className="earnings-chart-layout"><div className="earnings-chart-axis"><span>{formatRax(chartCeiling)}</span><span>{formatRax(chartCeiling / 2)}</span><span>0</span></div><div className="earnings-chart" role="img" aria-label="Daily earnings over the last 30 tracked days">{recentHistory.map((entry, index) => { const showLabel = index === 0 || index === recentHistory.length - 1 || index % 5 === 0; return <div className="earnings-chart-column" key={entry.day} title={`${entry.day}: ${formatRax(entry.dailyTotal)} RAX`}><strong className={showLabel ? '' : 'is-hidden'}>{formatRax(entry.dailyTotal)}</strong><div className="earnings-chart-track"><span style={{ height: `${Math.max(3, (entry.dailyTotal / chartCeiling) * 100)}%` }} /></div><small className={showLabel ? '' : 'is-hidden'}>{entry.day.slice(5)}</small></div> })}</div></div>
        </section>
        <section className="panel earnings-report-panel"><div className="section-heading"><div><h2>Highest earning passes</h2><p>Top player passes across every tracked day for {reportSubject}.</p></div></div>{topPasses.length === 0 ? <p className="empty">Pass rankings will appear after the first tracked refresh.</p> : <div className="earnings-list">{topPasses.map((pass, index) => <article className="earnings-row earnings-ranked-pass" key={`${pass.username}:${pass.label}:${index}`}><div><strong><span>{index + 1}</span>{pass.label}</strong><small>{[pass.sport, isAllAccounts ? `@${pass.username}` : '', `${pass.days} earning day${pass.days === 1 ? '' : 's'}`, `best ${formatRax(pass.best)} RAX`].filter(Boolean).join(' · ')}</small></div><div className="earnings-row-total"><strong>{formatRax(pass.total)} RAX</strong><small>Total tracked</small></div></article>)}</div>}</section>
        <section className="panel earnings-report-panel"><div className="section-heading"><div><h2>What earned today</h2><p>{result.earnings.length} player pass{result.earnings.length === 1 ? '' : 'es'} contributed.</p></div></div><div className="earnings-list">{result.earnings.map((row) => <article className="earnings-row" key={row.id || row.pass.id}><PassIdentity name={row.pass.label} passKind="player" sport={row.pass.sport} avatar={row.pass.avatar} meta={[row.pass.sport, row.pass.season, row.pass.rarityLabel].filter(Boolean).join(' · ')} /><div className="earnings-row-total"><strong>{formatRax(row.totalEarnings)} RAX</strong>{row.infos.length ? <small>{row.infos.map((info) => `${info.label}: ${info.value}`).join(' · ')}</small> : null}</div></article>)}</div></section>
      </> : null}

      <section className="panel earnings-accounts-panel"><div className="section-heading"><div><h2>Linked accounts</h2><p>The same account list used by Packs. There is no required primary account.</p></div><button className="button compact" type="button" onClick={() => addPackAccountTemplate()}>Add account</button></div>
        {templates.length === 0 ? <p className="empty">No linked accounts yet. The development report above is preview-only.</p> : <div className="pack-account-list">{templates.map((account) => <div className="pack-account-row" key={account.id}><label className="pack-account-field"><span>Name</span><input value={account.name} onChange={(event) => updatePackAccountTemplate(account.id, { name: event.target.value })} /></label><label className="pack-account-field"><span>Real username</span><input value={account.username} placeholder="@username" onChange={(event) => updatePackAccountTemplate(account.id, { username: event.target.value })} /></label><button className="button danger compact" type="button" onClick={() => removePackAccountTemplate(account.id)}>Remove</button></div>)}</div>}
      </section>
    </div>
  )
}
