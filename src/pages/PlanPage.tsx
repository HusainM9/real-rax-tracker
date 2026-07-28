import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { useRaxData } from '../context/RaxDataContext'
import type { CatalogImportProfile } from '../lib/catalogApi'
import { fetchCatalogImportProfilesBulk } from '../lib/catalogApi'
import { computeYearRollup } from '../lib/claimOptimizer'
import { displayRaxValue } from '../lib/displayRax'
import { isPlayerPass, isPlayerPassForSell } from '../lib/passKind'
import {
  analyzePlanCollection,
  applyPackEtaToPlannedPasses,
  normalizePlannedPassProgress,
  PLANNED_PASS_PROGRESS_OPTIONS,
  plannedPassFromOwnedCard,
  plannedPassProgressLabel,
  plannedPassProgressSortIndex,
  plannedPassProgressTone,
  withCollectionAssumedIconic1,
  type PlannedPassCardAnalysis,
} from '../lib/plannedPasses'
import {
  isAtLeastIconic1Rarity,
  RECOMMENDATION_SIMULATED_RARITY,
} from '../lib/passRecommendation'
import { isLegendaryPlusRarity } from '../lib/rarityFilter'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { formatSignedRax, withoutCards } from '../lib/removeCardAnalysis'
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
  const {
    data,
    addPlannedPass,
    addPlannedPassFromCatalog,
    removePlannedPass,
    updatePlannedPass,
    togglePlanSoldCard,
    clearPlanSoldCardIds,
  } = useRaxData()
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
  const [soldFilter, setSoldFilter] = useState('')
  /** Opt-in: Plan if-sold / composition assumes every owned player pass is Iconic 1. */
  const [assumeCollectionIconic1, setAssumeCollectionIconic1] = useState(false)

  const plannedPasses = data.plannedPasses ?? []
  const soldCardIds = data.planSoldCardIds ?? []
  const packTrackers = data.packTrackers ?? []
  const packEtaFingerprint = useMemo(
    () =>
      packTrackers
        .map((tracker) => {
          const accounts = tracker.accounts
            .map(
              (account) =>
                `${account.id}:${account.rating}:${account.opensPacks ? 1 : 0}:${account.ownershipStatus ?? ''}:${account.ignoredMissing ? 1 : 0}`,
            )
            .join(',')
          return `${tracker.plannedPassId}|${tracker.ratingPerPack ?? ''}|${accounts}`
        })
        .sort((a, b) => a.localeCompare(b))
        .join('\0'),
    [packTrackers],
  )

  // Backfill / refresh Plan tags from Packs days-until-Iconic (never writes Just started).
  useEffect(() => {
    const { plannedPasses: nextPasses, changed } = applyPackEtaToPlannedPasses(
      plannedPasses,
      packTrackers,
    )
    if (!changed) return
    for (const pass of nextPasses) {
      const current = plannedPasses.find((item) => item.id === pass.id)
      if (!current || current.progress === pass.progress) continue
      updatePlannedPass(pass.id, { progress: pass.progress })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when pack ETA inputs change
  }, [packEtaFingerprint])
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
        .map((pass) => pass.externalKey)
        .sort((a, b) => a.localeCompare(b))
        .join('\0'),
    [plannedPasses],
  )
  const soldCardIdsFingerprint = useMemo(
    () => [...soldCardIds].sort((a, b) => a.localeCompare(b)).join('\0'),
    [soldCardIds],
  )

  /** Plan if-sold / composition: planned buys always at Iconic 1; collection Iconic 1 is opt-in. */
  const planCompositionOptions = useMemo(
    () => ({
      forcePlannedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      assumeCollectionIconic1,
    }),
    [assumeCollectionIconic1],
  )

  const sellableCards = useMemo(
    () =>
      [...data.cards]
        .filter((card) => isPlayerPassForSell(card))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            a.sport.localeCompare(b.sport) ||
            a.season.localeCompare(b.season),
        ),
    [data.cards],
  )

  const soldCardIdSet = useMemo(() => new Set(soldCardIds), [soldCardIds])

  const filteredSellableCards = useMemo(() => {
    const query = soldFilter.trim().toLowerCase()
    if (!query) return sellableCards
    return sellableCards.filter((card) => {
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
  }, [sellableCards, soldFilter])

  const planBaselineData = useMemo(
    () => withoutCards(data, soldCardIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sold fingerprint + collection slices below
    [data.cards, data.performances, data.settings.proBonusEnabled, soldCardIdsFingerprint],
  )

  const unsoldClaimable = useMemo(() => {
    const collection = assumeCollectionIconic1 ? withCollectionAssumedIconic1(data) : data
    const analysisData = {
      ...collection,
      settings: { ...collection.settings, proBonusEnabled: true },
    }
    return computeYearRollup(analysisData).totalClaimableRax
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collection slices + toggle
  }, [data.cards, data.performances, data.settings.proBonusEnabled, assumeCollectionIconic1])

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
    () =>
      analyzePlanCollection(
        planBaselineData,
        plannedPasses,
        profilesByKey,
        planCompositionOptions,
      ),
    // Tag/progress-only edits keep the same fingerprints so scoring is skipped.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: omit progress-only plannedPasses / full data identity
    [
      planBaselineData,
      planScoringFingerprint,
      profilesByKey,
      planCompositionOptions,
    ],
  )

  // Same planned buys/upgrades, collection without planned sells — Plan-only contrast
  // ( /sell analyzeRemovedCard stays collection-only ).
  const unsoldPlanAnalysis = useMemo(() => {
    if (soldCardIds.length === 0) return null
    return analyzePlanCollection(
      data,
      plannedPasses,
      profilesByKey,
      planCompositionOptions,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collection + plan fingerprints
  }, [
    data.cards,
    data.performances,
    data.settings.proBonusEnabled,
    planScoringFingerprint,
    profilesByKey,
    planCompositionOptions,
    soldCardIdsFingerprint,
  ])

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

  const hasSoldScenario = soldCardIds.length > 0
  const planNetVsUnsold =
    unsoldPlanAnalysis != null
      ? analysis.combinedNetDelta - unsoldPlanAnalysis.combinedNetDelta
      : null
  // Absolute claimable change from planned sells in the with-plan world (buys applied).
  const soldImpactWithPlan =
    unsoldPlanAnalysis != null
      ? analysis.withPlanClaimable - unsoldPlanAnalysis.withPlanClaimable
      : null
  const soldOnlyNetDelta = analysis.currentClaimable - unsoldClaimable

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
          Save catalog passes you are considering. Packs ETA auto-tags Nearly finished / On the way /
          Future; Just started stays manual. Mark planned sells so Plan scoring treats those owned
          passes as sold with planned buys at {RECOMMENDATION_SIMULATED_RARITY} — simulation only;
          collection unchanged. The separate If sold page stays collection-only.
        </p>
        <div className="button-row">
          <Link className="button" to="/potential">
            Rank catalog
          </Link>
          <Link className="button" to="/sell">
            If sold
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
          hint={
            hasSoldScenario
              ? planNetVsUnsold != null && planNetVsUnsold !== 0
                ? `${formatSignedRax(displayRaxValue(planNetVsUnsold))} vs plan without sells · buys at ${RECOMMENDATION_SIMULATED_RARITY}${assumeCollectionIconic1 ? ' · collection at Iconic 1' : ''} · ${soldCardIds.length} sold in plan · ${analysis.activeProfiles.length} active of ${plannedPasses.length}`
                : `With ${soldCardIds.length} planned sell${soldCardIds.length === 1 ? '' : 's'} · buys at ${RECOMMENDATION_SIMULATED_RARITY}${assumeCollectionIconic1 ? ' · collection at Iconic 1' : ''} · ${analysis.activeProfiles.length} active of ${plannedPasses.length}`
              : `${formatSignedRax(displayRaxValue(analysis.combinedGuaranteedNetDelta))} guaranteed · buys at ${RECOMMENDATION_SIMULATED_RARITY} · ${analysis.activeProfiles.length} active of ${plannedPasses.length}`
          }
        />
        {hasSoldScenario ? (
          <>
            <StatCard
              label="Sold impact with plan"
              value={
                soldImpactWithPlan != null
                  ? formatSignedRax(displayRaxValue(soldImpactWithPlan))
                  : '—'
              }
              hint={
                soldImpactWithPlan != null && soldImpactWithPlan !== soldOnlyNetDelta
                  ? `${formatSignedRax(displayRaxValue(soldOnlyNetDelta))} sell-only (no planned buys) · vs same plan without sells`
                  : 'Claimable change from planned sells after planned buys · vs same plan without sells'
              }
            />
            <StatCard
              label="With plan after sells"
              value={displayRaxValue(analysis.withPlanClaimable).toLocaleString()}
              hint={
                unsoldPlanAnalysis != null
                  ? `${displayRaxValue(unsoldPlanAnalysis.withPlanClaimable).toLocaleString()} with plan, no sells · ${formatSignedRax(displayRaxValue(analysis.withPlanClaimable - unsoldClaimable))} vs current collection`
                  : `${formatSignedRax(displayRaxValue(analysis.withPlanClaimable - unsoldClaimable))} vs current collection`
              }
            />
          </>
        ) : null}
      </section>

      {sellableCards.length > 0 ? (
        <CollapsiblePanel
          className="nested-panel"
          title="Plan to sell"
          description={`Mark owned player passes as planned sells. Plan nets strip them first, then apply planned buys at ${RECOMMENDATION_SIMULATED_RARITY}. Optionally assume your whole collection is Iconic 1 for that simulation. Does not change /sell or your collection.`}
          badge={
            soldCardIds.length > 0
              ? `${soldCardIds.length} sold in plan`
              : undefined
          }
          defaultOpen={soldCardIds.length > 0}
        >
          <div className="sort-controls">
            <label className="field inline-field recommendation-adjustment-owned-search">
              <span>Filter collection</span>
              <input
                value={soldFilter}
                placeholder="Name, sport, season, or rarity"
                onChange={(event) => setSoldFilter(event.target.value)}
              />
            </label>
            <button
              className={`button${assumeCollectionIconic1 ? ' is-selected' : ''}`}
              type="button"
              aria-pressed={assumeCollectionIconic1}
              title="Simulation only: treat every owned player pass as Iconic 1 for Plan if-sold / plan nets"
              onClick={() => setAssumeCollectionIconic1((current) => !current)}
            >
              Assume collection Iconic 1
            </button>
            <button
              className="button"
              type="button"
              disabled={soldCardIds.length === 0}
              onClick={clearPlanSoldCardIds}
            >
              Clear planned sells
            </button>
          </div>
          {filteredSellableCards.length > 0 ? (
            <div className="recommendation-adjustment-owned-list button-row wrap-row">
              {filteredSellableCards.map((card) => {
                const selected = soldCardIdSet.has(card.id)
                return (
                  <button
                    className={`button compact${selected ? ' is-selected' : ''}`}
                    type="button"
                    key={card.id}
                    aria-pressed={selected}
                    title={
                      selected
                        ? 'Remove planned sell (keep in Plan baseline)'
                        : 'Plan to sell — treat as sold for all Plan scoring'
                    }
                    onClick={() => togglePlanSoldCard(card.id)}
                  >
                    {card.name}
                    {card.season ? ` · ${card.season}` : ''}
                    {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                    {selected ? ' · sold' : ''}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="empty">No collection passes match that filter.</p>
          )}
        </CollapsiblePanel>
      ) : null}

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
