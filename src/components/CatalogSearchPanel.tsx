import { useEffect, useMemo, useState } from 'react'
import { formatClaimDay, formatRax } from '../lib/format'
import { searchCatalog, type CatalogPassKind, type CatalogSearchResult } from '../lib/catalogApi'

export type CatalogSearchPanelProps = {
  sectionId?: string
  title?: string
  description: string
  badge?: string
  passKind?: CatalogPassKind | 'all'
  actionLabel: string
  loadingKey?: string
  loadingLabel?: string
  disabled?: boolean
  emptyHint?: string
  embedded?: boolean
  onSelect: (result: CatalogSearchResult) => void | Promise<void>
}

export function CatalogSearchPanel({
  sectionId,
  title = 'Search player passes',
  description,
  badge = 'Shared database',
  passKind = 'all',
  actionLabel,
  loadingKey = '',
  loadingLabel = 'Loading…',
  disabled = false,
  emptyHint,
  embedded = false,
  onSelect,
}: CatalogSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState('')

  const visibleResults = useMemo(
    () => (passKind === 'all' ? results : results.filter((result) => result.passKind === passKind)),
    [passKind, results],
  )

  useEffect(() => {
    const trimmed = query.trim()
    setStatus('')
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setSearching(true)
      searchCatalog(trimmed, controller.signal)
        .then((result) => {
          if (!result.storageConfigured) {
            setStatus('Shared catalog search is not configured yet.')
            setResults([])
            return
          }
          setResults(result.results)
          const filtered =
            passKind === 'all'
              ? result.results
              : result.results.filter((item) => item.passKind === passKind)
          setStatus(filtered.length === 0 ? 'No passes match that search in the shared catalog.' : '')
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          setResults([])
          setStatus(error instanceof Error ? error.message : 'Catalog search failed.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [passKind, query])

  const body = (
    <>
      {!embedded ? (
        <div className="section-heading">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
            <p className="catalog-accuracy-disclaimer">
              Shared catalog RAX may be incorrect or incomplete — especially for older NBA seasons. If
              totals look too low, add or correct earnings manually using JSON from{' '}
              <a href="https://realapp.com" target="_blank" rel="noreferrer">
                realapp.com
              </a>
              .
            </p>
          </div>
          <span className="badge">{badge}</span>
        </div>
      ) : (
        <p className="catalog-accuracy-disclaimer">
          Shared catalog RAX may be incorrect or incomplete — especially for older NBA seasons. If
          totals look too low, add or correct earnings manually using JSON from{' '}
          <a href="https://realapp.com" target="_blank" rel="noreferrer">
            realapp.com
          </a>
          .
        </p>
      )}
      <label className="field">
        <span>Search by name, sport, or season</span>
        <input
          type="search"
          value={query}
          placeholder="Player name, sport, or season…"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {!query.trim() ? (
        <p className="card-picker-empty">
          {emptyHint ??
            'Start typing to search the shared Meowbot catalog. Results include daily RAX row counts and total base RAX.'}
        </p>
      ) : searching ? (
        <p className="import-progress">Searching shared catalog…</p>
      ) : visibleResults.length > 0 ? (
        <div className="cached-profile-list" role="listbox" aria-label="Shared catalog results">
          {visibleResults.map((profile) => (
            <button
              key={profile.externalKey}
              type="button"
              className="cached-profile-item"
              disabled={disabled || Boolean(loadingKey)}
              onClick={() => void onSelect(profile)}
            >
              <strong>{profile.name}</strong>
              <small>
                {profile.passKind === 'team' ? 'Team' : 'Player'} · {profile.sport} ·{' '}
                {profile.seasonLabel || profile.seasonYear}
                {profile.rarityLabel ? ` · ${profile.rarityLabel}` : ''} · {profile.rowCount}{' '}
                row{profile.rowCount === 1 ? '' : 's'}
                {profile.totalBaseRax > 0
                  ? ` · ${formatRax(profile.totalBaseRax)} base RAX`
                  : profile.hasEarnings === false
                    ? ' · no earnings'
                    : ''}
                {profile.latestClaimDay ? ` · latest ${formatClaimDay(profile.latestClaimDay)}` : ''}
              </small>
              <span>{loadingKey === profile.externalKey ? loadingLabel : actionLabel}</span>
            </button>
          ))}
        </div>
      ) : null}
      {status ? <p className="import-status">{status}</p> : null}
    </>
  )

  if (embedded) {
    return <div id={sectionId}>{body}</div>
  }

  return (
    <section className="panel form-panel" id={sectionId}>
      {body}
    </section>
  )
}
