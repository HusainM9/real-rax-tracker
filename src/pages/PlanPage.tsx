import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { useRaxData } from '../context/RaxDataContext'
import type { CatalogImportProfile } from '../lib/catalogApi'
import { fetchCatalogImportProfilesBulk } from '../lib/catalogApi'
import { displayRaxValue } from '../lib/displayRax'
import { isPlayerPass } from '../lib/passKind'
import {
  analyzePlanCollection,
  normalizePlannedPassProgress,
  PLANNED_PASS_PROGRESS_OPTIONS,
  plannedPassFromOwnedCard,
  plannedPassProgressLabel,
  plannedPassProgressSortIndex,
  plannedPassProgressTone,
  type PlannedPassCardAnalysis,
} from '../lib/plannedPasses'
import {
  isAtLeastIconic1Rarity,
  RECOMMENDATION_SIMULATED_RARITY,
} from '../lib/passRecommendation'
import { isLegendaryPlusRarity } from '../lib/rarityFilter'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { formatSignedRax } from '../lib/removeCardAnalysis'
import type { PlannedPassProgress, PlayerCard } from '../types/rax'

const PLAN_RARITY_OPTIONS = RARITY_PREVIEW_OPTIONS.filter((option) => option.length > 0)

type PlanPassSortMode = 'progress' | 'recent'

function signedRaxClass(value: number): string {
  if (value > 0) return 'sale-positive'
  if (value < 0) return 'sale-negative'
  return ''
}

function sourceBadgeLabel(source: PlannedPassCardAnalysis['pass']['source']): string {
  if (source === 'ranking') return 'From ranking'
  if (source === 'manual') return 'From collection'
  return 'Catalog'
}

function PlanTagPill({
  progress,
  selected = false,
  onClick,
}: {
  progress: PlannedPassProgress
  selected?: boolean
  onClick?: () => void
}) {
  const tone = plannedPassProgressTone(progress)
  const label = plannedPassProgressLabel(progress)
  const className = `plan-tag plan-tag--${tone}${selected ? ' is-selected' : ''}`

  if (onClick) {
    return (
      <button className={className} type="button" aria-pressed={selected} onClick={onClick}>
        {label}
      </button>
    )
  }

  return <span className={className}>{label}</span>
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
  planNetGain,
  onProgressChange,
  onRemove,
}: {
  entry: PlannedPassCardAnalysis
  planNetGain: number | null
  onProgressChange: (progress: PlannedPassProgress) => void
  onRemove: () => void
}) {
  const { pass, ownedAtIconic, ownedBelowIconic, missingProfile, missingRows } = entry
  const net = planNetGain
  const progress = normalizePlannedPassProgress(pass.progress)

  return (
    <article className={`plan-pass-card panel plan-pass-card--${plannedPassProgressTone(progress)}`}>
      <div className="plan-pass-card-header">
        <div>
          <h3>{pass.name}</h3>
          <p className="plan-pass-meta">
            {pass.passKind === 'team' ? 'Team' : 'Player'} · {pass.sport} · {pass.season} ·{' '}
            {pass.simulatedRarityLabel}
            {ownedBelowIconic ? ' · upgrade' : ''}
          </p>
        </div>
        <button className="button danger compact" type="button" onClick={onRemove}>
          Remove
        </button>
      </div>

      <div className="plan-pass-tag-row" role="group" aria-label="Plan section tag">
        {PLANNED_PASS_PROGRESS_OPTIONS.map((option) => (
          <PlanTagPill
            key={option.value}
            progress={option.value}
            selected={progress === option.value}
            onClick={() => onProgressChange(option.value)}
          />
        ))}
      </div>

      {ownedAtIconic ? (
        <p className="import-hint plan-pass-status owned">Already in your collection at Iconic 1+</p>
      ) : missingProfile ? (
        <p className="import-hint plan-pass-status warning">Catalog profile not loaded yet</p>
      ) : missingRows ? (
        <p className="import-hint plan-pass-status warning">No catalog earnings rows for this pass</p>
      ) : net != null ? (
        <div className="plan-pass-metrics">
          <div className="plan-pass-metric highlight">
            <span>Plan net gain</span>
            <strong className={signedRaxClass(net)}>
              {formatSignedRax(displayRaxValue(net))}
            </strong>
            <small>contribution vs rest of plan</small>
          </div>
        </div>
      ) : (
        <p className="import-hint plan-pass-status warning">Could not analyze this pass</p>
      )}

      <div className="plan-pass-footer">
        <span className="badge">{sourceBadgeLabel(pass.source)}</span>
        <Link className="link-button" to="/potential">
          Analyze in Potential
        </Link>
      </div>
    </article>
  )
}

