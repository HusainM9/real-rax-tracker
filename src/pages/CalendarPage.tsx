import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  buildCalendarCells,
  chunkCalendarWeeks,
  findClaimDayResult,
  groupClaimDaysByMonth,
  monthGroupTotals,
  weekCellsTotal,
  weekHasMonthDays,
} from '../lib/calendarView'
import { monthDayKeyFromClaimDay, monthIndexFromMonthDay } from '../lib/claimDayKey'
import { computeClaimDayResults } from '../lib/claimOptimizer'
import { displayRaxValue } from '../lib/displayRax'
import { currentYear, formatClaimDay, formatRax, todayIsoLocal } from '../lib/format'
import { useRaxData } from '../context/RaxDataContext'
import type { ClaimCandidate, ClaimDayResult } from '../types/rax'

function CandidateRow({ candidate }: { candidate: ClaimCandidate }) {
  return (
    <div className={`claim-row ${candidate.status}`}>
      <span>
        <strong>{candidate.card.name}</strong>
        <small>
          {candidate.card.sport} · {candidate.card.season || 'No season'} · rank #{candidate.rankInSport}
          {' · '}
          {formatClaimDay(candidate.performance.claimDay)}
        </small>
      </span>
      <b>{formatRax(candidate.performance.raxEarned)} RAX</b>
    </div>
  )
}

