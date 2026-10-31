import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CollapsiblePanel from '../components/CollapsiblePanel'
import CardRaritySelect from '../components/CardRaritySelect'
import CollectionImportExclusions from '../components/CollectionImportExclusions'
import { ThemedSelect } from '../components/ThemedSelect'
import { PassIdentity } from '../components/PassIdentity'
import { computeClaimDayResults, computeYearRollup } from '../lib/claimOptimizer'
import {
  CARD_SORT_OPTIONS,
  filterCardsByRarityPreset,
  filterCardsBySearch,
  filterCardsBySport,
  filterCardsByTeamPass,
  sortCards,
  type CardSortKey,
  type RarityFilterValue,
  type SortDirection,
} from '../lib/cardSort'
import { displayRaxValue } from '../lib/displayRax'
import { formatRemoveCardConfirmMessage } from '../lib/cardProfile'
import { listIgnoredPasses } from '../lib/ignoredPasses'
import { formatRax } from '../lib/format'
import { RARITY_TIERS } from '../lib/rarityFilter'
import { isPlayerPassForSell } from '../lib/passKind'
import { useRaxData } from '../context/RaxDataContext'
import { SPORTS, type Sport } from '../types/rax'
import './PlanningPages.css'

const CARDS_PAGE_SIZE = 50

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize))
}

