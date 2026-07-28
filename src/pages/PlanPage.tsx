import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { useRaxData } from '../context/RaxDataContext'
import type { CatalogImportProfile } from '../lib/catalogApi'
import { fetchCatalogImportProfilesBulk } from '../lib/catalogApi'
import { displayRaxValue } from '../lib/displayRax'
import { formatRax } from '../lib/format'
import {
  analyzePlanCollection,
  plannedPassIconic1TotalRax,
  type PlannedPassCardAnalysis,
} from '../lib/plannedPasses'
import { RECOMMENDATION_SIMULATED_RARITY } from '../lib/passRecommendation'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { formatSignedRax } from '../lib/removeCardAnalysis'
import { SPORTS, type Sport } from '../types/rax'

const PLAN_RARITY_OPTIONS = RARITY_PREVIEW_OPTIONS.filter((option) => option.length > 0)

type PlanSortKey = 'soloNet' | 'planNet' | 'name' | 'sport' | 'added'
type PassKindFilter = 'all' | 'player' | 'team'

function signedRaxClass(value: number): string {
  if (value > 0) return 'sale-positive'
  if (value < 0) return 'sale-negative'
  return ''
}

function matchesPlanSearch(entry: PlannedPassCardAnalysis, query: string): boolean {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return true
  const { pass } = entry
  const haystack = [
    pass.name,
    pass.sport,
    pass.season,
    pass.passKind,
    pass.simulatedRarityLabel,
    pass.source,
    pass.notes,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(trimmed)
}

function soloNetValue(entry: PlannedPassCardAnalysis): number {
  return entry.solo?.netClaimableDelta ?? Number.NEGATIVE_INFINITY
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="stat-card panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className="table-sub">{hint}</small>
    </article>
  )
}

function PlanPassCard({
  entry,
  marginalNet,
  onRemove,
}: {
  entry: PlannedPassCardAnalysis
  marginalNet: number | null
  onRemove: () => void
}) {
  const { pass, solo, ownedAtIconic, missingProfile, missingRows } = entry
  const iconic1Total = plannedPassIconic1TotalRax(pass, entry.profile)

  return (
    <article className="panel plan-pass-row">
      <div className="plan-pass-row-main">
        <div className="plan-pass-identity">
          <h3>{pass.name}</h3>
          <p className="plan-pass-meta">
            {pass.passKind === 'team' ? 'Team' : 'Player'} · {pass.sport} · {pass.season} ·{' '}
            {pass.simulatedRarityLabel}
          </p>
        </div>

        {ownedAtIconic ? (
          <p className="import-hint plan-pass-status owned">Already owned at Iconic 1+</p>
        ) : missingProfile ? (
          <p className="import-hint plan-pass-status warning">Catalog profile not loaded yet</p>
        ) : missingRows ? (
          <p className="import-hint plan-pass-status warning">No catalog earnings for this pass</p>
        ) : solo ? (
          <div className="plan-pass-row-stats">
            <div className="plan-pass-primary">
              <span>Solo net</span>
              <strong className={signedRaxClass(solo.netClaimableDelta)}>
                {formatSignedRax(displayRaxValue(solo.netClaimableDelta))}
              </strong>
              <small>{formatSignedRax(displayRaxValue(solo.netGuaranteedDelta))} guaranteed</small>
            </div>
            {marginalNet != null ? (
              <div className="plan-pass-primary">
                <span>In plan</span>
                <strong className={signedRaxClass(marginalNet)}>
                  {formatSignedRax(displayRaxValue(marginalNet))}
                </strong>
                <small>after overlap</small>
              </div>
            ) : null}
            <div className="plan-pass-secondary">
              <span>
                Claimable {formatRax(displayRaxValue(solo.newClaimableRax))}
                {solo.displacedRax > 0
                  ? ` · displaces ${formatRax(displayRaxValue(solo.displacedRax))}`
                  : ''}
                {solo.overlapRax > 0
                  ? ` · overlap ${formatRax(displayRaxValue(solo.overlapRax))}`
                  : ''}
              </span>
              <span>
                {pass.simulatedRarityLabel} {formatRax(displayRaxValue(iconic1Total))} · base{' '}
                {formatRax(displayRaxValue(pass.totalBaseRax))}
              </span>
            </div>
          </div>
        ) : (
          <p className="import-hint plan-pass-status warning">Could not analyze this pass</p>
        )}
      </div>

      <div className="plan-pass-row-actions">
        <Link className="link-button" to="/potential">
          Analyze
        </Link>
        <button className="button danger compact" type="button" onClick={onRemove}>
          Remove
        </button>
      </div>
    </article>
  )
}

