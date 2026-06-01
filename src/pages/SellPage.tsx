import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { computeClaimDayResults, computeYearRollup } from '../lib/claimOptimizer'
import { sortCards } from '../lib/cardSort'
import { displayRaxValue } from '../lib/displayRax'
import { formatRax } from '../lib/format'
import { analyzeRemovedCard, computeSaleComparison, formatRemoveCardSummary, formatSignedRax } from '../lib/removeCardAnalysis'
import { useRaxData } from '../context/RaxDataContext'

const CARD_SEARCH_LIMIT = 50

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
  const { data } = useRaxData()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCardId = searchParams.get('card') ?? ''
  const [salePrice, setSalePrice] = useState('')
  const [cardQuery, setCardQuery] = useState('')

  const rollup = useMemo(() => {
    const results = computeClaimDayResults(data)
    return computeYearRollup(data, results)
  }, [data])

  const sortedCards = useMemo(
    () => sortCards(rollup.cards, 'name', 'asc', null),
    [rollup.cards],
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

  const sellAnalysis = useMemo(
    () => (selectedCardId ? analyzeRemovedCard(data, selectedCardId) : null),
    [data, selectedCardId],
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
            See how much claimable RAX you lose, what opens up on other cards, and whether a sale
            price beats keeping the pass. Uses the same guaranteed / overlap / Pro bonus rules as
            the rest of the tracker.
          </p>
        </div>
        <Link className="button" to="/cards">
          Card totals
        </Link>
      </section>

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
                  <strong>{row.card.name || 'Unnamed pass'}</strong>
                  <small>
                    {row.card.sport} · {row.card.season || 'No season'}
                    {row.card.rarityLabel ? ` · ${row.card.rarityLabel}` : ''} ·{' '}
                    {formatRax(displayRaxValue(row.totalClaimableRax))} claimable
                  </small>
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
          <p className="empty">Pick a pass above to simulate selling it.</p>
        </section>
      ) : !sellAnalysis ? (
        <section className="panel">
          <p className="empty">Could not analyze that card.</p>
        </section>
      ) : (
        <CollapsiblePanel
          title={sellAnalysis.card.name}
          description={`${sellAnalysis.card.sport} · ${sellAnalysis.card.season || 'No season'}${sellAnalysis.card.rarityLabel ? ` · ${sellAnalysis.card.rarityLabel}` : ''}`}
          badge={`Net ${formatRax(displayRaxValue(sellAnalysis.netClaimableDelta))}`}
          defaultOpen
        >
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
              <small className="table-sub">collection-wide change</small>
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
                      <td>{gain.candidate.card.name}</td>
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
        </CollapsiblePanel>
      )}
    </div>
  )
}