export default function CardsPage() {
  const {
    data,
    setCardRarity,
    removeCardFromCollection,
    ignorePassOnImport,
    unignorePassKey,
  } = useRaxData()
  const [removeStatus, setRemoveStatus] = useState('')
  const [sortKey, setSortKey] = useState<CardSortKey>('claimable')
  const [secondarySortKey, setSecondarySortKey] = useState<CardSortKey | 'none'>('none')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [sportFilter, setSportFilter] = useState<Sport | 'All'>('All')
  const [rarityFilter, setRarityFilter] = useState<RarityFilterValue>('All')
  const [cardSearchQuery, setCardSearchQuery] = useState('')
  const [showTeamCards, setShowTeamCards] = useState(true)
  const [cardsPage, setCardsPage] = useState(1)

  const ignoredPasses = useMemo(() => listIgnoredPasses(data), [data])

  const claimResults = useMemo(() => computeClaimDayResults(data), [data])
  const rollup = useMemo(() => computeYearRollup(data, claimResults), [data, claimResults])

  const filteredCards = useMemo(
    () =>
      filterCardsBySearch(
        filterCardsByTeamPass(
          filterCardsByRarityPreset(
            filterCardsBySport(rollup.cards, sportFilter),
            rarityFilter,
          ),
          showTeamCards,
        ),
        cardSearchQuery,
      ),
    [rollup.cards, sportFilter, rarityFilter, showTeamCards, cardSearchQuery],
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

  const cardsPageTotal = pageCount(sortedCards.length, CARDS_PAGE_SIZE)
  const paginatedCards = useMemo(
    () => paginate(sortedCards, cardsPage, CARDS_PAGE_SIZE),
    [cardsPage, sortedCards],
  )

  useEffect(() => {
    setCardsPage(1)
  }, [sportFilter, rarityFilter, sortKey, secondarySortKey, sortDirection, cardSearchQuery, showTeamCards])

  useEffect(() => {
    if (cardsPage > cardsPageTotal) {
      setCardsPage(cardsPageTotal)
    }
  }, [cardsPage, cardsPageTotal])

  const handleRemoveFromCollection = (card: (typeof rollup.cards)[number]['card']) => {
    if (!window.confirm(formatRemoveCardConfirmMessage(card))) return
    const removed = removeCardFromCollection(card.id, {
      removedNote: `Removed ${new Date().toISOString().slice(0, 10)} (planned sale)`,
    })
    if (!removed) return
    setRemoveStatus(
      `Removed ${card.name || 'pass'} from your collection. Earnings saved under Entry → Saved profiles.`,
    )
  }

  return (
    <div className="page-stack refresh-page cards-refresh collection-workspace">
      <section className="collection-heading"><div><p className="eyebrow">Your collection</p><h1>Cards</h1><p>Review your passes and their claimable RAX.</p></div><div className="collection-heading-actions"><Link className="button" to="/entry">Add cards</Link><Link className="button primary" to="/sell">Explore if sold</Link></div></section>
      <div className="collection-summary"><div><span>Collection</span><strong>{rollup.cards.length.toLocaleString()}</strong><small>passes</small></div><div><span>Showing</span><strong>{sortedCards.length.toLocaleString()}</strong><small>matching filters</small></div><div><span>Sports</span><strong>{rollup.sports.length.toLocaleString()}</strong><small>with entries</small></div></div>
      <CollapsiblePanel
        title="Your cards"
        description="Claimable RAX includes guaranteed and Pro bonus. Rarity changes save to your collection."
        badge={`${sortedCards.length} card${sortedCards.length === 1 ? '' : 's'}`}
      >
        {removeStatus ? <p className="import-status">{removeStatus}</p> : null}
        <div className="sort-controls">
          <label className="field inline-field rank-search-field">
            <span>Search cards</span>
            <input
              type="search"
              value={cardSearchQuery}
              placeholder="Player, team, sport, season…"
              onChange={(event) => setCardSearchQuery(event.target.value)}
            />
          </label>
          <ThemedSelect
            label="Sport"
            value={sportFilter}
            onChange={(value) => setSportFilter(value as Sport | 'All')}
            options={[
              { value: 'All', label: 'All sports' },
              ...SPORTS.map((sport) => ({ value: sport, label: sport })),
            ]}
          />
          <ThemedSelect
            label="Rarity"
            value={rarityFilter}
            onChange={(value) => setRarityFilter(value as RarityFilterValue)}
            options={[
              { value: 'All', label: 'All rarities' },
              { value: 'Legendary+', label: 'Legendary+' },
              ...RARITY_TIERS.map((tier) => ({ value: tier, label: tier })),
              { value: 'Unknown', label: 'Unknown' },
            ]}
          />
          <ThemedSelect
            label="Sort by"
            value={sortKey}
            onChange={(value) => setSortKey(value as CardSortKey)}
            options={CARD_SORT_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
          <details className="collection-advanced-filters">
            <summary>More filters{!showTeamCards || secondarySortKey !== 'none' || sortDirection !== 'desc' ? ' · active' : ''}</summary>
            <div className="collection-advanced-content">
              <label className="inline-toggle">
                <input type="checkbox" checked={showTeamCards} onChange={(event) => setShowTeamCards(event.target.checked)} />
                Team passes
              </label>
          <ThemedSelect
            label="Then by"
            value={secondarySortKey}
            onChange={(value) => setSecondarySortKey(value as CardSortKey | 'none')}
            options={[
              { value: 'none', label: 'None' },
              ...CARD_SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
          />
          <ThemedSelect
            label="Direction"
            value={sortDirection}
            onChange={(value) => setSortDirection(value as SortDirection)}
            options={[
              { value: 'desc', label: 'High to low / Z-A' },
              { value: 'asc', label: 'Low to high / A-Z' },
            ]}
          />
            </div>
          </details>
        </div>

        {sortedCards.length > CARDS_PAGE_SIZE ? (
          <p className="import-hint">
            Page {cardsPage} of {cardsPageTotal}
          </p>
        ) : null}

        <div className="table-wrap collection-table-wrap">
          <table className="collection-table">
            <thead>
              <tr>
                <th>Player card</th>
                <th>Rarity</th>
                <th>Breakdown</th>
                <th>Total claimable</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rollup.cards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    Add player cards to see card-level totals.
                  </td>
                </tr>
              ) : filteredCards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    No cards match the current search, sport, rarity, or team-pass filters.
                  </td>
                </tr>
              ) : (
                paginatedCards.map((cardRollup) => (
                  <tr key={cardRollup.card.id}>
                    <td data-label="Pass">
                      <PassIdentity
                        name={cardRollup.card.name}
                        passKind={cardRollup.card.passKind === 'team' ? 'team' : 'player'}
                        sport={cardRollup.card.sport}
                        avatar={cardRollup.card.avatar}
                        size="md"
                        meta={<>{cardRollup.card.sport} · {cardRollup.card.season}{isPlayerPassForSell(cardRollup.card) ? (
                          <> · {' '}
                            <Link className="table-sub" to={`/sell?card=${cardRollup.card.id}`}>
                              If sold
                            </Link>
                          </>) : null}</>}
                      />
                    </td>
                    <td data-label="Rarity">
                      <CardRaritySelect card={cardRollup.card} onConfirmChange={setCardRarity} />
                    </td>
                    <td className="collection-breakdown" data-label="Breakdown">
                      <div className="collection-breakdown-metrics">
                      <div><span>Guaranteed</span><strong>{formatRax(displayRaxValue(cardRollup.guaranteedRax))} <small>({cardRollup.guaranteedClaims})</small></strong></div>
                      <div><span>Pro bonus</span><strong>{formatRax(displayRaxValue(cardRollup.proBonusRax))} <small>({cardRollup.proBonusClaims})</small></strong></div>
                      <div><span>Overlap</span><strong>{formatRax(displayRaxValue(cardRollup.overlapRax))} <small>({cardRollup.overlapCount})</small></strong></div>
                      <small>{cardRollup.performanceCount} entries · {formatRax(displayRaxValue(cardRollup.totalBaseRax))} base</small>
                      </div>
                    </td>
                    <td data-label="Total claimable">
                      <strong className="collection-claimable-value">{formatRax(displayRaxValue(cardRollup.totalClaimableRax))}<small>RAX</small></strong>
                    </td>
                    <td data-label="Actions">
                      <span className="button-row compact-actions">
                        <button
                          className="button danger compact"
                          type="button"
                          onClick={() => handleRemoveFromCollection(cardRollup.card)}
                        >
                          Remove
                        </button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {sortedCards.length > CARDS_PAGE_SIZE ? (
          <div className="table-pagination">
            <button
              className="button"
              type="button"
              disabled={cardsPage <= 1}
              onClick={() => setCardsPage((page) => page - 1)}
            >
              Previous
            </button>
            <span>
              Page {cardsPage} of {cardsPageTotal}
            </span>
            <button
              className="button"
              type="button"
              disabled={cardsPage >= cardsPageTotal}
              onClick={() => setCardsPage((page) => page + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Sport totals"
        description="Claimable RAX rolled up by sport across your collection."
        badge={`${rollup.cards.length} cards`}
        defaultOpen={false}
      >
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
                      {formatRax(displayRaxValue(sport.guaranteedRax))} RAX
                      <small className="table-sub">{sport.guaranteedClaims} claims</small>
                    </td>
                    <td>
                      {formatRax(displayRaxValue(sport.proBonusRax))} RAX
                      <small className="table-sub">{sport.proBonusClaims} claims</small>
                    </td>
                    <td>
                      {formatRax(displayRaxValue(sport.overlapRax))} RAX
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
      </CollapsiblePanel>
      <CollectionImportExclusions cards={rollup.cards} ignoredPasses={ignoredPasses} onIgnore={ignorePassOnImport} onAllow={unignorePassKey} />
    </div>
  )
}

