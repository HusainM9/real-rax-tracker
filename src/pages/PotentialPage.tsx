import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
import { SeasonMultiSelect } from '../components/SeasonMultiSelect'
import { displayRaxValue } from '../lib/displayRax'
import {
  fetchCatalogImportProfile,
  fetchCatalogImportProfilesBulk,
  fetchCatalogPassSummaries,
  fetchCatalogSeasonYears,
  type CatalogImportProfile,
  type CatalogSearchResult,
  type CatalogSeasonYearOption,
} from '../lib/catalogApi'
import { sportFromCatalog } from '../lib/catalogImport'
import { catalogProfileToJson } from '../lib/catalogProfileJson'
import { formatClaimDay, formatRax } from '../lib/format'
import { analyzePotentialCard, type PotentialAnalysisResult } from '../lib/potentialAnalysis'
import {
  rankAndRecommendAsync,
  RECOMMENDATION_MAX_BUNDLE_SIZE,
  RECOMMENDATION_SIMULATED_RARITY,
  recommendationCapsForSport,
  recommendationCapsForSports,
  selectSummariesForBulkFetch,
  type PassRecommendationBundle,
  seasonLabelForFilter,
  type PassRecommendationProgress,
  type PassRecommendationRow,
} from '../lib/passRecommendation'
import { realappToolsShutdownLabel } from '../lib/importShutdown'
import { formatSignedRax } from '../lib/removeCardAnalysis'
import { parseRealAppToolsRows, type ParsedRealAppToolsRow } from '../lib/realAppToolsImport'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { useRaxData } from '../context/RaxDataContext'
import { SPORTS, type Sport } from '../types/rax'

const TOP_RECOMMENDATIONS = 20
const DEFAULT_BUNDLE_SIZE = 3
const ALL_SPORTS_RANK = 'ALL' as const

type RankSportChoice = Sport | typeof ALL_SPORTS_RANK

const EMPTY_FORM = {
  name: '',
  sport: 'FC' as Sport,
  season: '',
  notes: '',
  rawJson: '',
  previewAs: '',
}

function CollapsibleAnalysisSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="overlap-section">
      <button
        type="button"
        className="overlap-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="overlap-toggle-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>{label}</span>
      </button>
      {open ? <div className="overlap-list">{children}</div> : null}
    </div>
  )
}

