import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CollapsiblePanel from '../components/CollapsiblePanel'
import CardRaritySelect from '../components/CardRaritySelect'
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
import {
  formatIgnorePassConfirmMessage,
  listIgnoredPasses,
} from '../lib/ignoredPasses'
import { formatRax } from '../lib/format'
import { RARITY_TIERS } from '../lib/rarityFilter'
import { isPlayerPassForSell } from '../lib/passKind'
import { useRaxData } from '../context/RaxDataContext'
import { SPORTS, type Sport } from '../types/rax'

const CARDS_PAGE_SIZE = 50

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize))
}

export default function CardsPage() {
  const { data, setCardRarity, removeCardFromCollection, ignorePassOnImport, unignorePassKey } =
    useRaxData()
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

  const handleIgnoreOnImport = (card: (typeof rollup.cards)[number]['card']) => {
    if (!card.externalKey) return
    if (!window.confirm(formatIgnorePassConfirmMessage(card))) return
    const ignored = ignorePassOnImport(card.id)
    if (!ignored) return
    setRemoveStatus(
      `Ignored ${card.name || 'pass'} on import — removed from collection. Manage under Ignored passes.`,
    )
  }

  return (
    <div className="page-stack">
      <CollapsiblePanel
        title="Player card totals"
        description="Guaranteed + Pro bonus claimable RAX. Filter, sort, edit rarity — saves with your collection."
        badge={`${sortedCards.length} card${sortedCards.length === 1 ? '' : 's'}`}
        actions={
          <>
            <Link to="/sell">If sold</Link>
            <span className="section-action-sep" aria-hidden="true">
              ·
            </span>
            <Link to="/entry">Manage cards</Link>
          </>
        }
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
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={showTeamCards}
              onChange={(event) => setShowTeamCards(event.target.checked)}
            />
            Team passes
          </label>
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
            <span>Rarity</span>
            <select
              value={rarityFilter}
              onChange={(event) => setRarityFilter(event.target.value as RarityFilterValue)}
            >
              <option value="All">All rarities</option>
              <option value="Legendary+">Legendary+</option>
              {RARITY_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
              <option value="Unknown">Unknown</option>
            </select>
          </label>
          <label className="field inline-field">
            <span>Sort by</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as CardSortKey)}>
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
              onChange={(event) => setSecondarySortKey(event.target.value as CardSortKey | 'none')}
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

        {sortedCards.length > CARDS_PAGE_SIZE ? (
          <p className="import-hint">
            Page {cardsPage} of {cardsPageTotal}
          </p>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player card</th>
                <th>Sport</th>
                <th>Season</th>
                <th>Rarity</th>
                <th>Entries</th>
                <th>Total base</th>
                <th>Guaranteed</th>
                <th>Pro bonus</th>
                <th>Overlap</th>
                <th>Total claimable</th>
                <th></th>
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
                    No cards match the current search, sport, rarity, or team-pass filters.
                  </td>
                </tr>
              ) : (
                paginatedCards.map((cardRollup) => (
                  <tr key={cardRollup.card.id}>
                    <td>
                      <strong>{cardRollup.card.name}</strong>
                      {isPlayerPassForSell(cardRollup.card) ? (
                        <>
                          <br />
                          <Link className="table-sub" to={`/sell?card=${cardRollup.card.id}`}>
                            If sold →
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td>{cardRollup.card.sport}</td>
                    <td>{cardRollup.card.season}</td>
                    <td>
                      <CardRaritySelect card={cardRollup.card} onConfirmChange={setCardRarity} />
                    </td>
                    <td>{cardRollup.performanceCount}</td>
                    <td>
                      <strong>{formatRax(displayRaxValue(cardRollup.totalBaseRax))} RAX</strong>
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
                      <strong>{formatRax(displayRaxValue(cardRollup.totalClaimableRax))} RAX</strong>
                    </td>
                    <td>
                      <span className="button-row compact-actions">
                        {cardRollup.card.externalKey ? (
                          <button
                            className="button compact"
                            type="button"
                            onClick={() => handleIgnoreOnImport(cardRollup.card)}
                          >
                            Ignore on import
                          </button>
                        ) : null}
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
        title="Ignored passes"
        description="Skipped on every username import for this tracker profile. Un-ignore to allow import again."
        badge={`${ignoredPasses.length}`}
        defaultOpen={ignoredPasses.length > 0}
      >
        {ignoredPasses.length === 0 ? (
          <p className="empty">No ignored passes. Use Ignore on import on a collection card.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pass</th>
                  <th>Sport</th>
                  <th>Season</th>
                  <th>Key</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ignoredPasses.map((pass) => (
                  <tr key={pass.externalKey}>
                    <td>
                      <strong>{pass.name}</strong>
                    </td>
                    <td>{pass.sport || '—'}</td>
                    <td>{pass.season || '—'}</td>
                    <td>
                      <small className="table-sub">{pass.externalKey}</small>
                    </td>
                    <td>
                      <button
                        className="button compact"
                        type="button"
                        onClick={() => {
                          unignorePassKey(pass.externalKey)
                          setRemoveStatus(
                            `Removed ${pass.name} from ignore list. Re-run username import to add it back.`,
                          )
                        }}
                      >
                        Un-ignore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
      </CollapsiblePanel>
    </div>
  )
}