export default function PlanPage() {
  const { data, addPlannedPass, addPlannedPassFromCatalog, removePlannedPass, updatePlannedPass } =
    useRaxData()
  const [profilesByKey, setProfilesByKey] = useState<Map<string, CatalogImportProfile>>(new Map())
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [profilesStatus, setProfilesStatus] = useState('')
  const [catalogLoadingKey, setCatalogLoadingKey] = useState('')
  const [catalogStatus, setCatalogStatus] = useState('')
  const [defaultRarity, setDefaultRarity] = useState(RECOMMENDATION_SIMULATED_RARITY)
  const [rarityByKey, setRarityByKey] = useState<Record<string, string>>({})
  const [ownedQuickAddFilter, setOwnedQuickAddFilter] = useState('')
  const [ownedAddStatus, setOwnedAddStatus] = useState('')
  const [ownedAddRarity, setOwnedAddRarity] = useState(RECOMMENDATION_SIMULATED_RARITY)
  const [passSortMode, setPassSortMode] = useState<PlanPassSortMode>('progress')

  const plannedPasses = data.plannedPasses ?? []
  const plannedExternalKeys = useMemo(
    () => new Set(plannedPasses.map((pass) => pass.externalKey)),
    [plannedPasses],
  )
  const plannedExternalKeysFingerprint = useMemo(
    () =>
      [...plannedExternalKeys].sort((a, b) => a.localeCompare(b)).join('\0'),
    [plannedExternalKeys],
  )
  const planScoringFingerprint = useMemo(
    () =>
      plannedPasses
        .map((pass) => `${pass.externalKey}\t${pass.simulatedRarityLabel}`)
        .sort((a, b) => a.localeCompare(b))
        .join('\0'),
    [plannedPasses],
  )

  const ownedAdjustableCards = useMemo(
    () =>
      [...data.cards]
        .filter(
          (card) =>
            isPlayerPass(card) &&
            isLegendaryPlusRarity(card.rarityLabel) &&
            !isAtLeastIconic1Rarity(card.rarityLabel),
        )
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            a.sport.localeCompare(b.sport) ||
            a.season.localeCompare(b.season),
        ),
    [data.cards],
  )

  const filteredOwnedQuickAddCards = useMemo(() => {
    const query = ownedQuickAddFilter.trim().toLowerCase()
    if (!query) return ownedAdjustableCards
    return ownedAdjustableCards.filter((card) => {
      const haystack = [
        card.name,
        card.sport,
        card.season,
        card.rarityLabel ?? '',
        card.externalKey ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [ownedAdjustableCards, ownedQuickAddFilter])

  const addableFilteredOwnedCards = useMemo(
    () =>
      filteredOwnedQuickAddCards.filter(
        (card): card is PlayerCard & { externalKey: string } =>
          Boolean(card.externalKey) && !plannedExternalKeys.has(card.externalKey!),
      ),
    [filteredOwnedQuickAddCards, plannedExternalKeys],
  )

  useEffect(() => {
    const keys = plannedExternalKeysFingerprint
      ? plannedExternalKeysFingerprint.split('\0')
      : []
    if (keys.length === 0) {
      setProfilesByKey(new Map())
      setProfilesStatus('')
      setProfilesLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setProfilesLoading(true)
    setProfilesStatus('Loading catalog earnings for planned passes…')

    fetchCatalogImportProfilesBulk(keys, controller.signal)
      .then(({ profiles, storageConfigured }) => {
        if (cancelled) return
        if (!storageConfigured) {
          setProfilesStatus('Shared catalog is not configured yet.')
          setProfilesByKey(new Map())
          return
        }
        setProfilesByKey((current) => {
          const next = new Map(profiles.map((profile) => [profile.externalKey, profile]))
          if (
            current.size === next.size &&
            [...next.keys()].every(
              (key) => current.get(key) === next.get(key),
            )
          ) {
            return current
          }
          return next
        })
        setProfilesStatus('')
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return
        setProfilesStatus(error instanceof Error ? error.message : 'Could not load planned passes.')
      })
      .finally(() => {
        if (!cancelled) setProfilesLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [plannedExternalKeysFingerprint])

  const scoredAnalysis = useMemo(
    () => analyzePlanCollection(data, plannedPasses, profilesByKey),
    // Tag/progress-only edits keep the same fingerprints so scoring is skipped.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: omit progress-only plannedPasses / full data identity
    [
      data.cards,
      data.performances,
      data.settings.proBonusEnabled,
      planScoringFingerprint,
      profilesByKey,
    ],
  )

  const analysis = useMemo(() => {
    const byId = new Map(plannedPasses.map((pass) => [pass.id, pass]))
    return {
      ...scoredAnalysis,
      passes: scoredAnalysis.passes.map((entry) => ({
        ...entry,
        pass: byId.get(entry.pass.id) ?? entry.pass,
      })),
    }
  }, [scoredAnalysis, plannedPasses])

  const sortedPlanPasses = useMemo(() => {
    const entries = [...analysis.passes]
    if (passSortMode === 'recent') {
      return entries.sort(
        (a, b) =>
          Date.parse(b.pass.addedAt) - Date.parse(a.pass.addedAt) ||
          a.pass.name.localeCompare(b.pass.name),
      )
    }
    return entries.sort(
      (a, b) =>
        plannedPassProgressSortIndex(normalizePlannedPassProgress(a.pass.progress)) -
          plannedPassProgressSortIndex(normalizePlannedPassProgress(b.pass.progress)) ||
        a.pass.name.localeCompare(b.pass.name),
    )
  }, [analysis.passes, passSortMode])

  const planPassSections = useMemo(() => {
    if (passSortMode !== 'progress') return null
    return PLANNED_PASS_PROGRESS_OPTIONS.map((option) => ({
      ...option,
      entries: sortedPlanPasses.filter(
        (entry) => normalizePlannedPassProgress(entry.pass.progress) === option.value,
      ),
    }))
  }, [passSortMode, sortedPlanPasses])

  const marginalByExternalKey = useMemo(() => {
    const map = new Map<string, number>()
    if (!analysis.bundle) return map
    for (const row of analysis.bundle.rows) {
      const externalKey = row.key.startsWith('catalog:')
        ? row.key.slice('catalog:'.length)
        : row.key.startsWith('owned:')
          ? row.key.slice('owned:'.length)
          : row.key
      map.set(externalKey, row.marginalNetDelta)
    }
    return map
  }, [analysis.bundle])

  const ownedCardEarnings = (card: PlayerCard) => {
    const performances = data.performances.filter((row) => row.cardId === card.id)
    return {
      totalBaseRax: performances.reduce(
        (sum, row) => sum + (row.baseRaxEarned ?? row.raxEarned),
        0,
      ),
      rowCount: performances.length,
    }
  }

  const addOwnedCardToPlan = (card: PlayerCard) => {
    const earnings = ownedCardEarnings(card)
    const input = plannedPassFromOwnedCard(card, {
      simulatedRarityLabel: ownedAddRarity,
      ...earnings,
    })
    if (!input) {
      setOwnedAddStatus('That card has no catalog link.')
      return
    }
    const id = addPlannedPass(input)
    if (!id) {
      setOwnedAddStatus(`${card.name} is already on your plan.`)
      return
    }
    setOwnedAddStatus(
      `Added ${card.name} to your plan as ${ownedAddRarity || RECOMMENDATION_SIMULATED_RARITY}.`,
    )
  }

  const addAllFilteredOwnedToPlan = () => {
    if (addableFilteredOwnedCards.length === 0) {
      setOwnedAddStatus(
        'No eligible passes to add — they may already be on the plan, lack a catalog link, or not match the filter.',
      )
      return
    }

    let added = 0
    for (const card of addableFilteredOwnedCards) {
      const earnings = ownedCardEarnings(card)
      const input = plannedPassFromOwnedCard(card, {
        simulatedRarityLabel: ownedAddRarity,
        ...earnings,
      })
      if (!input) continue
      addPlannedPass(input)
      added += 1
    }

    const skipped = filteredOwnedQuickAddCards.length - added
    setOwnedAddStatus(
      `Added ${added} pass${added === 1 ? '' : 'es'} to your plan as ${ownedAddRarity || RECOMMENDATION_SIMULATED_RARITY}.${
        skipped > 0 ? ` Skipped ${skipped} without catalog link or already listed.` : ''
      }`,
    )
  }

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
        <p>Save catalog passes you are considering. Analysis updates with your collection or plan.</p>
        <div className="button-row">
          <Link className="button" to="/potential">
            Rank catalog
          </Link>
          {plannedPasses.length > 0 ? (
            <Link className="button" to="/potential?addPlanToBaseline=1">
              Add all to ranking baseline
            </Link>
          ) : null}
          <Link className="button" to="/entry">
            Add to collection
          </Link>
        </div>
      </section>

      <section className="stats-grid plan-summary-grid">
        <StatCard
          label="Plan net gain"
          value={formatSignedRax(displayRaxValue(analysis.combinedNetDelta))}
          hint={`${formatSignedRax(displayRaxValue(analysis.combinedGuaranteedNetDelta))} guaranteed · ${analysis.activeProfiles.length} active of ${plannedPasses.length}`}
        />
      </section>

      {profilesLoading ? <p className="import-progress">{profilesStatus || 'Loading plan…'}</p> : null}
      {profilesStatus && !profilesLoading ? <p className="import-status">{profilesStatus}</p> : null}
      {catalogStatus ? <p className="import-status">{catalogStatus}</p> : null}
      {ownedAddStatus ? <p className="import-status">{ownedAddStatus}</p> : null}

      {ownedAdjustableCards.length > 0 ? (
        <CollapsiblePanel
          className="nested-panel"
          title="From your collection"
          description={`Auto-add non-Iconic player passes as ${ownedAddRarity || RECOMMENDATION_SIMULATED_RARITY} upgrades — same idea as baseline adjustments.`}
          badge={`${ownedAdjustableCards.length} eligible`}
          defaultOpen={false}
        >
          <div className="sort-controls">
            <label className="field inline-field">
              <span>Assume rarity</span>
              <select
                value={ownedAddRarity}
                onChange={(event) => setOwnedAddRarity(event.target.value)}
              >
                {PLAN_RARITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline-field recommendation-adjustment-owned-search">
              <span>Filter your collection</span>
              <input
                value={ownedQuickAddFilter}
                placeholder="Name, sport, season, or rarity"
                onChange={(event) => setOwnedQuickAddFilter(event.target.value)}
              />
            </label>
            <button
              className="button"
              type="button"
              disabled={addableFilteredOwnedCards.length === 0}
              onClick={addAllFilteredOwnedToPlan}
            >
              Add all
              {addableFilteredOwnedCards.length > 0
                ? ` (${addableFilteredOwnedCards.length})`
                : ''}
            </button>
          </div>
          {filteredOwnedQuickAddCards.length > 0 ? (
            <div className="recommendation-adjustment-owned-list button-row wrap-row">
              {filteredOwnedQuickAddCards.map((card) => {
                const alreadyAdded = Boolean(
                  card.externalKey && plannedExternalKeys.has(card.externalKey),
                )
                const missingCatalogLink = !card.externalKey
                return (
                  <button
                    className="button compact"
                    type="button"
                    key={card.id}
                    disabled={missingCatalogLink || alreadyAdded}
                    title={
                      missingCatalogLink
                        ? 'No catalog link on this card'
                        : alreadyAdded
                          ? 'Already on your plan'
                          : `Add as ${ownedAddRarity || RECOMMENDATION_SIMULATED_RARITY}`
                    }
                    onClick={() => addOwnedCardToPlan(card)}
                  >
                    {card.name}
                    {card.season ? ` · ${card.season}` : ''}
                    {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                    {alreadyAdded ? ' · on plan' : ''}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="empty">No collection passes match that filter.</p>
          )}
        </CollapsiblePanel>
      ) : null}

      {plannedPasses.length > 0 ? (
        <>
          {analysis.bundle && analysis.bundle.rows.length > 1 ? (
            <CollapsiblePanel
              className="nested-panel"
              title="Combined plan order"
              description="Each pass’s plan net is what it adds on top of the rest of the plan (leave-one-out), after collection overlap."
              defaultOpen={false}
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Pass</th>
                      <th>Plan net gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...analysis.bundle.rows]
                      .sort(
                        (a, b) =>
                          b.marginalNetDelta - a.marginalNetDelta ||
                          a.name.localeCompare(b.name),
                      )
                      .map((row, index) => (
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
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CollapsiblePanel>
          ) : null}

          <div className="sort-controls plan-pass-sort-controls">
            <label className="field inline-field">
              <span>Sort passes</span>
              <select
                value={passSortMode}
                onChange={(event) => setPassSortMode(event.target.value as PlanPassSortMode)}
              >
                <option value="progress">By section tags</option>
                <option value="recent">Recently added</option>
              </select>
            </label>
          </div>

          {passSortMode === 'progress' && planPassSections ? (
            <div className="plan-pass-sections">
              {planPassSections.map((section) => (
                <CollapsiblePanel
                  key={section.value}
                  className={`nested-panel plan-tag-section plan-tag-section--${section.tone}`}
                  title={section.label}
                  description={section.description}
                  badge={`${section.entries.length}`}
                  defaultOpen={section.value !== 'future'}
                  actions={<PlanTagPill progress={section.value} />}
                >
                  {section.entries.length > 0 ? (
                    <div className="plan-pass-grid">
                      {section.entries.map((entry) => (
                        <PlanPassCard
                          key={entry.pass.id}
                          entry={entry}
                          planNetGain={
                            marginalByExternalKey.get(entry.pass.externalKey) ?? null
                          }
                          onProgressChange={(progress) =>
                            updatePlannedPass(entry.pass.id, { progress })
                          }
                          onRemove={() => removePlannedPass(entry.pass.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="empty plan-tag-section-empty">
                      No passes tagged {section.label.toLowerCase()} yet. Use the color tags on a
                      pass to move it here.
                    </p>
                  )}
                </CollapsiblePanel>
              ))}
            </div>
          ) : (
            <section className="plan-pass-grid">
              {sortedPlanPasses.map((entry) => (
                <PlanPassCard
                  key={entry.pass.id}
                  entry={entry}
                  planNetGain={marginalByExternalKey.get(entry.pass.externalKey) ?? null}
                  onProgressChange={(progress) =>
                    updatePlannedPass(entry.pass.id, { progress })
                  }
                  onRemove={() => removePlannedPass(entry.pass.id)}
                />
              ))}
            </section>
          )}
        </>
      ) : (
        <section className="panel plan-empty">
          <p className="empty">No passes yet. Search below, add from your collection, or use Rank catalog on Potential.</p>
        </section>
      )}

      <CatalogSearchPanel
        sectionId="plan-catalog-search"
        title="Add catalog passes to your plan"
        description={`Add at your OTD tier (default ${RECOMMENDATION_SIMULATED_RARITY}). Stays until you remove it or add to your collection.`}
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
