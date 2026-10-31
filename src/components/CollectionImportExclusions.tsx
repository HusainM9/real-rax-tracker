import { useEffect, useMemo, useState } from 'react'
import { filterCardsBySearch } from '../lib/cardSort'
import { formatIgnorePassConfirmMessage, type IgnoredPassRow } from '../lib/ignoredPasses'
import type { CardRollup, PlayerCard } from '../types/rax'
import CollapsiblePanel from './CollapsiblePanel'
import { PassIdentity } from './PassIdentity'

const MATCHES_PER_PAGE = 50

type Props = {
  cards: CardRollup[]
  ignoredPasses: IgnoredPassRow[]
  onIgnore: (cardId: string) => boolean
  onAllow: (externalKey: string) => void
}

export default function CollectionImportExclusions({ cards, ignoredPasses, onIgnore, onAllow }: Props) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const matches = useMemo(() => query.trim()
    ? filterCardsBySearch(cards, query).filter(({ card }) => card.externalKey).sort((a, b) => a.card.name.localeCompare(b.card.name))
    : [], [cards, query])
  const pages = Math.max(1, Math.ceil(matches.length / MATCHES_PER_PAGE))
  const currentPage = Math.min(page, pages)
  const visibleMatches = matches.slice((currentPage - 1) * MATCHES_PER_PAGE, currentPage * MATCHES_PER_PAGE)
  useEffect(() => { setPage(1) }, [query])
  useEffect(() => { setPage(currentPage) }, [currentPage])

  const ignore = (card: PlayerCard) => {
    if (!card.externalKey || !window.confirm(formatIgnorePassConfirmMessage(card))) return
    if (onIgnore(card.id)) {
      setStatus(`Ignored ${card.name || 'pass'} on import and removed it from your collection. You can allow it again below.`)
    }
  }

  return (
    <CollapsiblePanel
      id="collection-import-exclusions"
      className="collection-import-exclusions"
      title="Import exclusions"
      description="Choose passes to skip on future username imports. This also removes them from your collection."
      badge={`${ignoredPasses.length} ignored`}
    >
      {status ? <p className="import-status" role="status">{status}</p> : null}
      <label className="field collection-exclusion-search">
        <span>Search your collection</span>
        <input type="search" value={query} placeholder="Player, team, sport, season…" aria-describedby="collection-exclusion-search-hint" onChange={event => setQuery(event.target.value)} />
      </label>
      <p id="collection-exclusion-search-hint" className="import-hint">Search all imported passes, regardless of the filters above.</p>
      {!query.trim() ? <p className="collection-exclusion-empty">Search for a pass to exclude it from imports.</p> : (
        <div className="collection-exclusion-matches">
          <p className="collection-exclusion-count">{matches.length} matching {matches.length === 1 ? 'pass' : 'passes'}</p>
          {matches.length === 0 ? <p className="collection-exclusion-empty">No imported passes match this search.</p> : (
            <ul className="collection-exclusion-list" aria-label="Collection search results">
              {visibleMatches.map(({ card }) => (
                <li key={card.id}>
                  <PassIdentity name={card.name} sport={card.sport} passKind={card.passKind === 'team' ? 'team' : 'player'} size="sm" meta={`${card.sport} · ${card.season}`} />
                  <button className="button compact" type="button" onClick={() => ignore(card)}>Ignore on import</button>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 ? (
            <div className="table-pagination">
              <button className="button compact" type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous matches</button>
              <span>Page {currentPage} of {pages}</span>
              <button className="button compact" type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next matches</button>
            </div>
          ) : null}
        </div>
      )}
      <div className="collection-ignored-passes">
        <h3>Ignored passes <span>{ignoredPasses.length}</span></h3>
        {ignoredPasses.length === 0 ? <p className="import-hint">No passes are excluded from imports.</p> : (
          <ul className="collection-exclusion-list" aria-label="Ignored passes">
            {ignoredPasses.map(pass => (
              <li key={pass.externalKey}>
                <div className="collection-excluded-identity"><strong>{pass.name}</strong><small>{[pass.sport, pass.season].filter(Boolean).join(' · ') || 'Imported pass'}</small></div>
                <button className="button compact" type="button" onClick={() => {
                  onAllow(pass.externalKey)
                  setStatus(`Allowed ${pass.name} on future imports. Run a username import when you want to add it back.`)
                }}>Allow import</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CollapsiblePanel>
  )
}
