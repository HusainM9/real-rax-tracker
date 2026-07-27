import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { useRaxData } from '../context/RaxDataContext'
import type { CatalogImportProfile } from '../lib/catalogApi'
import { fetchCatalogImportProfilesBulk } from '../lib/catalogApi'
import { displayRaxValue } from '../lib/displayRax'
import { formatRax } from '../lib/format'
import { isPlayerPass } from '../lib/passKind'
import {
  analyzePlanCollection,
  plannedPassFromOwnedCard,
  plannedPassSimulatedTotalRax,
  type PlannedPassCardAnalysis,
} from '../lib/plannedPasses'
import {
  isAtLeastIconic1Rarity,
  RECOMMENDATION_SIMULATED_RARITY,
} from '../lib/passRecommendation'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { formatSignedRax } from '../lib/removeCardAnalysis'
import type { PlayerCard } from '../types/rax'

const PLAN_RARITY_OPTIONS = RARITY_PREVIEW_OPTIONS.filter((option) => option.length > 0)

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
  const { pass, solo, ownedAtIconic, ownedBelowIconic, missingProfile, missingRows } = entry
  const simulatedTotal = plannedPassSimulatedTotalRax(pass, entry.profile)

  return (
    <article className="plan-pass-card panel">
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

      {ownedAtIconic ? (
        <p className="import-hint plan-pass-status owned">Already in your collection at Iconic 1+</p>
      ) : missingProfile ? (
        <p className="import-hint plan-pass-status warning">Catalog profile not loaded yet</p>
      ) : missingRows ? (
        <p className="import-hint plan-pass-status warning">No catalog earnings rows for this pass</p>
      ) : solo ? (
        <div className="plan-pass-metrics">
          <div className="plan-pass-metric highlight">
            <span>Solo net gain</span>
            <strong className={signedRaxClass(solo.netClaimableDelta)}>
              {formatSignedRax(displayRaxValue(solo.netClaimableDelta))}
            </strong>
            <small>
              {formatSignedRax(displayRaxValue(solo.netGuaranteedDelta))} guaranteed
            </small>
          </div>
          {marginalNet != null ? (
            <div className="plan-pass-metric">
              <span>In full plan</span>
              <strong className={signedRaxClass(marginalNet)}>
                {formatSignedRax(displayRaxValue(marginalNet))}
              </strong>
              <small>marginal after overlap</small>
            </div>
          ) : null}
          <div className="plan-pass-metric">
            <span>Claimable</span>
            <strong>{formatRax(displayRaxValue(solo.newClaimableRax))}</strong>
          </div>
          <div className="plan-pass-metric">
            <span>Displaced</span>
            <strong>
              {solo.displacedRax > 0
                ? `−${formatRax(displayRaxValue(solo.displacedRax))}`
                : '—'}
            </strong>
          </div>
          <div className="plan-pass-metric">
            <span>Overlap</span>
            <strong>
              {solo.overlapRax > 0 ? formatRax(displayRaxValue(solo.overlapRax)) : '—'}
            </strong>
          </div>
          <div className="plan-pass-metric">
            <span>Base RAX</span>
            <strong>{formatRax(displayRaxValue(pass.totalBaseRax))}</strong>
            <small>{pass.rowCount} row{pass.rowCount === 1 ? '' : 's'}</small>
          </div>
          <div className="plan-pass-metric">
            <span>{pass.simulatedRarityLabel} total</span>
            <strong>{formatRax(displayRaxValue(simulatedTotal))}</strong>
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
  const { data, addPlannedPass, addPlannedPassFromCatalog, removePlannedPass } = useRaxData()
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

  const plannedPasses = data.plannedPasses ?? []
  const plannedExternalKeys = useMemo(
    () => new Set(plannedPasses.map((pass) => pass.externalKey)),
    [plannedPasses],
  )

  const ownedAdjustableCards = useMemo(
    () =>
      [...data.cards]
        .filter(
          (card) => isPlayerPass(card) && !isAtLeastIconic1Rarity(card.rarityLabel),
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
          <Link className="button" to="/entry">
            Add to collection
          </Link>
        </div>
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
          hint={`${formatSignedRax(displayRaxValue(analysis.combinedGuaranteedNetDelta))} guaranteed · ${plannedPasses.length} pass${plannedPasses.length === 1 ? '' : 'es'}`}
        />
        <StatCard
          label="Active in plan"
          value={String(analysis.activeProfiles.length)}
          hint={`${plannedPasses.length - analysis.activeProfiles.length} skipped (owned or missing rows)`}
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
              description="Same-sport overlap counted in plan order (best solo net first within each sport). Each pass uses its planned rarity."
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

          <section className="plan-pass-grid">
            {analysis.passes.map((entry) => (
              <PlanPassCard
                key={entry.pass.id}
                entry={entry}
                marginalNet={marginalByExternalKey.get(entry.pass.externalKey) ?? null}
                onRemove={() => removePlannedPass(entry.pass.id)}
              />
            ))}
          </section>
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
