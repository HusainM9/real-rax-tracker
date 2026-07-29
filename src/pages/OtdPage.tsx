import { useEffect, useMemo, useState } from 'react'
import { ChecklistMultiSelect } from '../components/ChecklistMultiSelect'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { PassIdentity } from '../components/PassIdentity'
import {
  browseOtdPasses,
  fetchCatalogImportProfile,
  fetchCatalogSeasonYears,
  type CatalogImportProfile,
  type CatalogPassKind,
  type CatalogSearchResult,
} from '../lib/catalogApi'
import { CALENDAR_MONTH_NAMES } from '../lib/calendarView'
import { formatClaimDay, formatRax } from '../lib/format'
import { SPORTS } from '../types/rax'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300
const MAX_DATE_RANGE_DAYS = 62

const SPORT_OPTIONS = SPORTS.map((sport) => ({ value: sport, label: sport }))

const MONTH_OPTIONS = CALENDAR_MONTH_NAMES.map((label, index) => ({
  value: String(index + 1).padStart(2, '0'),
  label,
}))

function inclusiveDaySpan(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return -1
  return Math.floor((end - start) / 86_400_000) + 1
}

function groupRowsByMonth(
  rows: CatalogImportProfile['rows'],
): Array<{ monthKey: string; monthLabel: string; rows: CatalogImportProfile['rows'] }> {
  const groups = new Map<string, CatalogImportProfile['rows']>()
  for (const row of rows) {
    const key = row.claimDay.slice(0, 7)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, monthRows]) => {
      const monthIdx = Number(monthKey.slice(5, 7)) - 1
      const year = monthKey.slice(0, 4)
      const monthName = CALENDAR_MONTH_NAMES[monthIdx] ?? monthKey
      return {
        monthKey,
        monthLabel: `${monthName} ${year}`,
        rows: [...monthRows].sort((a, b) => a.claimDay.localeCompare(b.claimDay)),
      }
    })
}

