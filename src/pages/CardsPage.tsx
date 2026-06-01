import { useMemo, useState } from 'react'

import { Link } from 'react-router-dom'

import { computeClaimDayResults, computeYearRollup } from '../lib/claimOptimizer'

import {

  CARD_SORT_OPTIONS,

  filterCardsBySport,

  sortCards,

  type CardSortKey,

  type SortDirection,

} from '../lib/cardSort'

import { displayRaxValue } from '../lib/displayRax'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'

import { formatRax } from '../lib/format'

import { useRaxData } from '../context/RaxDataContext'

import { SPORTS, type Sport } from '../types/rax'



export default function CardsPage() {

  const { data, updateCard } = useRaxData()

  const [sortKey, setSortKey] = useState<CardSortKey>('claimable')

  const [secondarySortKey, setSecondarySortKey] = useState<CardSortKey | 'none'>('none')

  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const [sportFilter, setSportFilter] = useState<Sport | 'All'>('All')

  const claimResults = useMemo(() => computeClaimDayResults(data), [data])

  const rollup = useMemo(() => computeYearRollup(data, claimResults), [data, claimResults])

  const filteredCards = useMemo(

    () => filterCardsBySport(rollup.cards, sportFilter),

    [rollup.cards, sportFilter],

  )

  const sortedCards = useMemo(

    () =>

      sortCards(

        filteredCards,

        sortKey,

        sortDirection,

        secondarySortKey === 'none' ? null : secondarySortKey,

      ),

    [filteredCards, secondarySortKey, sortDirection, sortKey],

  )



  return (

    <div className="page-stack">

      <section className="panel">

        <div className="section-heading">

          <div>

            <h2>Player card totals</h2>

            <p>

              Claimable RAX includes guaranteed top-two claims and any Pro bonus selections. Filter

              by sport, then sort by base RAX and a tie-breaker (e.g. FC only, highest base first).
              Use &quot;Preview as&quot; to simulate a rarity upgrade — totals update live across
              the app.

            </p>

          </div>

          <Link to="/entry">Manage cards</Link>

        </div>

        <div className="sort-controls">

          <label className="field inline-field">

            <span>Sport</span>

            <select

              value={sportFilter}

              onChange={(event) => setSportFilter(event.target.value as Sport | 'All')}

            >

              <option value="All">All sports</option>

              {SPORTS.map((sport) => (

                <option key={sport} value={sport}>

                  {sport}

                </option>

              ))}

            </select>

          </label>

          <label className="field inline-field">

            <span>Sort by</span>

            <select

              value={sortKey}

              onChange={(event) => setSortKey(event.target.value as CardSortKey)}

            >

              {CARD_SORT_OPTIONS.map((option) => (

                <option key={option.value} value={option.value}>

                  {option.label}

                </option>

              ))}

            </select>

          </label>

          <label className="field inline-field">

            <span>Then by</span>

            <select

              value={secondarySortKey}

              onChange={(event) =>

                setSecondarySortKey(event.target.value as CardSortKey | 'none')

              }

            >

              <option value="none">None</option>

              {CARD_SORT_OPTIONS.map((option) => (

                <option key={option.value} value={option.value}>

                  {option.label}

                </option>

              ))}

            </select>

          </label>

          <label className="field inline-field">

            <span>Direction</span>

            <select

              value={sortDirection}

              onChange={(event) => setSortDirection(event.target.value as SortDirection)}

            >

              <option value="desc">High to low / Z-A</option>

              <option value="asc">Low to high / A-Z</option>

            </select>

          </label>

        </div>

        <div className="table-wrap">

          <table>

            <thead>

              <tr>

                <th>Player card</th>

                <th>Sport</th>

                <th>Season</th>

                <th>Rarity</th>

                <th>Preview as</th>

                <th>Entries</th>

                <th>Total base</th>

                <th>Guaranteed</th>

                <th>Pro bonus</th>

                <th>Overlap</th>

                <th>Total claimable</th>

              </tr>

            </thead>

            <tbody>

              {rollup.cards.length === 0 ? (

                <tr>

                  <td colSpan={11} className="empty-cell">

                    Add player cards to see card-level totals.

                  </td>

                </tr>

              ) : filteredCards.length === 0 ? (

                <tr>

                  <td colSpan={11} className="empty-cell">

                    No {sportFilter} cards yet.

                  </td>

                </tr>

              ) : (

                sortedCards.map((cardRollup) => (

                  <tr key={cardRollup.card.id}>

                    <td>

                      <input

                        value={cardRollup.card.name}

                        aria-label={`Player name for ${cardRollup.card.name || 'card'}`}

                        onChange={(event) =>

                          updateCard(cardRollup.card.id, { name: event.target.value })

                        }

                      />

                    </td>

                    <td>

                      <select

                        value={cardRollup.card.sport}

                        aria-label={`Sport for ${cardRollup.card.name || 'card'}`}

                        onChange={(event) =>

                          updateCard(cardRollup.card.id, {

                            sport: event.target.value as Sport,

                          })

                        }

                      >

                        {SPORTS.map((sport) => (

                          <option key={sport} value={sport}>

                            {sport}

                          </option>

                        ))}

                      </select>

                    </td>

                    <td>

                      <input

                        value={cardRollup.card.season}

                        aria-label={`Season for ${cardRollup.card.name || 'card'}`}

                        onChange={(event) =>

                          updateCard(cardRollup.card.id, { season: event.target.value })

                        }

                      />

                    </td>

                    <td>{cardRollup.card.rarityLabel || '—'}</td>

                    <td>
                      <select
                        value={cardRollup.card.simulatedRarityLabel ?? ''}
                        aria-label={`Preview rarity for ${cardRollup.card.name || 'card'}`}
                        onChange={(event) =>
                          updateCard(cardRollup.card.id, {
                            simulatedRarityLabel: event.target.value || undefined,
                          })
                        }
                      >
                        {RARITY_PREVIEW_OPTIONS.map((option) => (
                          <option key={option || 'actual'} value={option}>
                            {option || 'Actual rarity'}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>{cardRollup.performanceCount}</td>

                    <td>

                      <strong>

                        {formatRax(displayRaxValue(cardRollup.totalBaseRax))} RAX

                      </strong>

                    </td>

                    <td>

                      {formatRax(displayRaxValue(cardRollup.guaranteedRax))}

                      <small className="table-sub">{cardRollup.guaranteedClaims} claims</small>

                    </td>

                    <td>

                      {formatRax(displayRaxValue(cardRollup.proBonusRax))}

                      <small className="table-sub">{cardRollup.proBonusClaims} claims</small>

                    </td>

                    <td>

                      {formatRax(displayRaxValue(cardRollup.overlapRax))}

                      <small className="table-sub">{cardRollup.overlapCount} overlaps</small>

                    </td>

                    <td>

                      <strong>

                        {formatRax(displayRaxValue(cardRollup.totalClaimableRax))} RAX

                      </strong>

                    </td>

                  </tr>

                ))

              )}

            </tbody>

          </table>

        </div>

      </section>



      <section className="panel">

        <div className="section-heading">

          <h2>Sport totals</h2>

          <span>{rollup.cards.length} cards</span>

        </div>

        <div className="table-wrap">

          <table>

            <thead>

              <tr>

                <th>Sport</th>

                <th>Guaranteed</th>

                <th>Pro bonus</th>

                <th>Overlap</th>

                <th>Total claimable</th>

              </tr>

            </thead>

            <tbody>

              {rollup.sports.length === 0 ? (

                <tr>

                  <td colSpan={5} className="empty-cell">

                    Sport totals appear after RAX entries are added.

                  </td>

                </tr>

              ) : (

                rollup.sports.map((sport) => (

                  <tr key={sport.sport}>

                    <td>

                      <strong>{sport.sport}</strong>

                    </td>

                    <td>

                      {formatRax(displayRaxValue(sport.guaranteedRax))}

                      <small className="table-sub">{sport.guaranteedClaims} claims</small>

                    </td>

                    <td>

                      {formatRax(displayRaxValue(sport.proBonusRax))}

                      <small className="table-sub">{sport.proBonusClaims} claims</small>

                    </td>

                    <td>

                      {formatRax(displayRaxValue(sport.overlapRax))}

                      <small className="table-sub">{sport.overlapCount} overlaps</small>

                    </td>

                    <td>

                      <strong>{formatRax(displayRaxValue(sport.totalClaimableRax))} RAX</strong>

                    </td>

                  </tr>

                ))

              )}

            </tbody>

          </table>

        </div>

      </section>

    </div>

  )

}


