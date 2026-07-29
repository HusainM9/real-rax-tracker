import { useEffect, useMemo, useState } from 'react'
import { PassIdentity } from './PassIdentity'
import { formatClaimDay, formatRax } from '../lib/format'
import {
  enrichCatalogProfilesWithAvatars,
  searchCatalog,
  type CatalogPassKind,
  type CatalogSearchResult,
} from '../lib/catalogApi'
import { isPlayerLikeCatalogPass } from '../lib/passKind'

function catalogPassKindLabel(profile: Pick<CatalogSearchResult, 'passKind' | 'sport'>): string {
  if (isPlayerLikeCatalogPass(profile)) return 'Player'
  return profile.passKind === 'team' ? 'Team' : 'Player'
}

function catalogPassKind(profile: Pick<CatalogSearchResult, 'passKind' | 'sport'>): 'player' | 'team' {
  return isPlayerLikeCatalogPass(profile) ? 'player' : profile.passKind === 'team' ? 'team' : 'player'
}

function catalogResultMeta(profile: CatalogSearchResult, extra?: string): string {
  const parts = [
    catalogPassKindLabel(profile),
    profile.sport,
    String(profile.seasonLabel || profile.seasonYear),
  ]
  if (profile.rarityLabel) parts.push(profile.rarityLabel)
  parts.push(`${profile.rowCount} row${profile.rowCount === 1 ? '' : 's'}`)
  if (profile.totalBaseRax > 0) parts.push(`${formatRax(profile.totalBaseRax)} base RAX`)
  else if (profile.hasEarnings === false) parts.push('no earnings yet')
  if (profile.latestClaimDay) parts.push(`latest ${formatClaimDay(profile.latestClaimDay)}`)
  if (extra) parts.push(extra)
  return parts.join(' · ')
}

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
  planAdd?: {
    plannedExternalKeys?: Set<string>
    onPlanLabel?: string
  }
  onAddToPlan?: (result: CatalogSearchResult, rarityLabel: string) => void | Promise<void>
  planActionLabel?: string
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
  planAdd,
  onAddToPlan,
  planActionLabel = 'Add to plan',
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
  const planAddEnabled = Boolean(onAddToPlan)

  const visibleResults = useMemo(() => {
    if (passKind === 'all') return results
    if (passKind === 'player') {
      return results.filter((result) => isPlayerLikeCatalogPass(result))
    }
    return results.filter((result) => result.passKind === passKind)
  }, [passKind, results])

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
        .then(async (result) => {
          if (!result.storageConfigured) {
            setStatus('Shared catalog search is not configured yet.')
            setResults([])
            return
          }
          const enriched = await enrichCatalogProfilesWithAvatars(
            result.results,
            controller.signal,
          )
          if (controller.signal.aborted) return
          setResults(enriched)
          const filtered =
            passKind === 'all'
              ? enriched
              : passKind === 'player'
                ? enriched.filter((item) => isPlayerLikeCatalogPass(item))
                : enriched.filter((item) => item.passKind === passKind)
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
              Catalog RAX can be incomplete (esp. older NBA). Fix with Manual add /{' '}
              <a href="https://realapp.com" target="_blank" rel="noreferrer">
                realapp.com
              </a>{' '}
              JSON if totals look low.
            </p>
          </div>
          <span className="badge">{badge}</span>
        </div>
      ) : (
        <p className="catalog-accuracy-disclaimer">
          Catalog RAX can be incomplete (esp. older NBA). Fix with Manual add /{' '}
          <a href="https://realapp.com" target="_blank" rel="noreferrer">
            realapp.com
          </a>{' '}
          JSON if totals look low.
        </p>
      )}
      {collectionAddEnabled ? (
        <p className="import-hint">Search → rarity → add. Earnings import when available.</p>
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
              ? 'Type a player name, then Add to collection. No JSON needed when earnings exist.'
              : 'Type to search. Results show row counts and base RAX.')}
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
            const onPlan = planAdd?.plannedExternalKeys?.has(profile.externalKey) ?? false
            if (collectionAddEnabled && collectionAdd) {
              return (
                <div className="list-row catalog-search-result-row catalog-add-result-row" key={profile.externalKey}>
                  <PassIdentity
                    name={profile.name}
                    passKind={catalogPassKind(profile)}
                    sport={profile.sport}
                    avatar={profile.avatar}
                    meta={catalogResultMeta(
                      profile,
                      onPlan ? planAdd?.onPlanLabel ?? 'On plan' : undefined,
                    )}
                  />
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
                      disabled={disabled || loadingKey === profile.externalKey || onPlan}
                      onClick={() => void onSelect(profile, rowRarity)}
                    >
                      {onPlan
                        ? planAdd?.onPlanLabel ?? 'On plan'
                        : loadingKey === profile.externalKey
                          ? loadingLabel
                          : actionLabel}
                    </button>
                    {planAddEnabled ? (
                      <button
                        className={`button compact${onPlan ? ' primary' : ''}`}
                        type="button"
                        disabled={disabled || loadingKey === profile.externalKey || onPlan}
                        onClick={() => void onAddToPlan?.(profile, rowRarity)}
                      >
                        {onPlan ? planAdd?.onPlanLabel ?? 'On plan' : planActionLabel}
                      </button>
                    ) : null}
                  </span>
                </div>
              )
            }

            if (bundleEnabled) {
              return (
                <div className="list-row catalog-search-result-row" key={profile.externalKey}>
                  <PassIdentity
                    name={profile.name}
                    passKind={catalogPassKind(profile)}
                    sport={profile.sport}
                    avatar={profile.avatar}
                    meta={catalogResultMeta(profile)}
                  />
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
                    {planAddEnabled ? (
                      <button
                        className={`button compact${onPlan ? ' primary' : ''}`}
                        type="button"
                        disabled={disabled || onPlan}
                        onClick={() => void onAddToPlan?.(profile, profile.rarityLabel ?? '')}
                      >
                        {onPlan ? planAdd?.onPlanLabel ?? 'On plan' : planActionLabel}
                      </button>
                    ) : null}
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
                <PassIdentity
                  name={profile.name}
                  passKind={catalogPassKind(profile)}
                  sport={profile.sport}
                  avatar={profile.avatar}
                  meta={catalogResultMeta(profile)}
                />
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