export default function OtdPage() {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedSports, setSelectedSports] = useState<string[]>([])
  const [selectedSeasonYears, setSelectedSeasonYears] = useState<string[]>([])
  const [seasonOptions, setSeasonOptions] = useState<Array<{ value: string; label: string }>>([])
  const [passKind, setPassKind] = useState<CatalogPassKind | 'all'>('all')
  const [filterMonth, setFilterMonth] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rangeOpen, setRangeOpen] = useState(false)
  const [page, setPage] = useState(1)

  const [results, setResults] = useState<CatalogSearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [storageConfigured, setStorageConfigured] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [openCalendarKey, setOpenCalendarKey] = useState<string | null>(null)
  const [profileCache, setProfileCache] = useState<Record<string, CatalogImportProfile>>({})
  const [calendarLoadingKey, setCalendarLoadingKey] = useState<string | null>(null)
  const [calendarError, setCalendarError] = useState('')

  const activeDateRange = useMemo(() => {
    if (!startDate || !endDate) return null
    const start = startDate <= endDate ? startDate : endDate
    const end = startDate <= endDate ? endDate : startDate
    const span = inclusiveDaySpan(start, end)
    if (span < 1) return null
    return { start, end, span }
  }, [endDate, startDate])

  const dateRangeError =
    activeDateRange && activeDateRange.span > MAX_DATE_RANGE_DAYS
      ? `Pick a range of at most ${MAX_DATE_RANGE_DAYS} days.`
      : ''

  const pageTotal = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)
  const rankingByRange = Boolean(activeDateRange && !dateRangeError)

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim())
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [debouncedQuery, selectedSports, selectedSeasonYears, passKind, filterMonth, startDate, endDate])

  useEffect(() => {
    const controller = new AbortController()
    const sportsToLoad = selectedSports.length > 0 ? selectedSports : [...SPORTS]

    void (async () => {
      try {
        const batches = await Promise.all(
          sportsToLoad.map((sport) =>
            fetchCatalogSeasonYears(
              {
                sport,
                passKind: passKind === 'all' ? undefined : passKind,
              },
              controller.signal,
            ),
          ),
        )
        if (controller.signal.aborted) return

        const byYear = new Map<number, string>()
        for (const batch of batches) {
          for (const option of batch.seasonYears) {
            const label = option.seasonLabel.trim() || String(option.seasonYear)
            if (!byYear.has(option.seasonYear)) {
              byYear.set(option.seasonYear, label)
            }
          }
        }

        const nextOptions = [...byYear.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([year, label]) => ({ value: String(year), label }))
        setSeasonOptions(nextOptions)
        setSelectedSeasonYears((current) =>
          current.filter((value) => nextOptions.some((option) => option.value === value)),
        )
      } catch (loadError) {
        if (controller.signal.aborted) return
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        setSeasonOptions([])
      }
    })()

    return () => controller.abort()
  }, [passKind, selectedSports])

  useEffect(() => {
    if (dateRangeError) {
      setResults([])
      setTotal(0)
      setError(dateRangeError)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError('')

    void (async () => {
      try {
        const seasonYears = selectedSeasonYears
          .map((value) => Number(value))
          .filter((year) => Number.isFinite(year))
        const result = await browseOtdPasses(
          {
            query: debouncedQuery,
            sports: selectedSports,
            seasonYears,
            passKind,
            otdMonth: rankingByRange ? undefined : filterMonth || undefined,
            startDate: rankingByRange ? activeDateRange!.start : undefined,
            endDate: rankingByRange ? activeDateRange!.end : undefined,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        setResults(result.results)
        setTotal(result.total)
        setStorageConfigured(result.storageConfigured)
      } catch (loadError) {
        if (controller.signal.aborted) return
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        setResults([])
        setTotal(0)
        setError(loadError instanceof Error ? loadError.message : 'Failed to load catalog.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [
    activeDateRange,
    dateRangeError,
    debouncedQuery,
    filterMonth,
    page,
    passKind,
    rankingByRange,
    selectedSeasonYears,
    selectedSports,
  ])

  useEffect(() => {
    if (page > pageTotal) setPage(pageTotal)
  }, [page, pageTotal])

  useEffect(() => {
    if (!openCalendarKey) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenCalendarKey(null)
        setCalendarError('')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openCalendarKey])

  const clearFilters = () => {
    setSearchInput('')
    setDebouncedQuery('')
    setSelectedSports([])
    setSelectedSeasonYears([])
    setPassKind('all')
    setFilterMonth('')
    setStartDate('')
    setEndDate('')
    setRangeOpen(false)
    setPage(1)
  }

  const clearDateRange = () => {
    setStartDate('')
    setEndDate('')
  }

  const openCalendar = async (pass: CatalogSearchResult) => {
    const key = pass.externalKey
    if (openCalendarKey === key) {
      setOpenCalendarKey(null)
      setCalendarError('')
      return
    }

    setOpenCalendarKey(key)
    setCalendarError('')

    if (profileCache[key]) return

    setCalendarLoadingKey(key)
    try {
      const { profile, storageConfigured: configured } = await fetchCatalogImportProfile(key)
      if (!configured) {
        setCalendarError('Catalog storage is not configured.')
        return
      }
      if (!profile) {
        setCalendarError('Pass profile was not found.')
        return
      }
      setProfileCache((current) => ({ ...current, [key]: profile }))
    } catch (loadError) {
      setCalendarError(
        loadError instanceof Error ? loadError.message : 'Failed to load claimable dates.',
      )
    } finally {
      setCalendarLoadingKey(null)
    }
  }

  const openProfile = openCalendarKey ? profileCache[openCalendarKey] : undefined
  const openGroupedDays = openProfile ? groupRowsByMonth(openProfile.rows) : []

  return (
    <div className="page-stack">
      <CollapsiblePanel
        title="OTD catalog"
        description="Browse the full pass catalog. Open a calendar to see every claimable date for that pass."
        badge={storageConfigured ? `${total.toLocaleString()} passes` : 'Unavailable'}
      >
        <div className="sort-controls">
          <label className="field inline-field rank-search-field">
            <span>Search names</span>
            <input
              type="search"
              value={searchInput}
              placeholder="Player or team name…"
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>

          <ChecklistMultiSelect
            label="Sports"
            menuTitle="Sports"
            allOptionLabel="All sports"
            emptyTriggerLabel="No sports"
            countUnit="sports"
            options={SPORT_OPTIONS}
            selectedValues={selectedSports}
            onSelectedValuesChange={setSelectedSports}
          />

          <ChecklistMultiSelect
            label="Seasons"
            menuTitle="Season years"
            allOptionLabel="All seasons"
            emptyTriggerLabel="No seasons"
            countUnit="seasons"
            options={seasonOptions}
            selectedValues={selectedSeasonYears}
            onSelectedValuesChange={setSelectedSeasonYears}
            disabled={seasonOptions.length === 0}
          />

          <label className="field inline-field">
            <span>Pass kind</span>
            <select
              value={passKind}
              onChange={(event) => setPassKind(event.target.value as CatalogPassKind | 'all')}
            >
              <option value="all">All</option>
              <option value="player">Player</option>
              <option value="team">Team</option>
            </select>
          </label>

          <label className="field inline-field">
            <span>OTD month</span>
            <select
              value={filterMonth}
              disabled={rankingByRange}
              onChange={(event) => setFilterMonth(event.target.value)}
            >
              <option value="">Any month</option>
              {MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`button${rangeOpen || rankingByRange ? ' primary' : ''}`}
            aria-expanded={rangeOpen}
            onClick={() => setRangeOpen((current) => !current)}
          >
            {rankingByRange ? 'Date range · on' : 'Date range'}
          </button>

          <button type="button" className="button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>

        {rangeOpen || rankingByRange ? (
          <div className="otd-date-range-controls">
            <label className="field inline-field">
              <span>From</span>
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(event) => {
                  setStartDate(event.target.value)
                  setRangeOpen(true)
                }}
              />
            </label>
            <label className="field inline-field">
              <span>To</span>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => {
                  setEndDate(event.target.value)
                  setRangeOpen(true)
                }}
              />
            </label>
            {(startDate || endDate) && (
              <button type="button" className="link-button" onClick={clearDateRange}>
                Clear dates
              </button>
            )}
          </div>
        ) : null}

        {rankingByRange && activeDateRange ? (
          <p className="import-hint">
            Ranking passes by base RAX earned {formatClaimDay(activeDateRange.start)}–
            {formatClaimDay(activeDateRange.end)} ({activeDateRange.span} day
            {activeDateRange.span === 1 ? '' : 's'}).
          </p>
        ) : filterMonth ? (
          <p className="import-hint">
            Showing passes claimable in {MONTH_OPTIONS.find((m) => m.value === filterMonth)?.label}.
          </p>
        ) : null}

        {!storageConfigured ? (
          <p className="empty">Catalog storage is not configured.</p>
        ) : error ? (
          <p className="empty">{error}</p>
        ) : loading && results.length === 0 ? (
          <p className="empty">Loading catalog…</p>
        ) : results.length === 0 ? (
          <p className="empty">No passes match the current filters.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Sport</th>
                    <th>Season</th>
                    <th>{rankingByRange ? 'Range RAX' : 'Base RAX'}</th>
                    <th>Calendar</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((pass) => {
                    const isOpen = openCalendarKey === pass.externalKey
                    const isLoadingCalendar = calendarLoadingKey === pass.externalKey
                    const displayRax =
                      rankingByRange && pass.rangeBaseRax !== undefined
                        ? pass.rangeBaseRax
                        : pass.totalBaseRax
                    return (
                      <tr key={pass.externalKey} className={isOpen ? 'is-expanded' : undefined}>
                        <td>
                          <PassIdentity
                            name={pass.name}
                            passKind={pass.passKind === 'team' ? 'team' : 'player'}
                            sport={pass.sport}
                            avatar={pass.avatar}
                            size="md"
                            meta={
                              <>
                                {pass.passKind === 'team' ? 'Team pass' : 'Player pass'}
                                {pass.rarityLabel ? ` · ${pass.rarityLabel}` : ''}
                              </>
                            }
                          />
                        </td>
                        <td>{pass.sport}</td>
                        <td>{pass.seasonLabel || String(pass.seasonYear)}</td>
                        <td>
                          <strong>{formatRax(displayRax)} RAX</strong>
                          {rankingByRange ? (
                            <small className="table-sub">
                              Season total {formatRax(pass.totalBaseRax)}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button"
                            aria-haspopup="dialog"
                            aria-expanded={isOpen}
                            onClick={() => void openCalendar(pass)}
                          >
                            {isLoadingCalendar ? 'Loading…' : 'Calendar'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="table-pagination">
              <button
                type="button"
                className="link-button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <span>
                Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of{' '}
                {total.toLocaleString()}
                {loading ? ' · Updating…' : ''}
              </span>
              <button
                type="button"
                className="link-button"
                disabled={page >= pageTotal || loading}
                onClick={() => setPage((current) => Math.min(pageTotal, current + 1))}
              >
                Next
              </button>
            </div>
          </>
        )}

        {openCalendarKey ? (
          <div
            className="calendar-modal-backdrop"
            role="presentation"
            onClick={() => {
              setOpenCalendarKey(null)
              setCalendarError('')
            }}
          >
            <div
              className="calendar-modal panel otd-claim-calendar"
              role="dialog"
              aria-modal="true"
              aria-labelledby="otd-claim-calendar-title"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="calendar-modal-close button"
                type="button"
                aria-label="Close claimable dates"
                onClick={() => {
                  setOpenCalendarKey(null)
                  setCalendarError('')
                }}
              >
                Close
              </button>
              <div className="otd-claim-calendar-header">
                <h3 id="otd-claim-calendar-title">
                  Claimable dates
                  {openProfile ? ` · ${openProfile.name}` : ''}
                </h3>
              </div>
              {calendarLoadingKey === openCalendarKey ? (
                <p className="empty">Loading claimable dates…</p>
              ) : calendarError ? (
                <p className="empty">{calendarError}</p>
              ) : !openProfile || openGroupedDays.length === 0 ? (
                <p className="empty">No claimable dates stored for this pass.</p>
              ) : (
                <div className="otd-claim-month-list">
                  {openGroupedDays.map((group) => (
                    <div className="otd-claim-month" key={group.monthKey}>
                      <h4>{group.monthLabel}</h4>
                      <ul>
                        {group.rows.map((row) => (
                          <li key={row.claimDay}>
                            <span>{formatClaimDay(row.claimDay)}</span>
                            <strong>{formatRax(row.baseRaxEarned)} RAX</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </CollapsiblePanel>
    </div>
  )
}
