import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { marketplaceListingUrl } from '../../lib/marketplaceAlerts'
import type { PlayerMarketplaceResult } from '../../lib/marketplacePlayerListings'
import { currentRealSeasonYear } from '../../lib/seasonClaimWindow'
import { fetchCatalogPassSummaries, type CatalogSearchResult } from '../lib/catalogApi'
import {
  cardReachedTarget, fetchPlayerCards, playerCardCounts, playerMeetsOwnerMinimum,
  PlayerListingsRequestError, sortMarketplacePlayers,
  type PlayerListingSort, type PlayerListingSortDirection,
} from '../lib/marketplacePlayerListingsApi'
import { PassIdentity } from '../components/PassIdentity'
import { SPORTS } from '../types/rax'
import './MarketplacePlayerListings.css'

const LOAD_SIZE = 25
const MAX_SCAN_BATCH = 100
type PlayerResult = { data?: PlayerMarketplaceResult; error?: string }

export default function MarketplacePlayerListings() {
  const [sport, setSport] = useState('NFL')
  const [season, setSeason] = useState(currentRealSeasonYear('nfl'))
  const [players, setPlayers] = useState<CatalogSearchResult[]>([])
  const [catalogKey, setCatalogKey] = useState('')
  const [query, setQuery] = useState('')
  const [scanQuery, setScanQuery] = useState('')
  const [sort, setSort] = useState<PlayerListingSort>('rax')
  const [direction, setDirection] = useState<PlayerListingSortDirection>('desc')
  const [onlyListed, setOnlyListed] = useState(false)
  const [requestedPlayers, setRequestedPlayers] = useState(LOAD_SIZE)
  const [scanRound, setScanRound] = useState(0)
  const [message, setMessage] = useState('Loading players…')
  const [scanError, setScanError] = useState('')
  const [results, setResults] = useState<Record<number, PlayerResult>>({})
  const resultsRef = useRef<Record<number, PlayerResult>>({})
  const refreshPlayersRef = useRef(new Set<number>())
  const [selected, setSelected] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const nextQuery = query.trim().toLowerCase()
    if (nextQuery === scanQuery) return
    const timeout = window.setTimeout(() => {
      setScanQuery(nextQuery)
      setRequestedPlayers(LOAD_SIZE)
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [query, scanQuery])

  useEffect(() => {
    const controller = new AbortController()
    resultsRef.current = {}
    refreshPlayersRef.current.clear()
    setResults({}); setSelected(null); setRequestedPlayers(LOAD_SIZE); setScanError('')
    setPlayers([]); setCatalogKey(''); setMessage('Loading players…')
    void fetchCatalogPassSummaries({ sport, seasonYear: season }, controller.signal).then(({ results: items, storageConfigured }) => {
      if (controller.signal.aborted) return
      const unique = [...new Map(items.filter((item) => item.entityId > 0).map((item) => [item.entityId, item])).values()]
      setPlayers(sortMarketplacePlayers(unique, 'rax', {}))
      setCatalogKey(`${sport}|${season}`)
      setMessage(!storageConfigured ? 'The player catalog is unavailable.' : unique.length ? '' : 'No catalog players found for this sport and season.')
    }).catch((error) => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not load players.')
    })
    return () => controller.abort()
  }, [sport, season])

  const candidates = useMemo(() => catalogKey === `${sport}|${season}` ? players.filter((player) => player.name.toLowerCase().includes(scanQuery)) : [], [players, scanQuery, catalogKey, sport, season])

  useEffect(() => {
    if (candidates.length === 0) { setChecking(false); return }
    const controller = new AbortController()
    let stopped = false
    let index = 0
    const queue = candidates.filter((player) => !resultsRef.current[player.entityId]).slice(0, MAX_SCAN_BATCH)
    const qualifyingCount = () => candidates.filter((player) => {
      const result = resultsRef.current[player.entityId]?.data
      return playerMeetsOwnerMinimum(result) && (!onlyListed || (playerCardCounts(result).target ?? 0) > 0)
    }).length
    const storeResult = (entityId: number, result: PlayerResult) => {
      resultsRef.current = { ...resultsRef.current, [entityId]: result }
      setResults(resultsRef.current)
    }
    setScanError('')
    setChecking(queue.length > 0 && qualifyingCount() < requestedPlayers)
    const worker = async () => {
      while (!controller.signal.aborted && !stopped && index < queue.length && qualifyingCount() < requestedPlayers) {
        const player = queue[index++]!
        try {
          const data = await fetchPlayerCards(sport, season, player.entityId, controller.signal, refreshPlayersRef.current.delete(player.entityId), 100)
          if (!controller.signal.aborted) storeResult(player.entityId, { data })
        } catch (error) {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : 'Could not check this player.'
          storeResult(player.entityId, { error: message })
          if (error instanceof PlayerListingsRequestError && [401, 403, 429, 503].includes(error.status)) {
            stopped = true
            setScanError(message)
          }
        }
      }
    }
    void Promise.all([worker(), worker()]).finally(() => {
      if (!controller.signal.aborted) setChecking(false)
    })
    return () => controller.abort()
  }, [candidates, sport, season, requestedPlayers, onlyListed, scanRound])

  const matchingPlayers = useMemo(() => {
    if (catalogKey !== `${sport}|${season}`) return []
    const counts: Record<number, number | undefined> = {}
    const listedCounts: Record<number, number | undefined> = {}
    const ownerCounts: Record<number, number | null | undefined> = {}
    for (const [id, result] of Object.entries(results)) {
      const count = playerCardCounts(result.data)
      counts[Number(id)] = count.target
      listedCounts[Number(id)] = count.listed
      ownerCounts[Number(id)] = result.data?.ownerCount
    }
    const matching = players.filter((player) => player.name.toLowerCase().includes(query.trim().toLowerCase())
      && playerMeetsOwnerMinimum(results[player.entityId]?.data)
      && (!onlyListed || (counts[player.entityId] ?? 0) > 0))
    return sortMarketplacePlayers(matching, sort, counts, { direction, ownerCounts, listedCounts })
  }, [players, query, results, onlyListed, sort, direction, catalogKey, sport, season])

  const visible = matchingPlayers.slice(0, requestedPlayers)
  const checkedCount = candidates.filter((player) => results[player.entityId]).length
  const uncheckedCount = candidates.length - checkedCount
  const unavailableCount = candidates.filter((player) => results[player.entityId]?.error || results[player.entityId]?.data?.listingsSkipped === 'unknown-owners').length
  const hasMore = uncheckedCount > 0 || matchingPlayers.length > visible.length

  const changeSort = (next: PlayerListingSort) => {
    setDirection(next === sort ? (direction === 'asc' ? 'desc' : 'asc') : next === 'name' ? 'asc' : 'desc')
    setSort(next)
  }
  const sortHeader = (key: PlayerListingSort, label: string, numeric = false) => <th scope="col" className={numeric ? 'is-numeric' : undefined} aria-sort={sort === key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{sort === key ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>
  </th>
  const retryUnavailable = () => {
    for (const [id, result] of Object.entries(resultsRef.current)) {
      if (result.error || result.data?.listingsSkipped === 'unknown-owners') refreshPlayersRef.current.add(Number(id))
    }
    resultsRef.current = Object.fromEntries(Object.entries(resultsRef.current).filter(([, result]) => !result.error && result.data?.listingsSkipped !== 'unknown-owners'))
    setResults(resultsRef.current)
    setScanRound((round) => round + 1)
  }

  return <section className="marketplace-cards-view">
    <div className="marketplace-cards-heading"><p>Individual card auctions, not bulk listings. Only players with at least 100 verified owners are shown.</p></div>
    <div className="marketplace-cards-filters">
      <label>Sport<select value={sport} onChange={(event) => { const next = event.target.value; setSport(next); setSeason(currentRealSeasonYear(next)) }}>
        {SPORTS.filter((value) => value !== 'Other').map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label>Season<input type="number" min="2000" max="2200" value={season} onChange={(event) => setSeason(Number(event.target.value))} /></label>
      <label>Find player<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" /></label>
      <label>Listings<select value={onlyListed ? 'target' : 'all'} onChange={(event) => { setOnlyListed(event.target.value === 'target'); setRequestedPlayers(LOAD_SIZE) }}><option value="all">All qualifying players</option><option value="target">With cards at target</option></select></label>
    </div>
    <div className="marketplace-cards-table-status" role="status"><span>{visible.length.toLocaleString()} players shown{checking ? ' · Checking ownership and listings…' : ` · ${checkedCount.toLocaleString()} checked`}</span>{checking ? <span className="marketplace-cards-loading">Loading</span> : null}</div>
    {message ? <p className="marketplace-cards-note" role="status">{message}</p> : null}
    {scanError ? <p className="form-error" role="alert">{scanError}</p> : null}
    <div className="marketplace-players-table-wrap">
      <table className="marketplace-players-table">
        <caption className="sr-only">Player card listings. Click a column heading to sort loaded players.</caption>
        <thead><tr>{sortHeader('name', 'Player')}{sortHeader('owners', 'Owners', true)}{sortHeader('rax', 'RAX earned', true)}{sortHeader('listed', 'Cards listed', true)}{sortHeader('cards', 'At target', true)}<th scope="col">Checked</th><th scope="col"><span className="sr-only">Listings</span></th></tr></thead>
        <tbody>{visible.map((player) => {
          const data = results[player.entityId]!.data!
          const counts = playerCardCounts(data)
          const incomplete = data.incompleteTypes.includes('card')
          const expanded = selected === player.entityId
          const cards = data.listings.filter((card) => card.status === 'open' && card.listingType?.toLowerCase() === 'card')
          return <Fragment key={player.entityId}>
            <tr className={expanded ? 'is-expanded' : undefined}>
              <th scope="row"><PassIdentity name={player.name} sport={player.sport} passKind={player.passKind === 'team' ? 'team' : 'player'} avatar={player.avatar} meta={`${player.sport} · ${player.seasonLabel || player.seasonYear}`} /></th>
              <td className="is-numeric">{data.ownerCount!.toLocaleString()}</td>
              <td className="is-numeric">{player.totalBaseRax.toLocaleString()}</td>
              <td className="is-numeric">{counts.listed == null ? <span className="marketplace-count-unknown">Unavailable</span> : `${incomplete ? '≥ ' : ''}${counts.listed.toLocaleString()}`}</td>
              <td className={`is-numeric${counts.target ? ' has-target-cards' : ''}`}>{counts.target == null ? '—' : `${incomplete ? '≥ ' : ''}${counts.target.toLocaleString()}`}</td>
              <td><time dateTime={data.fetchedAt}>{new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></td>
              <td><button className="marketplace-player-listings-link" type="button" aria-label={`${expanded ? 'Hide' : 'View'} listings for ${player.name}`} aria-expanded={expanded} aria-controls={`player-listings-${player.entityId}`} onClick={() => setSelected(expanded ? null : player.entityId)}>{expanded ? 'Hide' : 'View listings'} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button></td>
            </tr>
            {expanded ? <tr className="marketplace-player-expanded-row"><td colSpan={7} id={`player-listings-${player.entityId}`}>
              {incomplete ? <p className="marketplace-cards-note">Partial feed: counts are lower bounds. More auctions may be available.</p> : null}
              {cards.length === 0 ? <p className="marketplace-cards-note">{incomplete ? 'Listings could not be fully loaded.' : 'No open card auctions found.'}</p> : <table className="marketplace-player-auctions"><thead><tr><th scope="col">Card</th><th scope="col" className="is-numeric">Current bid</th><th scope="col" className="is-numeric">Seller target</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open auction</span></th></tr></thead><tbody>{cards.map((card) => {
                const url = marketplaceListingUrl(card.id)
                return <tr key={String(card.id)}><td>{card.card?.detail || card.card?.label || 'Card listing'}</td><td className="is-numeric">{Number(card.currentBidAmount ?? card.minBidPrice ?? 0).toLocaleString()} RAX</td><td className="is-numeric">{Number(card.buyNowPrice) > 0 ? `${Number(card.buyNowPrice).toLocaleString()} RAX` : '—'}</td><td>{cardReachedTarget(card) ? 'At target' : 'Open'}</td><td>{url ? <a href={url} target="_blank" rel="noreferrer">View on Real ↗</a> : null}</td></tr>
              })}</tbody></table>}
            </td></tr> : null}
          </Fragment>
        })}{visible.length === 0 ? <tr><td colSpan={7} className="marketplace-players-empty">{checking ? 'Checking players in the background…' : message || (scanError ? 'Listings are unavailable until the connection is restored.' : 'No verified players match these filters in the checked results.')}</td></tr> : null}</tbody>
      </table>
    </div>
    <div className="marketplace-cards-table-footer">
      <p>Click headers to sort loaded players. “At target” means the current bid meets the seller’s target. ≥ indicates a partial feed.</p>
      {hasMore && !scanError ? <button className="button" type="button" disabled={checking} onClick={() => {
        if (matchingPlayers.length >= requestedPlayers) setRequestedPlayers((count) => count + LOAD_SIZE)
        else setScanRound((round) => round + 1)
      }}>{checking ? 'Loading…' : matchingPlayers.length < requestedPlayers ? 'Check more players' : `Load ${LOAD_SIZE} more`}</button> : null}
    </div>
    {unavailableCount > 0 ? <p className="marketplace-cards-note">{unavailableCount} player{unavailableCount === 1 ? '' : 's'} could not be verified and {unavailableCount === 1 ? 'is' : 'are'} hidden. <button type="button" className="link-button" disabled={checking} onClick={retryUnavailable}>Retry unavailable players</button></p> : null}
  </section>
}
