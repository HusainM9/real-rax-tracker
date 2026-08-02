import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { ThemedSelect } from '../components/ThemedSelect'
import { PassIdentity } from '../components/PassIdentity'
import { computeClaimDayResults, computeYearRollup } from '../lib/claimOptimizer'
import { sortCards, type RarityFilterValue, type SortDirection } from '../lib/cardSort'
import { displayRaxValue } from '../lib/displayRax'
import { formatRax } from '../lib/format'
import { formatRemoveCardConfirmMessage } from '../lib/cardProfile'
import { isPlayerPassForSell } from '../lib/passKind'
import { RARITY_TIERS } from '../lib/rarityFilter'
import {
  analyzeRemovedCard,
  computeSaleComparison,
  formatRemoveCardSummary,
  formatSignedRax,
  isNotNeededForClaims,
  rankAllRemovedCardsAsync,
  type SellRankProgress,
} from '../lib/removeCardAnalysis'
import {
  filterSellRankRows,
  SELL_RANK_SORT_OPTIONS,
  sortSellRankRows,
  type SellRankSortKey,
} from '../lib/sellRankings'
import {
  isCardSellExcluded,
  listSellExcludedCards,
} from '../lib/sellExcludedPasses'
import { useRaxData } from '../context/RaxDataContext'
import { SPORTS, type Sport } from '../types/rax'

const CARD_SEARCH_LIMIT = 50
const SELL_RANK_PAGE_SIZE = 50

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize))
}

