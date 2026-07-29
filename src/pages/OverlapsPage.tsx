import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PassIdentity } from '../components/PassIdentity'
import { computeClaimDayResults, computeYearRollup } from '../lib/claimOptimizer'
import { displayRaxValue } from '../lib/displayRax'
import { formatClaimDay, formatRax } from '../lib/format'
import {
  filterAllOverlapCards,
  filterOverlapCardsBySport,
  getSportsWithOverlaps,
  listAllOverlapDays,
  listSportOverlapDays,
  sortSportOverlapDays,
  sportOverlapTotals,
} from '../lib/overlapAnalysis'
import { useRaxData } from '../context/RaxDataContext'
import { type Sport } from '../types/rax'

type OverlapSportFilter = Sport | 'All'

const OVERLAP_DAYS_PAGE_SIZE = 50

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize))
}

export default function OverlapsPage() {
  const { data } = useRaxData()
  const [selectedSport, setSelectedSport] = useState<OverlapSportFilter | null>('All')
  const [overlapDaysPage, setOverlapDaysPage] = useState(1)

  const baseResults = useMemo(() => computeClaimDayResults(data), [data])
  const baseRollup = useMemo(() => computeYearRollup(data, baseResults), [data, baseResults])

  const sportsWithOverlaps = useMemo(() => getSportsWithOverlaps(baseResults), [baseResults])
  useEffect(() => {
    if (sportsWithOverlaps.length === 0) {
      setSelectedSport(null)
      return
    }
    if (selectedSport === 'All') return
    if (selectedSport && sportsWithOverlaps.includes(selectedSport)) return
    setSelectedSport('All')
  }, [selectedSport, sportsWithOverlaps])

  const sportOverlapDays = useMemo(() => {
    if (!selectedSport) return []
    if (selectedSport === 'All') return listAllOverlapDays(baseResults)
    return sortSportOverlapDays(listSportOverlapDays(baseResults, selectedSport))
  }, [baseResults, selectedSport])

  const sportOverlapCards = useMemo(() => {
    if (!selectedSport) return []
    if (selectedSport === 'All') return filterAllOverlapCards(baseRollup.cards)
    return filterOverlapCardsBySport(baseRollup.cards, selectedSport)
  }, [baseRollup.cards, selectedSport])

  const sportTotals = useMemo(() => {
    if (!selectedSport) return { dayCount: 0, totalOverlapRax: 0 }
    return sportOverlapTotals(sportOverlapDays)
  }, [selectedSport, sportOverlapDays])

  const overlapDaysPageTotal = pageCount(sportOverlapDays.length, OVERLAP_DAYS_PAGE_SIZE)
  const paginatedOverlapDays = useMemo(
    () => paginate(sportOverlapDays, overlapDaysPage, OVERLAP_DAYS_PAGE_SIZE),
    [sportOverlapDays, overlapDaysPage],
  )

  useEffect(() => {
    setOverlapDaysPage(1)
  }, [selectedSport])

  useEffect(() => {
    if (overlapDaysPage > overlapDaysPageTotal) {
      setOverlapDaysPage(overlapDaysPageTotal)
    }
  }, [overlapDaysPage, overlapDaysPageTotal])

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Overlaps</h2>
            <p>
              Overlaps happen when more than two player cards in the same sport earn RAX on the
              same day — only the top two count.{' '}
              <Link to="/help">Learn how claims work</Link> ·{' '}
              <Link to="/potential">Test a card you do not own</Link>
            </p>
          </div>
          <Link to="/calendar">Calendar</Link>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>By sport</h2>
            <p>
              Pick a sport, then review overlap days. Days are sorted by highest overlap RAX
              first, then date.
            </p>
          </div>
          {selectedSport ? (
            <span>
              {sportTotals.dayCount} overlap day{sportTotals.dayCount === 1 ? '' : 's'} ·{' '}
              {formatRax(displayRaxValue(sportTotals.totalOverlapRax))} wasted
            </span>
          ) : null}
        </div>

        {sportsWithOverlaps.length === 0 ? (
          <p className="empty">No overlapped days yet.</p>
        ) : (
          <div className="sport-tabs" role="tablist" aria-label="Sports with overlaps">
            <button
              type="button"
              role="tab"
              aria-selected={selectedSport === 'All'}
              className={`sport-tab${selectedSport === 'All' ? ' active' : ''}`}
              onClick={() => setSelectedSport('All')}
            >
              All
            </button>
            {sportsWithOverlaps.map((sport) => (
              <button
                key={sport}
                type="button"
                role="tab"
                aria-selected={selectedSport === sport}
                className={`sport-tab${selectedSport === sport ? ' active' : ''}`}
                onClick={() => setSelectedSport(sport)}
              >
                {sport}
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedSport ? (
        <section className="content-grid">
          <div className="panel">
            <div className="section-heading">
              <h2>{selectedSport === 'All' ? 'All overlap days' : `${selectedSport} overlap days`}</h2>
              <span className="badge">
                {sportOverlapDays.length} total
                {sportOverlapDays.length > OVERLAP_DAYS_PAGE_SIZE
                  ? ` · page ${overlapDaysPage} of ${overlapDaysPageTotal}`
                  : ''}
              </span>
            </div>
            {sportOverlapDays.length === 0 ? (
              <p className="empty">
                No {selectedSport === 'All' ? '' : `${selectedSport} `}overlap days yet.
              </p>
            ) : (
              <div className="list">
                {paginatedOverlapDays.map(({ claimDay, overlaps, sportOverlapRax, sport }) => (
                  <Link className="list-row" to={`/calendar?monthDay=${claimDay}`} key={`${sport}-${claimDay}`}>
                    <span>
                      <strong>{formatClaimDay(claimDay)}</strong>
                      <small>
                        {selectedSport === 'All' ? `${sport} · ` : ''}
                        {overlaps.length} overlapped card{overlaps.length === 1 ? '' : 's'} ·{' '}
                        {overlaps.map((candidate) => candidate.card.name).join(', ')}
                      </small>
                    </span>
                    <b>{formatRax(displayRaxValue(sportOverlapRax))} overlap</b>
                  </Link>
                ))}
              </div>
            )}
            {sportOverlapDays.length > OVERLAP_DAYS_PAGE_SIZE ? (
              <div className="table-pagination">
                <button
                  className="button"
                  type="button"
                  disabled={overlapDaysPage <= 1}
                  onClick={() => setOverlapDaysPage((page) => page - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {overlapDaysPage} of {overlapDaysPageTotal}
                </span>
                <button
                  className="button"
                  type="button"
                  disabled={overlapDaysPage >= overlapDaysPageTotal}
                  onClick={() => setOverlapDaysPage((page) => page + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="section-heading">
              <h2>{selectedSport === 'All' ? 'All overlap cards' : `${selectedSport} overlap cards`}</h2>
              <span className="badge">{sportOverlapCards.length} cards</span>
            </div>
            {sportOverlapCards.length === 0 ? (
              <p className="empty">
                No {selectedSport === 'All' ? '' : `${selectedSport} `}cards have overlap yet.
              </p>
            ) : (
              <div className="list">
                {sportOverlapCards.map((card) => (
                  <div className="list-row" key={card.card.id}>
                    <PassIdentity
                      name={card.card.name}
                      passKind={card.card.passKind === 'team' ? 'team' : 'player'}
                      sport={card.card.sport}
                      avatar={card.card.avatar}
                      meta={
                        <>
                          {selectedSport === 'All' ? `${card.card.sport} · ` : ''}
                          {card.card.season || 'No season'} · {card.overlapCount} overlap day
                          {card.overlapCount === 1 ? '' : 's'}
                        </>
                      }
                    />
                    <b>{formatRax(displayRaxValue(card.overlapRax))} RAX</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  )
}