function OverlapSection({ overlaps }: { overlaps: ClaimCandidate[] }) {
  const [open, setOpen] = useState(false)
  const overlapRax = overlaps.reduce((sum, candidate) => sum + candidate.performance.raxEarned, 0)

  if (overlaps.length === 0) {
    return <p className="empty overlap-empty">No overlap in this sport.</p>
  }

  return (
    <div className="overlap-section">
      <button
        type="button"
        className="overlap-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="overlap-toggle-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>
          Overlaps ({overlaps.length}) · {formatRax(overlapRax)} RAX
        </span>
      </button>
      {open ? (
        <div className="overlap-list">
          {overlaps.map((candidate) => (
            <CandidateRow candidate={candidate} key={candidate.performance.id} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DayPanel({ day, titleId }: { day: ClaimDayResult; titleId?: string }) {
  return (
    <article className="panel day-panel">
      <div className="section-heading">
        <div>
          <h2 id={titleId}>{formatClaimDay(day.claimDay)}</h2>
          <p>
            {formatRax(day.totalClaimableRax)} claimable · {formatRax(day.totalOverlapRax)} overlapped
            · top 2 per sport + Pro bonus
          </p>
        </div>
        {day.proBonus ? <span className="badge">Pro: {day.proBonus.card.name}</span> : null}
      </div>

      <div className="sport-grid">
        {day.sports.map((sport) => (
          <section className="sport-card" key={sport.sport}>
            <h3>{sport.sport}</h3>
            <p className="mini-heading">Top two claims</p>
            {sport.guaranteed.map((candidate) => (
              <CandidateRow candidate={candidate} key={candidate.performance.id} />
            ))}
            {sport.guaranteed.length === 0 ? <p className="empty">No claims for this sport.</p> : null}

            <OverlapSection overlaps={sport.overlaps} />
          </section>
        ))}
      </div>
    </article>
  )
}

function resolveMonthDay(searchParams: URLSearchParams): string | null {
  const monthDay = searchParams.get('monthDay')
  if (monthDay) return monthDay
  const date = searchParams.get('date')
  if (date) return monthDayKeyFromClaimDay(date)
  return null
}

export default function CalendarPage() {
  const { data } = useRaxData()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedMonthDay = resolveMonthDay(searchParams)
  const allResults = useMemo(() => {
    const results = computeClaimDayResults(data)
    return results.sort((a, b) => a.claimDay.localeCompare(b.claimDay))
  }, [data])
  const selectedDay = selectedMonthDay
    ? findClaimDayResult(allResults, selectedMonthDay)
    : null
  const monthGroups = useMemo(() => groupClaimDaysByMonth(allResults), [allResults])
  const layoutYear = currentYear()
  const todayMonthDay = useMemo(() => monthDayKeyFromClaimDay(todayIsoLocal()), [])
  const todayMonthIdx = todayMonthDay != null ? monthIndexFromMonthDay(todayMonthDay) : -1
  const todayMonthOnCalendar = useMemo(
    () => todayMonthIdx >= 0 && monthGroups.some((group) => group.monthIdx === todayMonthIdx),
    [monthGroups, todayMonthIdx],
  )
  const todayHasClaims = useMemo(
    () =>
      todayMonthDay != null &&
      allResults.some((result) => monthDayKeyFromClaimDay(result.claimDay) === todayMonthDay),
    [allResults, todayMonthDay],
  )
  const showTodayNav = todayMonthDay != null && todayMonthOnCalendar

  const closeDayPanel = () => setSearchParams({})

  useEffect(() => {
    if (!selectedDay) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDayPanel()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedDay, setSearchParams])

  const openDay = (monthDay: string) => {
    if (monthDay === selectedMonthDay) {
      closeDayPanel()
      return
    }
    setSearchParams({ monthDay })
  }

  const goToToday = () => {
    if (!todayMonthDay) return
    const monthIdx = monthIndexFromMonthDay(todayMonthDay)
    if (monthIdx >= 0 && todayMonthOnCalendar) {
      document.getElementById(`calendar-month-${monthIdx}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
    window.setTimeout(() => {
      document.getElementById(`calendar-day-${todayMonthDay}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, todayMonthOnCalendar ? 180 : 0)
    if (todayHasClaims && selectedMonthDay !== todayMonthDay) {
      setSearchParams({ monthDay: todayMonthDay })
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Claim calendar</h2>
            <p>
              Each OTD day pools every year together — only the top two per sport plus one Pro bonus
              count. Values include OTD multipliers from username import.
            </p>
          </div>
          <Link to="/entry">Add entries</Link>
        </div>
        <div className="calendar-legend" aria-label="Claim status legend">
          <span className="legend-item">
            <span className="legend-swatch guaranteed" /> Guaranteed (top 2/sport)
          </span>
          <span className="legend-item">
            <span className="legend-swatch pro-bonus" /> Pro bonus
          </span>
          <span className="legend-item">
            <span className="legend-swatch overlap" /> Overlap
          </span>
        </div>
        <div className="calendar-tools">
          <label className="field inline-field">
            <span>Jump to day</span>
            <select
              value={selectedMonthDay ?? ''}
              onChange={(event) =>
                event.target.value
                  ? setSearchParams({ monthDay: event.target.value })
                  : setSearchParams({})
              }
            >
              <option value="">All claim days</option>
              {allResults.map((result) => (
                <option key={result.claimDay} value={result.claimDay}>
                  {formatClaimDay(result.claimDay)} ·{' '}
                  {formatRax(displayRaxValue(result.totalClaimableRax))} RAX
                </option>
              ))}
            </select>
          </label>
          {selectedMonthDay ? (
            <button className="button" type="button" onClick={closeDayPanel}>
              Show all
            </button>
          ) : null}
          {showTodayNav ? (
            <button className="button primary" type="button" onClick={goToToday}>
              Go to today
            </button>
          ) : null}
        </div>
      </section>

      {selectedDay ? (
        <div
          className="calendar-modal-backdrop"
          role="presentation"
          onClick={closeDayPanel}
        >
          <div
            className="calendar-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-day-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="calendar-modal-close button"
              type="button"
              aria-label="Close day details"
              onClick={closeDayPanel}
            >
              Close
            </button>
            <DayPanel day={selectedDay} titleId="calendar-day-title" />
          </div>
        </div>
      ) : null}

      {allResults.length === 0 ? (
        <section className="panel">
          <p className="empty">
            No claim days yet. <Link to="/entry">Import or add cards</Link> to create RAX entries.
          </p>
        </section>
      ) : (
        monthGroups.map((group) => {
          const totals = monthGroupTotals(group.days)
          const cells = buildCalendarCells(group.days, group.monthIdx, layoutYear)
          const weeks = chunkCalendarWeeks(cells)

          return (
            <section className="month-section" key={group.monthIdx} id={`calendar-month-${group.monthIdx}`}>
              <div className="month-header">
                <h2>{group.month}</h2>
                <span>
                  {totals.dayCount} OTD day{totals.dayCount === 1 ? '' : 's'} ·{' '}
                  {formatRax(displayRaxValue(totals.totalClaimableRax))} claimable
                </span>
              </div>
              <div className="calendar-grid-wrap">
                <div className="calendar-grid" role="grid" aria-label={`${group.month} claims`}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
                    <div className="calendar-weekday" key={weekday}>
                      {weekday}
                    </div>
                  ))}
                  {weeks.map((week, weekIndex) =>
                    week.map((cell, dayIndex) => {
                      const weekTotal =
                        dayIndex === 6 && weekHasMonthDays(week) ? weekCellsTotal(week) : 0
                      const weekSum =
                        weekTotal > 0 ? (
                          <small className="calendar-week-sum" title="Week total">
                            Wk {formatRax(displayRaxValue(weekTotal))}
                          </small>
                        ) : null

                      if (cell.result) {
                        return (
                          <button
                            className={`calendar-day has-rax${
                              cell.monthDay === selectedMonthDay ? ' selected' : ''
                            }${cell.monthDay === todayMonthDay ? ' is-today' : ''}`}
                            key={cell.key}
                            id={cell.monthDay ? `calendar-day-${cell.monthDay}` : undefined}
                            type="button"
                            onClick={() => openDay(cell.monthDay!)}
                          >
                            <span>{cell.dayNumber}</span>
                            <strong>
                              {formatRax(displayRaxValue(cell.result.totalClaimableRax))}
                            </strong>
                            {cell.result.totalOverlapRax > 0 ? (
                              <small>
                                overlap {formatRax(displayRaxValue(cell.result.totalOverlapRax))}
                              </small>
                            ) : null}
                            {weekSum}
                          </button>
                        )
                      }

                      if (cell.monthDay) {
                        return (
                          <div
                            className={`calendar-day${cell.monthDay === todayMonthDay ? ' is-today' : ''}`}
                            key={cell.key}
                            id={`calendar-day-${cell.monthDay}`}
                          >
                            <span>{cell.dayNumber}</span>
                            {weekSum}
                          </div>
                        )
                      }

                      return (
                        <div className="calendar-day" key={cell.key}>
                          {cell.dayNumber ? <span>{cell.dayNumber}</span> : null}
                          {weekSum}
                        </div>
                      )
                    }),
                  )}
                </div>
              </div>
            </section>
          )
        })
      )}

      {showTodayNav ? (
        <button
          type="button"
          className="calendar-today-fab"
          aria-label="Go to today's date on the calendar"
          onClick={goToToday}
        >
          <span className="calendar-today-fab-arrow" aria-hidden="true">
            ↓
          </span>
          <span>Today</span>
        </button>
      ) : null}
    </div>
  )
}