function matchesCardSearch(
  query: string,
  row: {
    card: {
      name: string
      sport: string
      season: string
      rarityLabel?: string
    }
  },
): boolean {
  const haystack = [
    row.card.name,
    row.card.sport,
    row.card.season,
    row.card.rarityLabel ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

export default function SellPage() {
  const { data, saveSellRankings, clearSellRankings, removeCardFromCollection, toggleSellExcludedCard } =
    useRaxData()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCardId = searchParams.get('card') ?? ''
  const [salePrice, setSalePrice] = useState('')
  const [cardQuery, setCardQuery] = useState('')
  const [rankSportFilter, setRankSportFilter] = useState<Sport | 'All'>('All')
  const [rankRarityFilter, setRankRarityFilter] = useState<RarityFilterValue>('All')
  const [rankSortKey, setRankSortKey] = useState<SellRankSortKey>('netClaimable')
  const [rankSortDirection, setRankSortDirection] = useState<SortDirection>('desc')
  const [rankQuery, setRankQuery] = useState('')
  const [rankingInProgress, setRankingInProgress] = useState(false)
  const [rankProgress, setRankProgress] = useState<SellRankProgress | null>(null)
  const [rankStatus, setRankStatus] = useState('')
  const [removeStatus, setRemoveStatus] = useState('')
  const [rankResultsPage, setRankResultsPage] = useState(1)
  const [skippedPassesPage, setSkippedPassesPage] = useState(1)
  const rankAbortRef = useRef<AbortController | null>(null)

  const savedRankings = data.savedSellRankings
  const excludedCards = useMemo(() => listSellExcludedCards(data), [data])

  const rollup = useMemo(() => {
    const results = computeClaimDayResults(data)
    return computeYearRollup(data, results)
  }, [data])

  const playerCards = useMemo(
    () =>
      rollup.cards.filter(
        (row) => isPlayerPassForSell(row.card) && !isCardSellExcluded(data, row.card.id),
      ),
    [data, rollup.cards],
  )

  const sortedCards = useMemo(
    () => sortCards(playerCards, 'name', 'asc', null),
    [playerCards],
  )

  const selectedCard = useMemo(
    () => data.cards.find((card) => card.id === selectedCardId),
    [data.cards, selectedCardId],
  )

  const filteredCards = useMemo(() => {
    const query = cardQuery.trim().toLowerCase()
    const matches = query
      ? sortedCards.filter((row) => matchesCardSearch(query, row))
      : sortedCards
    const limited = matches.slice(0, CARD_SEARCH_LIMIT)
    if (
      selectedCardId &&
      !limited.some((row) => row.card.id === selectedCardId)
    ) {
      const selected = sortedCards.find((row) => row.card.id === selectedCardId)
      if (selected) {
        return [selected, ...limited.slice(0, CARD_SEARCH_LIMIT - 1)]
      }
    }
    return limited
  }, [cardQuery, selectedCardId, sortedCards])

  const selectedRollup = useMemo(
    () => sortedCards.find((row) => row.card.id === selectedCardId),
    [selectedCardId, sortedCards],
  )

  const selectedIsExcluded = isCardSellExcluded(data, selectedCardId)

  const sellAnalysis = useMemo(
    () =>
      selectedCardId &&
      selectedCard &&
      isPlayerPassForSell(selectedCard) &&
      !selectedIsExcluded
        ? analyzeRemovedCard(data, selectedCardId)
        : null,
    [data, selectedCard, selectedCardId, selectedIsExcluded],
  )

  const parsedSalePrice = Number(salePrice.replace(/,/g, ''))
  const hasSalePrice = Number.isFinite(parsedSalePrice) && parsedSalePrice > 0

  const saleComparison = useMemo(
    () =>
      sellAnalysis && hasSalePrice
        ? computeSaleComparison(sellAnalysis, parsedSalePrice)
        : null,
    [hasSalePrice, parsedSalePrice, sellAnalysis],
  )

  const selectCard = (cardId: string) => {
    if (!cardId) {
      setSearchParams({})
      return
    }
    setSearchParams({ card: cardId })
  }

  const handleRemoveFromCollection = (card: {
    id: string
    name: string
    sport: string
    season: string
  }) => {
    if (!window.confirm(formatRemoveCardConfirmMessage(card))) return
    const removed = removeCardFromCollection(card.id, {
      removedNote: `Removed ${new Date().toISOString().slice(0, 10)} (planned sale)`,
    })
    if (!removed) return
    if (selectedCardId === card.id) {
      setSearchParams({})
      setSalePrice('')
    }
    setRemoveStatus(
      `Removed ${card.name || 'pass'} from your collection. Earnings saved under Entry → Saved profiles.`,
    )
  }

  const runBulkRanking = async () => {
    rankAbortRef.current?.abort()
    const controller = new AbortController()
    rankAbortRef.current = controller
    setRankingInProgress(true)
    setRankProgress(null)
    setRankStatus('')
    setRankResultsPage(1)
    setSkippedPassesPage(1)

    try {
      const result = await rankAllRemovedCardsAsync(data, {
        signal: controller.signal,
        onProgress: setRankProgress,
      })
      saveSellRankings(result)
      const skippedCount = result.skippedPlayerPasses.length
      setRankStatus(
        `Ranked ${result.rankings.length} player pass${result.rankings.length === 1 ? '' : 'es'}${
          skippedCount > 0
            ? ` · ${skippedCount} player pass${skippedCount === 1 ? '' : 'es'} skipped`
            : ''
        }.`,
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setRankStatus('Ranking cancelled.')
      } else {
        setRankStatus(error instanceof Error ? error.message : 'Ranking failed.')
      }
    } finally {
      setRankingInProgress(false)
      setRankProgress(null)
      rankAbortRef.current = null
    }
  }

  const cancelBulkRanking = () => {
    rankAbortRef.current?.abort()
  }

  const displayedRankings = useMemo(() => {
    if (!savedRankings) return []
    const filtered = filterSellRankRows(
      savedRankings.rows.filter((row) => !isCardSellExcluded(data, row.cardId)),
      rankSportFilter,
      rankRarityFilter,
      rankQuery,
    )
    return sortSellRankRows(filtered, rankSortKey, rankSortDirection)
  }, [
    data,
    rankQuery,
    rankRarityFilter,
    rankSortDirection,
    rankSortKey,
    rankSportFilter,
    savedRankings,
  ])

  useEffect(() => {
    setRankResultsPage(1)
  }, [rankQuery, rankRarityFilter, rankSortDirection, rankSortKey, rankSportFilter])

  const paginatedRankings = useMemo(
    () => paginate(displayedRankings, rankResultsPage, SELL_RANK_PAGE_SIZE),
    [displayedRankings, rankResultsPage],
  )

  const rankResultsPageTotal = pageCount(displayedRankings.length, SELL_RANK_PAGE_SIZE)
  const rankResultsOffset = (rankResultsPage - 1) * SELL_RANK_PAGE_SIZE

  const skippedPlayerPasses = savedRankings?.skippedPlayerPasses ?? []

  const paginatedSkippedPasses = useMemo(
    () => paginate(skippedPlayerPasses, skippedPassesPage, SELL_RANK_PAGE_SIZE),
    [skippedPassesPage, skippedPlayerPasses],
  )

  const skippedPassesPageTotal = pageCount(skippedPlayerPasses.length, SELL_RANK_PAGE_SIZE)

  const bulkSkipHint = savedRankings
    ? [
        savedRankings.skippedTeamPasses > 0
          ? `${savedRankings.skippedTeamPasses} team pass${savedRankings.skippedTeamPasses === 1 ? '' : 'es'} excluded`
          : '',
        savedRankings.skippedWithoutEarnings > 0
          ? `${savedRankings.skippedWithoutEarnings} player pass${savedRankings.skippedWithoutEarnings === 1 ? '' : 'es'} skipped (no earnings)`
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  const searchHint =
    sortedCards.length === 0
      ? 'Add cards on Entry first.'
      : cardQuery.trim()
        ? `${filteredCards.length} match${filteredCards.length === 1 ? '' : 'es'}`
        : `Showing first ${Math.min(sortedCards.length, CARD_SEARCH_LIMIT)} of ${sortedCards.length} — search to narrow`

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Sell planning</p>
          <h2>If you sell this pass</h2>
          <p>
            Lost vs freed claimable RAX if you sell. Removing archives earnings under Entry → Saved
            profiles.
          </p>
        </div>
        <Link className="button" to="/cards">
          Card totals
        </Link>
      </section>

      {removeStatus ? <p className="import-status">{removeStatus}</p> : null}

      <CollapsiblePanel
        title="Rank all passes"
        description="Player passes with earnings, ranked by net claimable if sold."
        defaultOpen={false}
      >
        <p className="import-hint">
          Net 0 means selling would not reduce total claimable RAX. Team passes excluded.
        </p>
        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={sortedCards.length === 0 || rankingInProgress}
            onClick={() => void runBulkRanking()}
          >
            {rankingInProgress
              ? 'Calculating…'
              : savedRankings
                ? 'Recalculate rankings'
                : 'Calculate rankings'}
          </button>
          {rankingInProgress ? (
            <button className="button" type="button" onClick={cancelBulkRanking}>
              Cancel
            </button>
          ) : null}
          {savedRankings && !rankingInProgress ? (
            <button className="button" type="button" onClick={clearSellRankings}>
              Clear results
            </button>
          ) : null}
        </div>
        {rankProgress ? (
          <p className="import-progress">
            Analyzing pass {rankProgress.current}/{rankProgress.total} — {rankProgress.label}
          </p>
        ) : null}
        {rankStatus ? <p className="import-status">{rankStatus}</p> : null}
        {savedRankings ? (
          savedRankings.rows.length === 0 ? (
            <p className="empty">
              No player passes with earnings to rank.
              {bulkSkipHint ? ` ${bulkSkipHint}.` : ''}
            </p>
          ) : (
            <>
              <p className="import-hint">
                Saved {new Date(savedRankings.calculatedAt).toLocaleString()} ·{' '}
                {displayedRankings.length} shown of {savedRankings.rows.length} ranked pass
                {savedRankings.rows.length === 1 ? '' : 'es'}.
                {bulkSkipHint ? ` ${bulkSkipHint}.` : ''}
              </p>
              {skippedPlayerPasses.length > 0 ? (
                <section className="import-failures">
                  <p className="import-hint">
                    <strong>
                      {skippedPlayerPasses.length} player pass
                      {skippedPlayerPasses.length === 1 ? '' : 'es'} could not be ranked.
                    </strong>{' '}
                    Add earnings on <Link to="/entry">Entry</Link> or re-import the pass.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Player pass</th>
                          <th>Sport</th>
                          <th>Season</th>
                          <th>Issue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedSkippedPasses.map((pass) => (
                          <tr key={`${pass.cardId}|${pass.reason}|${pass.detail}`}>
                            <td>
                              <button
                                className="link-button"
                                type="button"
                                onClick={() => selectCard(pass.cardId)}
                              >
                                <PassIdentity
                                  name={pass.name || 'Unnamed pass'}
                                  passKind={pass.passKind === 'team' ? 'team' : 'player'}
                                  sport={pass.sport}
                                  avatar={pass.avatar}
                                  meta={pass.rarityLabel}
                                />
                              </button>
                            </td>
                            <td>{pass.sport}</td>
                            <td>{pass.season || '—'}</td>
                            <td>
                              {pass.reason === 'no_earnings' ? 'No earnings' : 'Analysis failed'}
                              <br />
                              <small className="table-sub">{pass.detail}</small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {skippedPlayerPasses.length > SELL_RANK_PAGE_SIZE ? (
                    <div className="table-pagination">
                      <button
                        className="button"
                        type="button"
                        disabled={skippedPassesPage <= 1}
                        onClick={() => setSkippedPassesPage((page) => page - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        Page {skippedPassesPage} of {skippedPassesPageTotal}
                      </span>
                      <button
                        className="button"
                        type="button"
                        disabled={skippedPassesPage >= skippedPassesPageTotal}
                        onClick={() => setSkippedPassesPage((page) => page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}
              <div className="sort-controls">
                <label className="field inline-field rank-search-field">
                  <span>Search</span>
                  <input
                    type="search"
                    value={rankQuery}
                    placeholder="Player name, sport, season…"
                    onChange={(event) => setRankQuery(event.target.value)}
                  />
                </label>
                <ThemedSelect
                  label="Sport"
                  value={rankSportFilter}
                  onChange={(value) => setRankSportFilter(value as Sport | 'All')}
                  options={[
                    { value: 'All', label: 'All sports' },
                    ...SPORTS.map((sport) => ({ value: sport, label: sport })),
                  ]}
                />
                <ThemedSelect
                  label="Rarity"
                  value={rankRarityFilter}
                  onChange={(value) => setRankRarityFilter(value as RarityFilterValue)}
                  options={[
                    { value: 'All', label: 'All rarities' },
                    { value: 'Legendary+', label: 'Legendary+' },
                    ...RARITY_TIERS.map((tier) => ({ value: tier, label: tier })),
                    { value: 'Unknown', label: 'Unknown' },
                  ]}
                />
                <ThemedSelect
                  label="Sort by"
                  value={rankSortKey}
                  onChange={(value) => setRankSortKey(value as SellRankSortKey)}
                  options={SELL_RANK_SORT_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
                <ThemedSelect
                  label="Direction"
                  value={rankSortDirection}
                  onChange={(value) => setRankSortDirection(value as SortDirection)}
                  options={[
                    { value: 'desc', label: 'High to low' },
                    { value: 'asc', label: 'Low to high' },
                  ]}
                />
              </div>
              {displayedRankings.length === 0 ? (
                <p className="empty">No ranked passes match the current filters.</p>
              ) : (
                <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Player pass</th>
                        <th>Sport</th>
                        <th>Claimable now</th>
                        <th>Lost if sold</th>
                        <th>Freed on others</th>
                        <th>Net claimable</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedRankings.map((row, index) => (
                        <tr key={row.cardId}>
                          <td>{rankResultsOffset + index + 1}</td>
                          <td>
                            <button
                              className="link-button"
                              type="button"
                              onClick={() => selectCard(row.cardId)}
                            >
                              <PassIdentity
                                name={row.name || 'Unnamed pass'}
                                passKind={row.passKind === 'team' ? 'team' : 'player'}
                                sport={row.sport}
                                avatar={row.avatar}
                                meta={
                                  <>
                                    {row.season || 'No season'}
                                    {row.rarityLabel ? ` · ${row.rarityLabel}` : ''}
                                  </>
                                }
                              />
                            </button>
                          </td>
                          <td>{row.sport}</td>
                          <td>{formatRax(displayRaxValue(row.claimableNow))}</td>
                          <td>{formatRax(displayRaxValue(row.lostClaimableRax))}</td>
                          <td>{formatRax(displayRaxValue(row.freedClaimableRax))}</td>
                          <td>
                            <strong>
                              {formatSignedRax(displayRaxValue(row.netClaimableDelta))}
                            </strong>
                            {isNotNeededForClaims(row.netClaimableDelta) ? (
                              <small className="table-sub sell-not-needed">Not needed</small>
                            ) : null}
                          </td>
                          <td>
                            <span className="button-row compact-actions">
                              <button
                                className="button compact"
                                type="button"
                                onClick={() => toggleSellExcludedCard(row.cardId)}
                              >
                                Exclude
                              </button>
                              <button
                                className="button danger compact"
                                type="button"
                                onClick={() =>
                                  handleRemoveFromCollection({
                                    id: row.cardId,
                                    name: row.name,
                                    sport: row.sport,
                                    season: row.season,
                                  })
                                }
                              >
                                Remove
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {displayedRankings.length > SELL_RANK_PAGE_SIZE ? (
                  <div className="table-pagination">
                    <button
                      className="button"
                      type="button"
                      disabled={rankResultsPage <= 1}
                      onClick={() => setRankResultsPage((page) => page - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      Page {rankResultsPage} of {rankResultsPageTotal}
                    </span>
                    <button
                      className="button"
                      type="button"
                      disabled={rankResultsPage >= rankResultsPageTotal}
                      onClick={() => setRankResultsPage((page) => page + 1)}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
                </>
              )}
            </>
          )
        ) : (
          <p className="empty">Click calculate to rank passes with earnings by net claimable if sold.</p>
        )}
      </CollapsiblePanel>

      {excludedCards.length > 0 ? (
        <CollapsiblePanel
          title="Excluded"
          description="Omitted from rankings and sale analysis."
          badge={`${excludedCards.length}`}
          defaultOpen={false}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Player pass</th>
                  <th>Sport</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {excludedCards.map((card) => (
                  <tr key={card.id}>
                    <td>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => selectCard(card.id)}
                      >
                        <PassIdentity
                          name={card.name || 'Unnamed pass'}
                          passKind={card.passKind === 'team' ? 'team' : 'player'}
                          sport={card.sport}
                          avatar={card.avatar}
                          meta={
                            <>
                              {card.season || 'No season'}
                              {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                            </>
                          }
                        />
                      </button>
                    </td>
                    <td>{card.sport}</td>
                    <td>
                      <button
                        className="button compact"
                        type="button"
                        onClick={() => toggleSellExcludedCard(card.id)}
                      >
                        Include
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsiblePanel>
      ) : null}

      <CollapsiblePanel
        title="Choose a pass"
        description={searchHint}
        defaultOpen
      >
        <div className="card-picker">
          <label className="field">
            <span>Search passes</span>
            <input
              type="search"
              value={cardQuery}
              placeholder="Player name, sport, season, rarity…"
              disabled={sortedCards.length === 0}
              onChange={(event) => setCardQuery(event.target.value)}
            />
          </label>
          {sortedCards.length === 0 ? (
            <p className="card-picker-empty">No cards in your collection yet.</p>
          ) : filteredCards.length === 0 ? (
            <p className="card-picker-empty">No passes match that search.</p>
          ) : (
            <div className="card-picker-list" role="listbox" aria-label="Player passes">
              {filteredCards.map((row) => (
                <button
                  key={row.card.id}
                  type="button"
                  role="option"
                  aria-selected={selectedCardId === row.card.id}
                  className={`card-picker-item${selectedCardId === row.card.id ? ' selected' : ''}`}
                  onClick={() => selectCard(row.card.id)}
                >
                  <PassIdentity
                    name={row.card.name || 'Unnamed pass'}
                    passKind={row.card.passKind === 'team' ? 'team' : 'player'}
                    sport={row.card.sport}
                    avatar={row.card.avatar}
                    meta={
                      <>
                        {row.card.sport} · {row.card.season || 'No season'}
                        {row.card.rarityLabel ? ` · ${row.card.rarityLabel}` : ''} ·{' '}
                        {formatRax(displayRaxValue(row.totalClaimableRax))} claimable
                      </>
                    }
                  />
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedRollup ? (
          <p className="import-hint">
            Currently claiming {formatRax(displayRaxValue(selectedRollup.totalClaimableRax))} RAX
            ({formatRax(displayRaxValue(selectedRollup.guaranteedRax))} guaranteed,{' '}
            {formatRax(displayRaxValue(selectedRollup.proBonusRax))} Pro bonus,{' '}
            {formatRax(displayRaxValue(selectedRollup.overlapRax))} overlap-only).
          </p>
        ) : null}
      </CollapsiblePanel>

      {!selectedCardId ? (
        <section className="panel">
          <p className="empty">Pick a player pass above to simulate selling it.</p>
        </section>
      ) : selectedCard && !isPlayerPassForSell(selectedCard) ? (
        <section className="panel">
          <p className="empty">
            Team passes are excluded from If sold. Pick a player pass above to analyze a sale.
          </p>
        </section>
      ) : selectedIsExcluded && selectedCard ? (
        <CollapsiblePanel
          title={selectedCard.name || 'Unnamed pass'}
          description={`${selectedCard.sport} · ${selectedCard.season || 'No season'}${selectedCard.rarityLabel ? ` · ${selectedCard.rarityLabel}` : ''}`}
          badge="Excluded"
          defaultOpen
        >
          <div className="button-row">
            <button
              className="button"
              type="button"
              onClick={() => toggleSellExcludedCard(selectedCard.id)}
            >
              Include
            </button>
            <button
              className="button danger"
              type="button"
              onClick={() => handleRemoveFromCollection(selectedCard)}
            >
              Remove from collection
            </button>
          </div>
        </CollapsiblePanel>
      ) : !sellAnalysis ? (
        <section className="panel">
          <p className="empty">Could not analyze that card.</p>
        </section>
      ) : (
        <CollapsiblePanel
          title={sellAnalysis.card.name}
          description={`${sellAnalysis.card.sport} · ${sellAnalysis.card.season || 'No season'}${sellAnalysis.card.rarityLabel ? ` · ${sellAnalysis.card.rarityLabel}` : ''}`}
          badge={
            isNotNeededForClaims(sellAnalysis.netClaimableDelta)
              ? 'Not needed'
              : `Net ${formatRax(displayRaxValue(sellAnalysis.netClaimableDelta))}`
          }
          defaultOpen
        >
          {isNotNeededForClaims(sellAnalysis.netClaimableDelta) ? (
            <p className="sell-not-needed-callout">
              Net claimable is 0 — this pass is not needed for your collection claims. Selling it
              would not reduce your total claimable RAX.
            </p>
          ) : null}
          <div className="stats-grid">
            <article className="stat-card panel">
              <span>Lost claimable</span>
              <strong>{formatRax(displayRaxValue(sellAnalysis.lostClaimableRax))}</strong>
              <small className="table-sub">from this pass</small>
            </article>
            <article className="stat-card panel">
              <span>Freed on others</span>
              <strong>{formatRax(displayRaxValue(sellAnalysis.freedClaimableRax))}</strong>
              <small className="table-sub">
                {sellAnalysis.gains.length} promoted claim{sellAnalysis.gains.length === 1 ? '' : 's'}
              </small>
            </article>
            <article className="stat-card panel">
              <span>Net claimable</span>
              <strong>{formatRax(displayRaxValue(sellAnalysis.netClaimableDelta))}</strong>
              <small className="table-sub">
                {isNotNeededForClaims(sellAnalysis.netClaimableDelta)
                  ? 'not needed for claims'
                  : 'collection-wide change'}
              </small>
            </article>
            <article className="stat-card panel">
              <span>Overlap only</span>
              <strong>{formatRax(displayRaxValue(sellAnalysis.lostOverlapRax))}</strong>
              <small className="table-sub">was not claimable anyway</small>
            </article>
          </div>
          <label className="field">
            <span>Sale price (optional)</span>
            <input
              value={salePrice}
              placeholder="35000"
              inputMode="numeric"
              onChange={(event) => setSalePrice(event.target.value)}
            />
          </label>
          {saleComparison ? (
            <div
              className={`sale-comparison${saleComparison.netVsKeeping >= 0 ? ' is-positive' : ' is-negative'}`}
            >
              <p className="sale-comparison-heading">Net vs keeping this pass</p>
              <dl className="sale-comparison-rows">
                <div className="sale-comparison-row">
                  <dt>Sale price</dt>
                  <dd className="sale-positive">
                    +{formatRax(displayRaxValue(saleComparison.salePrice))}
                  </dd>
                </div>
                <div className="sale-comparison-row">
                  <dt>Collection claimable change</dt>
                  <dd
                    className={
                      saleComparison.netClaimableDelta >= 0 ? 'sale-positive' : 'sale-negative'
                    }
                  >
                    {formatSignedRax(displayRaxValue(saleComparison.netClaimableDelta))}
                  </dd>
                </div>
              </dl>
              <div className="sale-comparison-total">
                <span>Net after sale</span>
                <strong>{formatSignedRax(displayRaxValue(saleComparison.netVsKeeping))} RAX</strong>
              </div>
              <p className="sale-comparison-verdict">
                {saleComparison.netVsKeeping > 0 ? (
                  <>
                    Selling is{' '}
                    <strong>
                      {formatRax(displayRaxValue(saleComparison.netVsKeeping))} RAX ahead
                    </strong>{' '}
                    of keeping this pass.
                  </>
                ) : saleComparison.netVsKeeping < 0 ? (
                  <>
                    Keeping is{' '}
                    <strong>
                      {formatRax(displayRaxValue(-saleComparison.netVsKeeping))} RAX ahead
                    </strong>{' '}
                    at this sale price.
                  </>
                ) : (
                  <>Same as keeping once the collection change is included.</>
                )}
                {saleComparison.breakEvenSalePrice > 0 ? (
                  <>
                    {' '}
                    Break-even sale price:{' '}
                    {formatRax(displayRaxValue(saleComparison.breakEvenSalePrice))} RAX.
                  </>
                ) : null}
              </p>
            </div>
          ) : (
            <>
              <p className="import-hint">{formatRemoveCardSummary(sellAnalysis)}</p>
              {sellAnalysis.netClaimableDelta < 0 ? (
                <p className="import-hint">
                  Break-even sale price:{' '}
                  {formatRax(displayRaxValue(-sellAnalysis.netClaimableDelta))} RAX — enough to
                  offset the collection claimable drop from selling.
                </p>
              ) : null}
              <p className="import-hint">
                Enter a sale price above to see the net RAX vs keeping this pass.
              </p>
            </>
          )}
          {sellAnalysis.gains.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>OTD day</th>
                    <th>Card promoted</th>
                    <th>Sport</th>
                    <th>RAX freed</th>
                    <th>New slot</th>
                  </tr>
                </thead>
                <tbody>
                  {sellAnalysis.gains.map((gain) => (
                    <tr
                      key={`${gain.claimDay}-${gain.candidate.card.id}-${gain.candidate.performance.raxEarned}`}
                    >
                      <td>{gain.claimDay}</td>
                      <td>
                        <PassIdentity
                          name={gain.candidate.card.name}
                          passKind={
                            gain.candidate.card.passKind === 'team' ? 'team' : 'player'
                          }
                          sport={gain.candidate.card.sport}
                          avatar={gain.candidate.card.avatar}
                        />
                      </td>
                      <td>{gain.candidate.card.sport}</td>
                      <td>{formatRax(displayRaxValue(gain.candidate.performance.raxEarned))}</td>
                      <td>{gain.newStatus === 'pro-bonus' ? 'Pro bonus' : 'Guaranteed'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">No other cards would gain claimable RAX if you sold this pass.</p>
          )}
          <div className="button-row">
            <button
              className="button"
              type="button"
              onClick={() => toggleSellExcludedCard(sellAnalysis.card.id)}
            >
              Exclude
            </button>
            <button
              className="button danger"
              type="button"
              onClick={() => handleRemoveFromCollection(sellAnalysis.card)}
            >
              Remove from collection
            </button>
          </div>
          <p className="import-hint">
            Removes this pass from Dashboard totals and saves earnings under Entry → Saved profiles
            so you can restore later.
          </p>
        </CollapsiblePanel>
      )}
    </div>
  )
}
