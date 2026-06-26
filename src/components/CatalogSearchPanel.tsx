import { useEffect, useMemo, useState } from 'react'
import { formatClaimDay, formatRax } from '../lib/format'
import { searchCatalog, type CatalogPassKind, type CatalogSearchResult } from '../lib/catalogApi'

export type CatalogCollectionAddOptions = {
  defaultRarity: string
  onDefaultRarityChange: (rarity: string) => void
  rarityOptions: readonly string[]
  rarityForResult: (result: CatalogSearchResult) => string
  onRarityForResultChange: (externalKey: string, rarity: string) => void
}

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
  collectionAdd?: CatalogCollectionAddOptions
  onSelect: (result: CatalogSearchResult, rarityLabel: string) => void | Promise<void>
  bundleExternalKeys?: Set<string>
  onToggleBundle?: (result: CatalogSearchResult) => void
  bundleActionLabel?: string
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
  collectionAdd,
  onSelect,
  bundleExternalKeys,
  onToggleBundle,
  bundleActionLabel = 'Add to bundle',
}: CatalogSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState('')
  const bundleEnabled = Boolean(onToggleBundle)
  const collectionAddEnabled = Boolean(collectionAdd)

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
      {collectionAddEnabled ? (
        <ol className="entry-quick-add-steps">
          <li>
            <strong>Search</strong> for a player pass by name
          </li>
          <li>
            <strong>Pick rarity</strong> — defaults below; change per pass if needed
          </li>
          <li>
            <strong>Add to collection</strong> — earnings import automatically when available
          </li>
        </ol>
      ) : null}
      {collectionAddEnabled && collectionAdd ? (
        <label className="field entry-default-rarity-field">
          <span>Default rarity for new passes</span>
          <select
            value={collectionAdd.defaultRarity}
            disabled={disabled}
            onChange={(event) => collectionAdd.onDefaultRarityChange(event.target.value)}
          >
            {collectionAdd.rarityOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
            (collectionAddEnabled
              ? 'Type a player name to search the shared catalog — then click Add to collection. No JSON paste needed when daily earnings are available.'
              : 'Start typing to search the shared Meowbot catalog. Results include daily RAX row counts and total base RAX.')}
        </p>
      ) : searching ? (
        <p className="import-progress">Searching shared catalog…</p>
      ) : visibleResults.length > 0 ? (
        <div
          className={
            bundleEnabled || collectionAddEnabled
              ? 'list catalog-search-result-list'
              : 'cached-profile-list'
          }
          role="listbox"
          aria-label="Shared catalog results"
        >
          {visibleResults.map((profile) => {
            const inBundle = bundleExternalKeys?.has(profile.externalKey) ?? false
            const rowRarity = collectionAdd?.rarityForResult(profile) ?? ''
            if (collectionAddEnabled && collectionAdd) {
              return (
                <div className="list-row catalog-search-result-row catalog-add-result-row" key={profile.externalKey}>
                  <span>
                    <strong>{profile.name}</strong>
                    <small>
                      {profile.passKind === 'team' ? 'Team' : 'Player'} · {profile.sport} ·{' '}
                      {profile.seasonLabel || profile.seasonYear}
                      {profile.rarityLabel ? ` · catalog ${profile.rarityLabel}` : ''} ·{' '}
                      {profile.rowCount} row{profile.rowCount === 1 ? '' : 's'}
                      {profile.totalBaseRax > 0
                        ? ` · ${formatRax(profile.totalBaseRax)} base RAX`
                        : profile.hasEarnings === false
                          ? ' · no earnings yet'
                          : ''}
                      {profile.latestClaimDay
                        ? ` · latest ${formatClaimDay(profile.latestClaimDay)}`
                        : ''}
                    </small>
                  </span>
                  <span className="button-row compact-actions catalog-add-result-actions">
                    <label className="field inline-field catalog-add-rarity-field">
                      <span className="sr-only">Rarity for {profile.name}</span>
                      <select
                        value={rowRarity}
                        disabled={disabled || loadingKey === profile.externalKey}
                        aria-label={`Rarity for ${profile.name}`}
                        onChange={(event) =>
                          collectionAdd.onRarityForResultChange(profile.externalKey, event.target.value)
                        }
                      >
                        {collectionAdd.rarityOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button primary compact"
                      type="button"
                      disabled={disabled || loadingKey === profile.externalKey}
                      onClick={() => void onSelect(profile, rowRarity)}
                    >
                      {loadingKey === profile.externalKey ? loadingLabel : actionLabel}
                    </button>
                  </span>
                </div>
              )
            }

            if (bundleEnabled) {
              return (
                <div className="list-row catalog-search-result-row" key={profile.externalKey}>
                  <span>
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
                      {profile.latestClaimDay
                        ? ` · latest ${formatClaimDay(profile.latestClaimDay)}`
                        : ''}
                    </small>
                  </span>
                  <span className="button-row compact-actions">
                    <button
                      className="button compact"
                      type="button"
                      disabled={disabled || loadingKey === profile.externalKey}
                      onClick={() => void onSelect(profile, profile.rarityLabel ?? '')}
                    >
                      {loadingKey === profile.externalKey ? loadingLabel : actionLabel}
                    </button>
                    <button
                      className={`button compact${inBundle ? ' primary' : ''}`}
                      type="button"
                      disabled={disabled || profile.rowCount === 0}
                      onClick={() => onToggleBundle?.(profile)}
                    >
                      {inBundle ? 'In bundle' : bundleActionLabel}
                    </button>
                  </span>
                </div>
              )
            }

            return (
              <button
                key={profile.externalKey}
                type="button"
                className="cached-profile-item"
                disabled={disabled || Boolean(loadingKey)}
                onClick={() => void onSelect(profile, profile.rarityLabel ?? '')}
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
            )
          })}
        </div>
      ) : null}
      {status ? <p className="import-status">{status}</p> : null}
    </>
  )

  if (embedded) {
    return <div id={sectionId}>{body}</div>
  }

  return (
    <section
      className={`panel form-panel${collectionAddEnabled ? ' entry-catalog-hero' : ''}`}
      id={sectionId}
    >
      {body}
    </section>
  )
}