function PotentialAnalysisResults({
  analysis,
  previewAs,
}: {
  analysis: PotentialAnalysisResult
  previewAs: string
}) {
  const netCollectionDelta = analysis.claimableRax - analysis.displacedRax
  const displacedCardCount = analysis.displacedByCard.length

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Analysis result</h2>
          <p className="import-hint">
            How this pass would affect your collection&apos;s claimable RAX (top 2 per sport + Pro
            bonus rules).
            {previewAs ? (
              <>
                {' '}
                OTD preview: <strong>{previewAs}</strong>.
              </>
            ) : null}
          </p>
        </div>
        <span className="badge">{formatSignedRax(displayRaxValue(netCollectionDelta))} net</span>
      </div>

      <div className="stats-grid potential-summary-grid">
        <article className="stat-card panel">
          <span>New card — claimable</span>
          <strong>{formatRax(displayRaxValue(analysis.claimableRax))}</strong>
          <small className="table-sub">Would count in your collection</small>
        </article>
        <article className="stat-card panel">
          <span>New card — overlap only</span>
          <strong>{formatRax(displayRaxValue(analysis.overlapRax))}</strong>
          <small className="table-sub">Would not count if added</small>
        </article>
        <article className="stat-card panel">
          <span>Existing cards lost</span>
          <strong className="sale-negative">
            −{formatRax(displayRaxValue(analysis.displacedRax))}
          </strong>
          <small className="table-sub">
            {displacedCardCount} card{displacedCardCount === 1 ? '' : 's'} pushed to overlap
          </small>
        </article>
        <article className="stat-card panel">
          <span>Net collection change</span>
          <strong
            className={
              netCollectionDelta > 0
                ? 'sale-positive'
                : netCollectionDelta < 0
                  ? 'sale-negative'
                  : ''
            }
          >
            {formatSignedRax(displayRaxValue(netCollectionDelta))}
          </strong>
          <small className="table-sub">Claimable added − displaced</small>
        </article>
      </div>

      <CollapsibleAnalysisSection
        defaultOpen
        label={
          displacedCardCount === 0
            ? 'Most displaced existing cards (none)'
            : `Most displaced existing cards (${displacedCardCount}) · −${formatRax(displayRaxValue(analysis.displacedRax))} RAX lost`
        }
      >
        {displacedCardCount === 0 ? (
          <p className="empty overlap-empty">No currently claimable cards would be pushed to overlap.</p>
        ) : (
          <>
            <p className="import-hint">Ranked by total claimable RAX lost across OTD days.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Card</th>
                    <th>Sport</th>
                    <th>Days displaced</th>
                    <th>RAX lost</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.displacedByCard.map((row, index) => (
                    <tr key={row.cardId}>
                      <td>{index + 1}</td>
                      <td>
                        {row.name}
                        {row.season ? (
                          <>
                            <br />
                            <small className="table-sub">{row.season}</small>
                          </>
                        ) : null}
                      </td>
                      <td>{row.sport}</td>
                      <td>{row.daysDisplaced}</td>
                      <td>
                        <strong className="sale-negative">
                          −{formatRax(displayRaxValue(row.raxLost))}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      <strong>Total</strong>
                    </td>
                    <td>
                      {analysis.displacedByCard.reduce((sum, row) => sum + row.daysDisplaced, 0)}
                    </td>
                    <td>
                      <strong className="sale-negative">
                        −{formatRax(displayRaxValue(analysis.displacedRax))}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </CollapsibleAnalysisSection>

      {analysis.monthlyNet.length > 0 ? (
        <CollapsibleAnalysisSection
          defaultOpen
          label={`Net claimable by month (${analysis.monthlyNet.length}) · ${formatSignedRax(displayRaxValue(netCollectionDelta))} total`}
        >
          <p className="import-hint">
            Per calendar month: claimable from the new card minus existing cards pushed to overlap.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Net change</th>
                  <th>New card adds</th>
                  <th>Displaced</th>
                </tr>
              </thead>
              <tbody>
                {analysis.monthlyNet.map((row) => (
                  <tr key={row.monthIdx}>
                    <td>{row.month}</td>
                    <td>
                      <strong
                        className={
                          row.netDelta > 0
                            ? 'sale-positive'
                            : row.netDelta < 0
                              ? 'sale-negative'
                              : ''
                        }
                      >
                        {formatSignedRax(displayRaxValue(row.netDelta))} RAX
                      </strong>
                    </td>
                    <td>
                      {row.potentialGain > 0
                        ? `+${formatRax(displayRaxValue(row.potentialGain))}`
                        : '—'}
                    </td>
                    <td>
                      {row.displacedLoss > 0
                        ? `−${formatRax(displayRaxValue(row.displacedLoss))}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleAnalysisSection>
      ) : null}

      <section className="content-grid">
        <div>
          <CollapsibleAnalysisSection
            label={`Potential card days (${analysis.candidates.length}) · ${formatRax(displayRaxValue(analysis.claimableRax))} claimable · ${formatRax(displayRaxValue(analysis.overlapRax))} overlap`}
          >
            <div className="list">
              {analysis.candidates.map(({ day, candidate }) => (
                <div
                  className={`list-row claim-row ${candidate.status}`}
                  key={candidate.performance.id}
                >
                  <span>
                    <strong>{formatClaimDay(day.claimDay)}</strong>
                    <small>
                      {candidate.status === 'overlap'
                        ? 'Would be overlapped'
                        : candidate.status === 'pro-bonus'
                          ? 'Would use Pro bonus'
                          : `Would be top-${candidate.rankInSport} in ${candidate.card.sport}`}
                    </small>
                  </span>
                  <b>{formatRax(candidate.performance.raxEarned)} RAX</b>
                </div>
              ))}
            </div>
          </CollapsibleAnalysisSection>
        </div>

        <div>
          <CollapsibleAnalysisSection
            label={
              analysis.displacedExisting.length === 0
                ? 'Existing cards displaced (0)'
                : `Existing cards displaced (${analysis.displacedExisting.length}) · ${formatRax(displayRaxValue(analysis.displacedRax))} RAX lost`
            }
          >
            {analysis.displacedExisting.length === 0 ? (
              <p className="empty overlap-empty">No currently claimable cards would be pushed out.</p>
            ) : (
              <div className="list">
                {analysis.displacedExisting.map(({ day, candidate, previousStatus }) => (
                  <Link
                    className="list-row claim-row overlap"
                    to={`/calendar?monthDay=${day.claimDay}`}
                    key={`${day.claimDay}-${candidate.performance.id}`}
                  >
                    <span>
                      <strong>{candidate.card.name}</strong>
                      <small>
                        {formatClaimDay(day.claimDay)} · was{' '}
                        {previousStatus === 'pro-bonus' ? 'Pro bonus' : 'guaranteed'} · now overlap
                      </small>
                    </span>
                    <b>{formatRax(candidate.performance.raxEarned)} RAX lost</b>
                  </Link>
                ))}
              </div>
            )}
          </CollapsibleAnalysisSection>
        </div>
      </section>
    </section>
  )
}

function applyCatalogProfileToForm(
  profile: CatalogImportProfile,
  setters: {
    setEditingId: (id: string | null) => void
    setPotentialRows: (rows: ParsedRealAppToolsRow[]) => void
    setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>
    setStatus: (status: string) => void
  },
): boolean {
  if (profile.rows.length === 0) {
    setters.setEditingId(null)
    setters.setPotentialRows([])
    setters.setForm({
      name: profile.name,
      sport: sportFromCatalog(profile.sport),
      season: profile.seasonLabel || String(profile.seasonYear),
      notes: 'Loaded from shared catalog (no earnings rows)',
      rawJson: '',
      previewAs: profile.rarityLabel ?? '',
    })
    setters.setStatus(
      `${profile.name} is in the catalog but has no daily RAX rows yet — paste earnings manually below.`,
    )
    return false
  }

  const sport = sportFromCatalog(profile.sport)
  const rawJson = catalogProfileToJson(profile)
  const parsed = parseRealAppToolsRows(rawJson, {
    sport,
    rarityLabel: profile.rarityLabel,
    applyOtdMultiplier: Boolean(profile.rarityLabel),
    passKind: profile.passKind,
  })
  setters.setEditingId(null)
  setters.setPotentialRows(parsed.rows)
  setters.setForm({
    name: profile.name,
    sport,
    season: profile.seasonLabel || String(profile.seasonYear),
    notes: 'Loaded from shared Meowbot catalog',
    rawJson,
    previewAs: profile.rarityLabel ?? '',
  })
  setters.setStatus(
    `Loaded ${profile.name} from catalog: ${parsed.rows.length} row${
      parsed.rows.length === 1 ? '' : 's'
    }, ${formatRax(profile.totalBaseRax)} base RAX${
      parsed.skipped ? ` · skipped ${parsed.skipped} invalid row${parsed.skipped === 1 ? '' : 's'}` : ''
    }. Analysis updates automatically below.`,
  )
  return true
}

export default function PotentialPage() {
  const { data, addPotentialCard, updatePotentialCard, deletePotentialCard } = useRaxData()
  const [form, setForm] = useState(EMPTY_FORM)
  const [potentialRows, setPotentialRows] = useState<ParsedRealAppToolsRow[]>([])
  const [status, setStatus] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showTutorial, setShowTutorial] = useState(true)
  const [catalogLoadingKey, setCatalogLoadingKey] = useState('')
  const [rankSport, setRankSport] = useState<RankSportChoice>('FC')
  const [excludedRankSports, setExcludedRankSports] = useState<Sport[]>([])
  const [excludedRankSeasonLabels, setExcludedRankSeasonLabels] = useState<string[]>([])
  const [bundleSize, setBundleSize] = useState(DEFAULT_BUNDLE_SIZE)
  const [rankingInProgress, setRankingInProgress] = useState(false)
  const [rankProgress, setRankProgress] = useState<PassRecommendationProgress | null>(null)
  const [rankStatus, setRankStatus] = useState('')
  const [recommendationRows, setRecommendationRows] = useState<PassRecommendationRow[]>([])
  const [recommendationBundle, setRecommendationBundle] = useState<PassRecommendationBundle | null>(
    null,
  )
  const [recommendationMeta, setRecommendationMeta] = useState<{
    calculatedAt: string
    skippedOwnedIconic: number
    skippedNoRows: number
    catalogCount: number
    fetchTrimmed: number
    prefilterTrimmed: number
  } | null>(null)
  const [profileByKey, setProfileByKey] = useState<Map<string, CatalogImportProfile>>(new Map())
  const [catalogSeasonOptions, setCatalogSeasonOptions] = useState<CatalogSeasonYearOption[]>([])
  const rankAbortRef = useRef<AbortController | null>(null)

  const potentialAnalysis = useMemo(
    () =>
      analyzePotentialCard(
        data,
        {
          name: form.name,
          sport: form.sport,
          season: form.season,
          simulatedRarityLabel: form.previewAs || undefined,
        },
        potentialRows,
      ),
    [data, form.name, form.previewAs, form.season, form.sport, potentialRows],
  )

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setPotentialRows([])
    setEditingId(null)
    setStatus('')
  }

  const submitAnalyze = (event: FormEvent) => {
    event.preventDefault()
    try {
      const parsed = parseRealAppToolsRows(form.rawJson, {
        sport: form.sport,
        rarityLabel: form.previewAs,
        applyOtdMultiplier: Boolean(form.previewAs),
      })
      setPotentialRows(parsed.rows)
      setStatus(
        `Analyzing ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}${
          parsed.skipped ? ` · skipped ${parsed.skipped} invalid row${parsed.skipped === 1 ? '' : 's'}` : ''
        }.`,
      )
    } catch (error) {
      setPotentialRows([])
      setStatus(error instanceof Error ? error.message : 'Could not parse pasted JSON.')
    }
  }

  const saveProfile = () => {
    if (!form.name.trim()) {
      setStatus('Enter a player name before saving.')
      return
    }

    const payload = {
      name: form.name,
      sport: form.sport,
      season: form.season,
      notes: form.notes,
      rawJson: form.rawJson,
      simulatedRarityLabel: form.previewAs || undefined,
      rows: potentialRows.map((row) => ({
        claimDay: row.claimDay,
        raxEarned: row.baseRaxEarned ?? row.raxEarned,
        note: row.note,
      })),
    }

    if (editingId) {
      updatePotentialCard(editingId, payload)
      setStatus(`Updated profile for ${form.name.trim()}.`)
    } else {
      const id = addPotentialCard(payload)
      setEditingId(id)
      setStatus(`Saved profile for ${form.name.trim()}.`)
    }
  }

  const loadProfile = (id: string) => {
    const saved = data.potentialCards.find((card) => card.id === id)
    if (!saved) return
    setEditingId(saved.id)
    setForm({
      name: saved.name,
      sport: saved.sport,
      season: saved.season,
      notes: saved.notes,
      rawJson: saved.rawJson,
      previewAs: saved.simulatedRarityLabel ?? '',
    })
    setPotentialRows(
      saved.rows.map((row) => ({
        claimDay: row.claimDay,
        raxEarned: row.raxEarned,
        baseRaxEarned: row.raxEarned,
        note: row.note,
      })),
    )
    setStatus(
      `Loaded ${saved.name || 'profile'}${saved.rows.length ? ` with ${saved.rows.length} row${saved.rows.length === 1 ? '' : 's'}` : ''}. Click Analyze to refresh results.`,
    )
  }

  const loadFromCatalog = async (result: CatalogSearchResult) => {
    setCatalogLoadingKey(result.externalKey)
    setStatus('')
    try {
      const { profile, storageConfigured } = await fetchCatalogImportProfile(result.externalKey)
      if (!storageConfigured) {
        setStatus('Shared catalog search is not configured yet.')
        return
      }
      if (!profile) {
        setStatus('That pass was not found in the shared catalog. Try searching again.')
        return
      }
      applyCatalogProfileToForm(profile, {
        setEditingId,
        setPotentialRows,
        setForm,
        setStatus,
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load catalog pass.')
    } finally {
      setCatalogLoadingKey('')
    }
  }

  const loadRecommendationRow = (row: PassRecommendationRow) => {
    const profile = profileByKey.get(row.externalKey)
    if (!profile) {
      setStatus('Catalog profile is no longer loaded — run Rank catalog passes again.')
      return
    }
    applyCatalogProfileToForm(profile, {
      setEditingId,
      setPotentialRows,
      setForm,
      setStatus,
    })
    setForm((current) => ({ ...current, previewAs: RECOMMENDATION_SIMULATED_RARITY }))
    document.getElementById('potential-card-form')?.scrollIntoView({ behavior: 'smooth' })
  }

  const cancelRanking = () => {
    rankAbortRef.current?.abort()
    rankAbortRef.current = null
    setRankingInProgress(false)
    setRankProgress(null)
    setRankStatus('Ranking cancelled.')
  }

  const rankAllSports = rankSport === ALL_SPORTS_RANK

  const rankSportOptions = useMemo(
    () => SPORTS.map((sport) => ({ value: sport, label: sport })),
    [],
  )

  const includedRankSports = useMemo(
    () => SPORTS.filter((sport) => !excludedRankSports.includes(sport)),
    [excludedRankSports],
  )

  const excludedRankSportOptions = useMemo(
    () => rankSportOptions.filter((option) => excludedRankSports.includes(option.value as Sport)),
    [excludedRankSports, rankSportOptions],
  )

  const runCatalogRanking = async () => {
    rankAbortRef.current?.abort()
    const controller = new AbortController()
    rankAbortRef.current = controller
    setRankingInProgress(true)
    setRankProgress(null)
    setRankStatus('')
    setRecommendationRows([])
    setRecommendationBundle(null)
    setRecommendationMeta(null)
    setProfileByKey(new Map())

    const rankSports: Sport[] = rankAllSports ? includedRankSports : [rankSport]

    try {
      if (rankAllSports && rankSports.length === 0) {
        setRankStatus('Select at least one sport to rank.')
        return
      }

      if (
        availableSeasonOptions.length > 0 &&
        availableSeasonOptions.every((option) => excludedRankSeasonLabels.includes(option.value))
      ) {
        setRankStatus('Select at least one season to rank.')
        return
      }

      const includedSeasonLabels = availableSeasonOptions
        .filter((option) => !excludedRankSeasonLabels.includes(option.value))
        .map((option) => option.label)

      const seasonFilter = { excludedSeasonLabels: excludedRankSeasonLabels }
      let catalogCount = 0
      let skippedOwnedIconic = 0
      let fetchTrimmed = 0
      const candidateKeys: string[] = []
      const seenCandidateKeys = new Set<string>()

      for (let sportIndex = 0; sportIndex < rankSports.length; sportIndex += 1) {
        const sport = rankSports[sportIndex]!
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }

        setRankStatus(
          rankAllSports
            ? `Loading ${sport} catalog passes… (${sportIndex + 1}/${rankSports.length})`
            : `Loading ${sport} catalog passes…`,
        )
        const { results, storageConfigured } = await fetchCatalogPassSummaries(
          { sport, passKind: 'player' },
          controller.signal,
        )
        if (!storageConfigured) {
          setRankStatus('Shared catalog is not configured yet.')
          return
        }
        catalogCount += results.length

        const selected = selectSummariesForBulkFetch(data, results, { ...seasonFilter, sport })
        skippedOwnedIconic += selected.skippedOwnedIconic
        fetchTrimmed += selected.fetchTrimmed
        for (const key of selected.keys) {
          if (!seenCandidateKeys.has(key)) {
            seenCandidateKeys.add(key)
            candidateKeys.push(key)
          }
        }
      }

      if (candidateKeys.length === 0) {
        setRankStatus(
          skippedOwnedIconic > 0
            ? rankAllSports
              ? `All eligible catalog passes across every sport are already in your collection at ${RECOMMENDATION_SIMULATED_RARITY} or higher.`
              : `All eligible ${rankSport} catalog passes are already in your collection at ${RECOMMENDATION_SIMULATED_RARITY} or higher.`
            : rankAllSports
              ? 'No player passes with earnings found across any sport.'
              : `No player passes with earnings found for ${rankSport}.`,
        )
        return
      }

      const caps = rankAllSports
        ? recommendationCapsForSports(rankSports)
        : recommendationCapsForSport(rankSport)
      setRankStatus(
        rankAllSports
          ? `Fetching earnings for ${candidateKeys.length} passes across ${rankSports.length} sport${
              rankSports.length === 1 ? '' : 's'
            } (cap ${caps.bulkFetchCap} total)…`
          : `Fetching earnings for ${candidateKeys.length} passes${
              fetchTrimmed > 0
                ? ` (top ${candidateKeys.length} by base RAX · cap ${caps.bulkFetchCap})`
                : ''
            }…`,
      )
      const { profiles, storageConfigured: bulkConfigured } = await fetchCatalogImportProfilesBulk(
        candidateKeys,
        controller.signal,
      )
      if (!bulkConfigured) {
        setRankStatus('Shared catalog is not configured yet.')
        return
      }

      const profileMap = new Map(profiles.map((profile) => [profile.externalKey, profile]))
      setProfileByKey(profileMap)

      setRankStatus(`Analyzing top candidates at ${RECOMMENDATION_SIMULATED_RARITY} OTD…`)
      const { ranked, bundle } = await rankAndRecommendAsync(data, profiles, bundleSize, {
        ...seasonFilter,
        ...(rankAllSports ? { caps } : { sport: rankSport }),
        signal: controller.signal,
        batchSize: 24,
        onProgress: setRankProgress,
      })

      setRecommendationRows(ranked.rows.slice(0, TOP_RECOMMENDATIONS))
      setRecommendationBundle(bundle)
      setRecommendationMeta({
        calculatedAt: new Date().toISOString(),
        skippedOwnedIconic: ranked.skippedOwnedIconic + skippedOwnedIconic,
        skippedNoRows: ranked.skippedNoRows,
        catalogCount,
        fetchTrimmed,
        prefilterTrimmed: ranked.prefilterTrimmed,
      })
      const sportLabel = rankAllSports
        ? rankSports.length === SPORTS.length
          ? 'all sports'
          : rankSports.join(', ')
        : rankSport
      setRankStatus(
        `Ranked ${ranked.analyzedCount} pass${ranked.analyzedCount === 1 ? '' : 'es'} at ${RECOMMENDATION_SIMULATED_RARITY} for ${sportLabel} · showing top ${Math.min(TOP_RECOMMENDATIONS, ranked.rows.length)}${
          includedSeasonLabels.length > 0 && includedSeasonLabels.length < availableSeasonOptions.length
            ? ` · seasons ${includedSeasonLabels.join(', ')}`
            : ''
        }.`,
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setRankStatus(error instanceof Error ? error.message : 'Could not rank catalog passes.')
    } finally {
      if (rankAbortRef.current === controller) {
        rankAbortRef.current = null
      }
      setRankingInProgress(false)
      setRankProgress(null)
    }
  }

  const availableSeasonOptions = useMemo(() => {
    const byLabel = new Map<string, { value: string; label: string; seasonYear: number }>()
    for (const option of catalogSeasonOptions) {
      const value = option.seasonLabel.trim() || String(option.seasonYear)
      byLabel.set(value, {
        value,
        label: value,
        seasonYear: option.seasonYear,
      })
    }
    for (const profile of profileByKey.values()) {
      const value = seasonLabelForFilter(profile)
      const existing = byLabel.get(value)
      byLabel.set(value, {
        value,
        label: value,
        seasonYear: Math.max(existing?.seasonYear ?? 0, profile.seasonYear),
      })
    }
    return [...byLabel.values()]
      .sort((a, b) => b.seasonYear - a.seasonYear || b.label.localeCompare(a.label))
      .map(({ value, label }) => ({ value, label }))
  }, [catalogSeasonOptions, profileByKey])

  const includedSeasonOptions = useMemo(
    () => availableSeasonOptions.filter((option) => !excludedRankSeasonLabels.includes(option.value)),
    [availableSeasonOptions, excludedRankSeasonLabels],
  )

  const excludedSeasonOptions = useMemo(
    () => availableSeasonOptions.filter((option) => excludedRankSeasonLabels.includes(option.value)),
    [availableSeasonOptions, excludedRankSeasonLabels],
  )

  useEffect(() => {
    let cancelled = false

    const loadSeasonOptions = async () => {
      const seasonSports =
        rankSport === ALL_SPORTS_RANK
          ? SPORTS.filter((sport) => !excludedRankSports.includes(sport))
          : [rankSport]

      if (rankSport === ALL_SPORTS_RANK) {
        const byLabel = new Map<string, CatalogSeasonYearOption>()
        for (const sport of seasonSports) {
          const { seasonYears, storageConfigured } = await fetchCatalogSeasonYears({
            sport,
            passKind: 'player',
          })
          if (cancelled) return
          if (!storageConfigured) {
            setCatalogSeasonOptions([])
            return
          }
          for (const option of seasonYears) {
            const value = option.seasonLabel.trim() || String(option.seasonYear)
            const existing = byLabel.get(value)
            if (!existing || option.seasonYear > existing.seasonYear) {
              byLabel.set(value, option)
            }
          }
        }
        if (!cancelled) {
          setCatalogSeasonOptions(
            [...byLabel.values()].sort(
              (a, b) => b.seasonYear - a.seasonYear || a.seasonLabel.localeCompare(b.seasonLabel),
            ),
          )
        }
        return
      }

      const { seasonYears, storageConfigured } = await fetchCatalogSeasonYears({
        sport: rankSport,
        passKind: 'player',
      })
      if (cancelled || !storageConfigured) return
      setCatalogSeasonOptions(seasonYears)
    }

    void loadSeasonOptions().catch(() => {
      if (!cancelled) setCatalogSeasonOptions([])
    })

    return () => {
      cancelled = true
    }
  }, [excludedRankSports, rankSport])

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">What-if</p>
          <h2>Potential card checker</h2>
          <p>
            Test a player pass you do not own yet, or rank catalog passes by net claimable RAX for a
            sport. Search the shared Meowbot catalog for daily RAX and base totals, or paste JSON
            manually from realapp.com. Saved profiles stay out of your real totals.
          </p>
        </div>
        <Link className="button" to="/overlaps">
          View overlaps
        </Link>
      </section>

      <section className="panel" id="catalog-recommendations">
        <div className="section-heading">
          <div>
            <h2>Rank catalog passes</h2>
            <p>
              Find player passes in the shared catalog that would add the most{' '}
              <strong>net claimable RAX</strong> to your collection for a sport. Every candidate is
              simulated at <strong>{RECOMMENDATION_SIMULATED_RARITY}</strong> OTD. Net claimable is
              what the new pass would claim minus RAX your existing cards would lose to overlap.
            </p>
          </div>
        </div>
        <p className="import-hint">
          Candidates come from the shared Meowbot catalog only. Passes already in your collection
          at {RECOMMENDATION_SIMULATED_RARITY} or higher are skipped; lower-rarity owned passes stay
          eligible. Only the top catalog passes by base RAX are fetched and analyzed (default 1000,
          higher for MLB and other large sports). The catalog may be incomplete or outdated. The recommended bundle uses a{' '}
          <strong>greedy</strong> pick: best pass first, then re-rank a shortlist with it virtually
          added.
          {rankSport === ALL_SPORTS_RANK ? (
            <>
              {' '}
              <strong>All sports</strong> loads every sport&apos;s catalog, fetches each sport&apos;s
              top passes by base RAX, then ranks across the combined pool — expect long runtimes.
            </>
          ) : null}
        </p>
        <div className="sort-controls">
          <label className="field inline-field">
            <span>Sport</span>
            <select
              value={rankSport}
              disabled={rankingInProgress}
              onChange={(event) => {
                const next = event.target.value
                setRankSport(next === ALL_SPORTS_RANK ? ALL_SPORTS_RANK : (next as Sport))
                setExcludedRankSeasonLabels([])
                if (next !== ALL_SPORTS_RANK) {
                  setExcludedRankSports([])
                }
              }}
            >
              <option value={ALL_SPORTS_RANK}>All sports (slow)</option>
              {SPORTS.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
          </label>
          {rankAllSports ? (
            <div className="field inline-field season-multi-select-field">
              <SeasonMultiSelect
                options={rankSportOptions}
                excludedValues={excludedRankSports}
                onExcludedValuesChange={(values) => setExcludedRankSports(values as Sport[])}
                disabled={rankingInProgress}
                label="Sports"
                menuTitle="Sports"
                allOptionLabel="All sports"
                emptyTriggerLabel="No sports"
                countUnit="sports"
              />
              {excludedRankSportOptions.length > 0 ? (
                <p className="season-filter-summary">
                  <span>
                    Including:{' '}
                    {includedRankSports.length > 0 ? includedRankSports.join(', ') : 'none'}
                  </span>
                  {' · '}
                  <span>
                    Excluding: {excludedRankSportOptions.map((option) => option.label).join(', ')}
                  </span>
                </p>
              ) : (
                <p className="season-filter-summary">Including all sports</p>
              )}
            </div>
          ) : null}
          <div className="field inline-field season-multi-select-field">
            <SeasonMultiSelect
              options={availableSeasonOptions}
              excludedValues={excludedRankSeasonLabels}
              onExcludedValuesChange={setExcludedRankSeasonLabels}
              disabled={rankingInProgress}
              label="Seasons"
            />
            {availableSeasonOptions.length > 0 ? (
              <p className="season-filter-summary">
                {includedSeasonOptions.length === availableSeasonOptions.length ? (
                  <>Including all seasons ({availableSeasonOptions.map((option) => option.label).join(', ')})</>
                ) : (
                  <>
                    <span>
                      Including:{' '}
                      {includedSeasonOptions.length > 0
                        ? includedSeasonOptions.map((option) => option.label).join(', ')
                        : 'none'}
                    </span>
                    {excludedSeasonOptions.length > 0 ? (
                      <>
                        {' '}
                        · <span>Excluding: {excludedSeasonOptions.map((option) => option.label).join(', ')}</span>
                      </>
                    ) : null}
                  </>
                )}
              </p>
            ) : null}
          </div>
          <label className="field inline-field">
            <span>Bundle size</span>
            <input
              type="number"
              min={1}
              max={RECOMMENDATION_MAX_BUNDLE_SIZE}
              value={bundleSize}
              disabled={rankingInProgress}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) {
                  setBundleSize(
                    Math.max(1, Math.min(RECOMMENDATION_MAX_BUNDLE_SIZE, Math.floor(next))),
                  )
                }
              }}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={
              rankingInProgress ||
              (rankAllSports && includedRankSports.length === 0) ||
              (availableSeasonOptions.length > 0 && includedSeasonOptions.length === 0)
            }
            onClick={() => void runCatalogRanking()}
          >
            {rankingInProgress ? 'Ranking…' : 'Rank catalog passes'}
          </button>
          {rankingInProgress ? (
            <button className="button" type="button" onClick={cancelRanking}>
              Cancel
            </button>
          ) : null}
        </div>
        {rankProgress ? (
          <p className="import-progress">
            Analyzing pass {rankProgress.current}/{rankProgress.total} — {rankProgress.label}
          </p>
        ) : null}
        {rankStatus ? <p className="import-status">{rankStatus}</p> : null}

        {recommendationBundle && recommendationBundle.picks.length > 0 ? (
          <section className="panel nested-panel">
            <div className="section-heading">
              <div>
                <h3>Recommended bundle (greedy)</h3>
                <p>
                  Top {recommendationBundle.picks.length} pass
                  {recommendationBundle.picks.length === 1 ? '' : 'es'} to add one at a time.
                </p>
              </div>
              <span className="badge">
                {formatSignedRax(displayRaxValue(recommendationBundle.combinedNetDelta))} combined
                net
              </span>
            </div>
            <div className="list">
              {recommendationBundle.picks.map((row, index) => (
                <button
                  className="list-row link-button-row"
                  type="button"
                  key={row.externalKey}
                  onClick={() => loadRecommendationRow(row)}
                >
                  <span>
                    <strong>
                      {index + 1}. {row.name}
                    </strong>
                    <small>
                      {row.sport} · {row.season}
                      {row.rarityLabel ? ` · ${row.rarityLabel}` : ''} ·{' '}
                      {formatSignedRax(displayRaxValue(row.netClaimableDelta))} net
                    </small>
                  </span>
                  <b>{formatRax(displayRaxValue(row.newClaimableRax))} claimable</b>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {recommendationRows.length > 0 ? (
          <>
            {recommendationMeta ? (
              <p className="import-hint">
                Saved {new Date(recommendationMeta.calculatedAt).toLocaleString()} ·{' '}
                {recommendationMeta.catalogCount} catalog pass
                {recommendationMeta.catalogCount === 1 ? '' : 'es'}
                {recommendationMeta.skippedOwnedIconic > 0
                  ? ` · ${recommendationMeta.skippedOwnedIconic} already owned at ${RECOMMENDATION_SIMULATED_RARITY}+`
                  : ''}
                {recommendationMeta.fetchTrimmed > 0
                  ? ` · ${recommendationMeta.fetchTrimmed} not fetched (base RAX pre-filter)`
                  : ''}
                {recommendationMeta.prefilterTrimmed > 0
                  ? ` · ${recommendationMeta.prefilterTrimmed} not fully simulated (Iconic 1 pre-filter)`
                  : ''}
                {recommendationMeta.skippedNoRows > 0
                  ? ` · ${recommendationMeta.skippedNoRows} without earnings rows`
                  : ''}
                . Click a row to open detailed analysis below.
              </p>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Pass</th>
                    <th>Net Δ</th>
                    <th>New claimable</th>
                    <th>Displaced</th>
                    <th>Overlap</th>
                    <th>Base RAX</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendationRows.map((row, index) => (
                    <tr key={row.externalKey}>
                      <td>{index + 1}</td>
                      <td>
                        <button
                          className="link-button"
                          type="button"
                          onClick={() => loadRecommendationRow(row)}
                        >
                          {row.name}
                        </button>
                        <br />
                        <small className="table-sub">
                          {row.sport} · {row.season}
                          {row.rarityLabel ? ` · ${row.rarityLabel}` : ''}
                        </small>
                      </td>
                      <td>
                        <strong
                          className={
                            row.netClaimableDelta > 0
                              ? 'sale-positive'
                              : row.netClaimableDelta < 0
                                ? 'sale-negative'
                                : ''
                          }
                        >
                          {formatSignedRax(displayRaxValue(row.netClaimableDelta))}
                        </strong>
                      </td>
                      <td>{formatRax(displayRaxValue(row.newClaimableRax))}</td>
                      <td>
                        {row.displacedRax > 0
                          ? `−${formatRax(displayRaxValue(row.displacedRax))}`
                          : '—'}
                      </td>
                      <td>{formatRax(displayRaxValue(row.overlapRax))}</td>
                      <td>{formatRax(displayRaxValue(row.totalBaseRax))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="panel help-section">
        <div className="section-heading">
          <div>
            <h2>Manual import walkthrough</h2>
            <p>
              Username import closes after {realappToolsShutdownLabel()}. Use{' '}
              <a href="#catalog-search">shared catalog search</a> below for player passes and RAX, or
              paste one card at a time from realapp.com.
            </p>
          </div>
          <button className="button" type="button" onClick={() => setShowTutorial((current) => !current)}>
            {showTutorial ? 'Hide steps' : 'Show steps'}
          </button>
        </div>
        {showTutorial ? (
          <>
            <ol className="help-list ordered">
              <li>
                Open{' '}
                <a href="https://www.realapp.com" target="_blank" rel="noreferrer">
                  realapp.com
                </a>{' '}
                on a desktop browser and log in with Real Pro.
              </li>
              <li>
                Find the player or team pass you are considering and open its earnings view.
              </li>
              <li>
                <strong>Chrome or Edge (Windows/Mac):</strong> press <kbd>F12</kbd> or{' '}
                <kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>I</kbd> on Mac → <strong>Network</strong> →
                filter <code>userpassearnings</code> → click the request → open <strong>Response</strong>{' '}
                (or Preview) → select <strong>all</strong> the JSON (it must start with{' '}
                <code>{'{'}</code>) → copy.
              </li>
              <li>
                <strong>Safari on Mac:</strong> Safari → Settings → Advanced → enable{' '}
                <strong>Show features for web developers</strong>. Then Develop →{' '}
                <strong>Show Web Inspector</strong> → <strong>Network</strong> tab (same filter and
                copy steps). Safari labels panels slightly differently than Chrome; use the panel
                that shows the raw JSON body, not Headers only.
              </li>
              <li>
                <strong>Firefox (Windows/Mac):</strong> <kbd>F12</kbd> or <kbd>Cmd</kbd>+
                <kbd>Option</kbd>+<kbd>I</kbd> → <strong>Network</strong> → click{' '}
                <code>userpassearnings</code> → <strong>Response</strong>.
              </li>
              <li>
                <strong>On mobile:</strong> use desktop site mode on a PC if you can, or remote
                debugging (Safari Web Inspector on iOS, Chrome <code>chrome://inspect</code> on
                Android). Alternatively, paste on desktop first and save the profile here.
              </li>
              <li>
                Fill in the player name, sport, and season/card label below, paste the JSON, and
                click <strong>Analyze potential card</strong>. Use <strong>Preview as</strong> to
                simulate OTD at a higher rarity (e.g. Iconic).
              </li>
              <li>
                Click <strong>Save profile</strong> to keep the player info and JSON for later.
              </li>
            </ol>
            <p className="import-hint">
              The JSON must start with <code>{'{'}</code>, e.g.{' '}
              <code>{'{"earnings":[{"day":"2025-08-22","earnings":26,...}]}'}</code>. If you only
              copy from <code>earnings</code> onward, paste will fail — select from the opening
              brace.
            </p>
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Saved profiles</h2>
            <p>Player info and pasted JSON — reload to re-run the what-if analysis.</p>
          </div>
          <span className="badge">{data.potentialCards.length} saved</span>
        </div>
        {data.potentialCards.length === 0 ? (
          <p className="empty">No saved profiles yet. Fill in the form below and save one.</p>
        ) : (
          <div className="list">
            {data.potentialCards.map((saved) => (
              <div className="list-row" key={saved.id}>
                <span>
                  <strong>{saved.name || 'Potential card'}</strong>
                  <small>
                    {saved.sport} · {saved.season || 'No season'} · {saved.rows.length} row
                    {saved.rows.length === 1 ? '' : 's'}
                    {saved.simulatedRarityLabel
                      ? ` · preview ${saved.simulatedRarityLabel}`
                      : ''}
                    {saved.notes ? ` · ${saved.notes}` : ''}
                  </small>
                </span>
                <span className="button-row compact-actions">
                  <button className="button" type="button" onClick={() => loadProfile(saved.id)}>
                    Load
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    onClick={() => {
                      if (editingId === saved.id) resetForm()
                      deletePotentialCard(saved.id)
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <CatalogSearchPanel
        sectionId="catalog-search"
        title="Search player passes"
        description="Load daily RAX from the shared Meowbot catalog to run a what-if against your collection. Results show row counts and total base RAX."
        passKind="player"
        actionLabel="Load for analysis"
        loadingKey={catalogLoadingKey}
        disabled={Boolean(catalogLoadingKey)}
        onSelect={loadFromCatalog}
      />

      <form className="panel form-panel" id="potential-card-form" onSubmit={submitAnalyze}>
        <div className="section-heading">
          <div>
            <h2>{editingId ? 'Edit profile' : 'New potential card'}</h2>
            <p>
              {editingId
                ? 'Update fields or JSON, then analyze again or save.'
                : 'Search the shared catalog above, or enter details and paste realapp.com JSON below.'}
            </p>
          </div>
          <span className="badge">{editingId ? 'Editing' : 'Draft'}</span>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Player / team name</span>
            <input
              value={form.name}
              placeholder="Dominik Szoboszlai"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Sport</span>
            <select
              value={form.sport}
              onChange={(event) =>
                setForm((current) => ({ ...current, sport: event.target.value as Sport }))
              }
            >
              {SPORTS.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Season / card label</span>
            <input
              value={form.season}
              placeholder="2025-26"
              onChange={(event) => setForm((current) => ({ ...current, season: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Preview as</span>
            <select
              value={form.previewAs}
              onChange={(event) =>
                setForm((current) => ({ ...current, previewAs: event.target.value }))
              }
            >
              {RARITY_PREVIEW_OPTIONS.map((option) => (
                <option key={option || 'actual'} value={option}>
                  {option || 'Base earnings (no OTD boost)'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Profile notes (optional)</span>
          <input
            value={form.notes}
            placeholder="Target price, rarity, listing link…"
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>realapp.com earnings JSON</span>
          <textarea
            className="bulk-import-textarea"
            value={form.rawJson}
            placeholder='{"rows":[{"day":"2025-08-22","earnings":26,"player_box_score_id":1976890479}]}'
            onChange={(event) => setForm((current) => ({ ...current, rawJson: event.target.value }))}
          />
        </label>
        <div className="button-row">
          <button className="button primary" type="submit" disabled={!form.rawJson.trim()}>
            Analyze potential card
          </button>
          <button className="button" type="button" disabled={!form.name.trim()} onClick={saveProfile}>
            Save profile
          </button>
          <button className="button" type="button" onClick={resetForm}>
            New profile
          </button>
          {status ? <p className="import-status">{status}</p> : null}
        </div>
      </form>

      {potentialAnalysis ? (
        <PotentialAnalysisResults analysis={potentialAnalysis} previewAs={form.previewAs} />
      ) : null}
    </div>
  )
}