export default function PlanPage() {
  const { data, addPlannedPassFromCatalog, removePlannedPass } = useRaxData()
  const [profilesByKey, setProfilesByKey] = useState<Map<string, CatalogImportProfile>>(new Map())
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [profilesStatus, setProfilesStatus] = useState('')
  const [catalogLoadingKey, setCatalogLoadingKey] = useState('')
  const [catalogStatus, setCatalogStatus] = useState('')
  const [defaultRarity, setDefaultRarity] = useState(RECOMMENDATION_SIMULATED_RARITY)
  const [rarityByKey, setRarityByKey] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [sportFilter, setSportFilter] = useState<Sport | 'All'>('All')
  const [seasonFilter, setSeasonFilter] = useState('All')
  const [passKindFilter, setPassKindFilter] = useState<PassKindFilter>('all')
  const [sortKey, setSortKey] = useState<PlanSortKey>('soloNet')

  const plannedPasses = data.plannedPasses ?? []
  const plannedExternalKeys = useMemo(
    () => new Set(plannedPasses.map((pass) => pass.externalKey)),
    [plannedPasses],
  )

  const availableSeasons = useMemo(() => {
    return [...new Set(plannedPasses.map((pass) => pass.season).filter(Boolean))].sort((a, b) =>
      b.localeCompare(a),
    )
  }, [plannedPasses])

  const availableSports = useMemo(() => {
    const used = new Set(plannedPasses.map((pass) => pass.sport))
    return SPORTS.filter((sport) => used.has(sport))
  }, [plannedPasses])

  useEffect(() => {
    const keys = plannedPasses.map((pass) => pass.externalKey)
    if (keys.length === 0) {
      setProfilesByKey(new Map())
      setProfilesStatus('')
      return
    }

    const controller = new AbortController()
    setProfilesLoading(true)
    setProfilesStatus('Loading catalog earnings for planned passes…')

    fetchCatalogImportProfilesBulk(keys, controller.signal)
      .then(({ profiles, storageConfigured }) => {
        if (!storageConfigured) {
          setProfilesStatus('Shared catalog is not configured yet.')
          setProfilesByKey(new Map())
          return
        }
        setProfilesByKey(new Map(profiles.map((profile) => [profile.externalKey, profile])))
        setProfilesStatus('')
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setProfilesStatus(error instanceof Error ? error.message : 'Could not load planned passes.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfilesLoading(false)
      })

    return () => controller.abort()
  }, [plannedPasses])

  const analysis = useMemo(
    () => analyzePlanCollection(data, plannedPasses, profilesByKey),
    [data, plannedPasses, profilesByKey],
  )

  const marginalByExternalKey = useMemo(() => {
    const map = new Map<string, number>()
    if (!analysis.bundle) return map
    for (const row of analysis.bundle.rows) {
      const externalKey = row.key.startsWith('catalog:')
        ? row.key.slice('catalog:'.length)
        : row.key
      map.set(externalKey, row.marginalNetDelta)
    }
    return map
  }, [analysis.bundle])

  const filteredPasses = useMemo(() => {
    const filtered = analysis.passes.filter((entry) => {
      if (!matchesPlanSearch(entry, searchQuery)) return false
      if (sportFilter !== 'All' && entry.pass.sport !== sportFilter) return false
      if (seasonFilter !== 'All' && entry.pass.season !== seasonFilter) return false
      if (passKindFilter !== 'all' && entry.pass.passKind !== passKindFilter) return false
      return true
    })

    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sortKey === 'name') return a.pass.name.localeCompare(b.pass.name)
      if (sortKey === 'sport') {
        const sportCmp = a.pass.sport.localeCompare(b.pass.sport)
        return sportCmp !== 0 ? sportCmp : a.pass.name.localeCompare(b.pass.name)
      }
      if (sortKey === 'added') return b.pass.addedAt.localeCompare(a.pass.addedAt)
      if (sortKey === 'planNet') {
        const aVal = marginalByExternalKey.get(a.pass.externalKey) ?? soloNetValue(a)
        const bVal = marginalByExternalKey.get(b.pass.externalKey) ?? soloNetValue(b)
        return bVal - aVal
      }
      return soloNetValue(b) - soloNetValue(a)
    })
    return sorted
  }, [analysis.passes, searchQuery, sportFilter, seasonFilter, passKindFilter, sortKey, marginalByExternalKey])

  const filtersActive =
    searchQuery.trim() !== '' ||
    sportFilter !== 'All' ||
    seasonFilter !== 'All' ||
    passKindFilter !== 'all'

  const handleCatalogSelect = async (
    result: Parameters<typeof addPlannedPassFromCatalog>[0],
    rarityLabel: string,
  ) => {
    setCatalogLoadingKey(result.externalKey)
    setCatalogStatus('')
    try {
      const id = addPlannedPassFromCatalog(result, rarityLabel, 'catalog')
      if (!id) {
        setCatalogStatus(`${result.name} is already on your plan.`)
        return
      }
      setCatalogStatus(`Added ${result.name} to your plan at ${rarityLabel || defaultRarity}.`)
    } finally {
      setCatalogLoadingKey('')
    }
  }

  return (
    <div className="page-stack plan-page">
      <section className="hero-card">
        <p className="eyebrow">Purchase plan</p>
        <h1>Plan</h1>
        <p>
          Save catalog passes you are considering and see how they would change your collection.
          Analysis updates automatically when your collection or plan changes.
        </p>
        <div className="button-row">
          <Link className="button" to="/potential">
            Rank catalog passes
          </Link>
          <Link className="button" to="/entry">
            Add to collection
          </Link>
          <Link className="button" to="/packs">
            Track player packs
          </Link>
        </div>
      </section>

      <section className="panel pack-plan-teaser">
        <div>
          <h2>Player packs</h2>
          <p className="table-sub">
            Import Real play ratings across accounts and track progress to Iconic (3,380).
          </p>
        </div>
        <Link className="button" to="/packs">
          Open pack tracker
        </Link>
      </section>

      <section className="stats-grid plan-summary-grid">
        <StatCard
          label="Collection now"
          value={formatRax(displayRaxValue(analysis.currentClaimable))}
          hint={`${formatRax(displayRaxValue(analysis.currentGuaranteed))} guaranteed`}
        />
        <StatCard
          label="With full plan"
          value={formatRax(displayRaxValue(analysis.withPlanClaimable))}
          hint={`${formatRax(displayRaxValue(analysis.withPlanGuaranteed))} guaranteed`}
        />
        <StatCard
          label="Plan net gain"
          value={formatSignedRax(displayRaxValue(analysis.combinedNetDelta))}
          hint={`${analysis.activeProfiles.length} active · ${formatSignedRax(displayRaxValue(analysis.combinedGuaranteedNetDelta))} guaranteed`}
        />
      </section>

      {profilesLoading ? <p className="import-progress">{profilesStatus || 'Loading plan…'}</p> : null}
      {profilesStatus && !profilesLoading ? <p className="import-status">{profilesStatus}</p> : null}
      {catalogStatus ? <p className="import-status">{catalogStatus}</p> : null}

      {plannedPasses.length > 0 ? (
        <>
          {analysis.bundle && analysis.bundle.rows.length > 1 ? (
            <CollapsiblePanel
              className="nested-panel"
              title="Combined plan order"
              description="Same-sport overlap counted in plan order (best solo net first within each sport)."
              defaultOpen={false}
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Pass</th>
                      <th>Marginal net</th>
                      <th>Solo net</th>
                      <th>Claimable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.bundle.rows.map((row, index) => (
                        <tr key={row.key}>
                          <td>{index + 1}</td>
                          <td>
                            {row.name}
                            <br />
                            <small className="table-sub">
                              {row.sport} · {row.season}
                            </small>
                          </td>
                          <td>
                            <strong className={signedRaxClass(row.marginalNetDelta)}>
                              {formatSignedRax(displayRaxValue(row.marginalNetDelta))}
                            </strong>
                          </td>
                          <td>{formatSignedRax(displayRaxValue(row.isolatedNetDelta))}</td>
                          <td>{formatRax(displayRaxValue(row.passClaimableRax))}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CollapsiblePanel>
          ) : null}

          <section className="panel plan-filters">
            <div className="sort-controls">
              <label className="field inline-field rank-search-field">
                <span>Search plan</span>
                <input
                  type="search"
                  value={searchQuery}
                  placeholder="Player, sport, season…"
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>
              <label className="field inline-field">
                <span>Sport</span>
                <select
                  value={sportFilter}
                  onChange={(event) => setSportFilter(event.target.value as Sport | 'All')}
                >
                  <option value="All">All sports</option>
                  {(availableSports.length > 0 ? availableSports : SPORTS).map((sport) => (
                    <option key={sport} value={sport}>
                      {sport}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field inline-field">
                <span>Season</span>
                <select
                  value={seasonFilter}
                  onChange={(event) => setSeasonFilter(event.target.value)}
                >
                  <option value="All">All seasons</option>
                  {availableSeasons.map((season) => (
                    <option key={season} value={season}>
                      {season}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field inline-field">
                <span>Type</span>
                <select
                  value={passKindFilter}
                  onChange={(event) => setPassKindFilter(event.target.value as PassKindFilter)}
                >
                  <option value="all">All types</option>
                  <option value="player">Player</option>
                  <option value="team">Team</option>
                </select>
              </label>
              <label className="field inline-field">
                <span>Sort by</span>
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as PlanSortKey)}
                >
                  <option value="soloNet">Solo net</option>
                  <option value="planNet">In-plan net</option>
                  <option value="name">Name</option>
                  <option value="sport">Sport</option>
                  <option value="added">Recently added</option>
                </select>
              </label>
            </div>
            <p className="table-sub plan-filter-count">
              Showing {filteredPasses.length} of {analysis.passes.length}
              {filtersActive ? (
                <>
                  {' · '}
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => {
                      setSearchQuery('')
                      setSportFilter('All')
                      setSeasonFilter('All')
                      setPassKindFilter('all')
                    }}
                  >
                    Clear filters
                  </button>
                </>
              ) : null}
            </p>
          </section>

          <section className="plan-pass-list">
            {filteredPasses.length === 0 ? (
              <p className="empty">No planned passes match the current search or filters.</p>
            ) : (
              filteredPasses.map((entry) => (
                <PlanPassCard
                  key={entry.pass.id}
                  entry={entry}
                  marginalNet={marginalByExternalKey.get(entry.pass.externalKey) ?? null}
                  onRemove={() => removePlannedPass(entry.pass.id)}
                />
              ))
            )}
          </section>
        </>
      ) : (
        <section className="panel plan-empty">
          <p className="empty">No passes on your plan yet. Search the catalog below or add from catalog rankings on the Potential page.</p>
        </section>
      )}

      <CatalogSearchPanel
        sectionId="plan-catalog-search"
        title="Add catalog passes to your plan"
        description={`Search the shared catalog and add passes at your chosen OTD tier (default ${RECOMMENDATION_SIMULATED_RARITY}). Passes stay here until you remove them or add them to your real collection.`}
        passKind="player"
        actionLabel="Add to plan"
        loadingKey={catalogLoadingKey}
        loadingLabel="Adding…"
        disabled={profilesLoading}
        collectionAdd={{
          defaultRarity,
          onDefaultRarityChange: setDefaultRarity,
          rarityOptions: PLAN_RARITY_OPTIONS,
          rarityForResult: (result) => rarityByKey[result.externalKey] ?? defaultRarity,
          onRarityForResultChange: (externalKey, rarity) =>
            setRarityByKey((current) => ({ ...current, [externalKey]: rarity })),
        }}
        planAdd={{
          plannedExternalKeys,
          onPlanLabel: 'On plan',
        }}
        onSelect={handleCatalogSelect}
      />
    </div>
  )
}
