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
  searchCatalog,
  type CatalogImportProfile,
  type CatalogSearchResult,
} from '../lib/catalogApi'
import { sportFromCatalog } from '../lib/catalogImport'
import { catalogProfileToJson } from '../lib/catalogProfileJson'
import { formatClaimDay, formatRax } from '../lib/format'
import { analyzePotentialCard, type PotentialAnalysisResult } from '../lib/potentialAnalysis'
import {
  applyRecommendationBaseline,
  countAppliedBaselineAdjustments,
  greedyPickBundleAsync,
  isAtLeastIconic1Rarity,
  isRecommendationPassOwnedAtIconic,
  rankAndRecommendAsync,
  RECOMMENDATION_GREEDY_RERANK_CAP,
  RECOMMENDATION_MAX_BUNDLE_SIZE,
  RECOMMENDATION_SIMULATED_RARITY,
  recommendationCapsForSport,
  recommendationCapsForSports,
  selectSummariesForBulkFetch,
  type PassRecommendationBundle,
  type RecommendationPassAdjustment,
  type RecommendationPassAdjustmentMode,
  sportSeasonFilterKey,
  type PassRecommendationProgress,
  type PassRecommendationRow,
} from '../lib/passRecommendation'
import {
  buildSportOpportunityRow,
  computeSportCollectionStats,
  sortSportOpportunityRows,
  SPORT_OPPORTUNITY_ANALYSIS_CAP,
  SPORT_OPPORTUNITY_BUNDLE_SIZE,
  SPORT_OPPORTUNITY_FETCH_CAP,
  SPORT_OPPORTUNITY_SUMMARY_LIMIT,
  topSportOpportunityFocus,
  type SportOpportunityRow,
} from '../lib/sportOpportunityAnalysis'
import { realappToolsShutdownLabel } from '../lib/importShutdown'
import { formatSignedRax } from '../lib/removeCardAnalysis'
import { parseRealAppToolsRows, type ParsedRealAppToolsRow } from '../lib/realAppToolsImport'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { useRaxData } from '../context/RaxDataContext'
import { SPORTS, type RaxTrackerData, type Sport } from '../types/rax'

const TOP_RANKING_RESULTS = 50
const RANKING_PAGE_SIZE = 25
const DEFAULT_BUNDLE_SIZE = 3
const ALL_SPORTS_RANK = 'ALL' as const

type RankSportChoice = Sport | typeof ALL_SPORTS_RANK

const SPORT_SUMMARY_FETCH_CONCURRENCY = 4

async function loadSportCatalogSummaries(
  sports: Sport[],
  summaryLimitForSport: (sport: Sport) => number,
  signal: AbortSignal,
  onSportStart?: (sport: Sport, index: number, total: number) => void,
): Promise<{
  bySport: Map<Sport, Awaited<ReturnType<typeof fetchCatalogPassSummaries>>['results']>
  storageConfigured: boolean
}> {
  const bySport = new Map<Sport, Awaited<ReturnType<typeof fetchCatalogPassSummaries>>['results']>()
  let storageConfigured = true

  for (let waveStart = 0; waveStart < sports.length; waveStart += SPORT_SUMMARY_FETCH_CONCURRENCY) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const wave = sports.slice(waveStart, waveStart + SPORT_SUMMARY_FETCH_CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map(async (sport, offset) => {
        const sportIndex = waveStart + offset
        onSportStart?.(sport, sportIndex, sports.length)
        const result = await fetchCatalogPassSummaries(
          { sport, passKind: 'player', limit: summaryLimitForSport(sport) },
          signal,
        )
        return { sport, result }
      }),
    )

    for (const { sport, result } of waveResults) {
      if (!result.storageConfigured) {
        storageConfigured = false
      }
      bySport.set(sport, result.results)
    }
  }

  return { bySport, storageConfigured }
}

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize))
}

type CatalogSportSeasonOption = {
  sport: Sport
  seasonYear: number
  seasonLabel: string
}

type ExcludedSportSeason = {
  key: string
  sport: Sport
  seasonLabel: string
}

function formatExcludedSportSeason(entry: ExcludedSportSeason): string {
  return `${entry.sport} · ${entry.seasonLabel}`
}

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
  baselineAdjustmentCount = 0,
}: {
  analysis: PotentialAnalysisResult
  previewAs: string
  baselineAdjustmentCount?: number
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
            {baselineAdjustmentCount > 0 ? (
              <>
                {' '}
                Baseline includes {baselineAdjustmentCount} assumed pass
                {baselineAdjustmentCount === 1 ? '' : 'es'} at {RECOMMENDATION_SIMULATED_RARITY}.
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
  const [excludedSportSeasons, setExcludedSportSeasons] = useState<ExcludedSportSeason[]>([])
  const [excludeFormSport, setExcludeFormSport] = useState<Sport>('NFL')
  const [excludeFormSeasonLabel, setExcludeFormSeasonLabel] = useState('')
  const [excludeFormSeasonOptions, setExcludeFormSeasonOptions] = useState<CatalogSportSeasonOption[]>([])
  const [excludeFormSeasonsLoading, setExcludeFormSeasonsLoading] = useState(false)
  const [bundleSize, setBundleSize] = useState(DEFAULT_BUNDLE_SIZE)
  const [rankingInProgress, setRankingInProgress] = useState(false)
  const [rankProgress, setRankProgress] = useState<PassRecommendationProgress | null>(null)
  const [rankStatus, setRankStatus] = useState('')
  const [recommendationRows, setRecommendationRows] = useState<PassRecommendationRow[]>([])
  const [rankResultsPage, setRankResultsPage] = useState(1)
  const [recommendationBundle, setRecommendationBundle] = useState<PassRecommendationBundle | null>(
    null,
  )
  const [recommendationMeta, setRecommendationMeta] = useState<{
    calculatedAt: string
    skippedOwnedIconic: number
    skippedAdjusted: number
    skippedNoRows: number
    catalogCount: number
    fetchTrimmed: number
    prefilterTrimmed: number
    baselineAdjustmentCount: number
  } | null>(null)
  const [profileByKey, setProfileByKey] = useState<Map<string, CatalogImportProfile>>(new Map())
  const [rankCatalogProfiles, setRankCatalogProfiles] = useState<CatalogImportProfile[]>([])
  const [bundleClaimInProgress, setBundleClaimInProgress] = useState(false)
  const [bundleClaimSelection, setBundleClaimSelection] = useState<Set<string>>(new Set())
  const [rankAdjustments, setRankAdjustments] = useState<RecommendationPassAdjustment[]>([])
  const [ownedQuickAddFilter, setOwnedQuickAddFilter] = useState('')
  const [adjustmentSearchQuery, setAdjustmentSearchQuery] = useState('')
  const [adjustmentSearchResults, setAdjustmentSearchResults] = useState<CatalogSearchResult[]>([])
  const [adjustmentSearchBusy, setAdjustmentSearchBusy] = useState(false)
  const [adjustmentSearchStatus, setAdjustmentSearchStatus] = useState('')
  const [adjustmentProfilesByKey, setAdjustmentProfilesByKey] = useState<
    Map<string, CatalogImportProfile>
  >(new Map())
  const rankAbortRef = useRef<AbortController | null>(null)
  const sportOpportunityAbortRef = useRef<AbortController | null>(null)
  const [sportOpportunityInProgress, setSportOpportunityInProgress] = useState(false)
  const [sportOpportunityStatus, setSportOpportunityStatus] = useState('')
  const [sportOpportunityResults, setSportOpportunityResults] = useState<SportOpportunityRow[]>([])
  const [sportOpportunityCalculatedAt, setSportOpportunityCalculatedAt] = useState<string | null>(
    null,
  )
  const [sportOpportunityBaselineCount, setSportOpportunityBaselineCount] = useState(0)

  const sportOpportunityFocus = useMemo(
    () => topSportOpportunityFocus(sportOpportunityResults),
    [sportOpportunityResults],
  )

  const catalogAnalysisBusy = rankingInProgress || sportOpportunityInProgress || bundleClaimInProgress

  useEffect(() => {
    const assumeKeys = [
      ...new Set(
        rankAdjustments
          .filter((adjustment) => adjustment.mode === 'assume-iconic-1')
          .map((adjustment) => adjustment.externalKey),
      ),
    ]
    const missingKeys = assumeKeys.filter((key) => !profileByKey.has(key))
    if (missingKeys.length === 0) {
      setAdjustmentProfilesByKey((current) => {
        if (current.size === 0) return current
        const next = new Map(current)
        for (const key of current.keys()) {
          if (!assumeKeys.includes(key)) next.delete(key)
        }
        return next.size === current.size ? current : next
      })
      return
    }

    const controller = new AbortController()
    void fetchCatalogImportProfilesBulk(missingKeys, controller.signal)
      .then(({ profiles }) => {
        setAdjustmentProfilesByKey((current) => {
          const next = new Map(current)
          for (const profile of profiles) {
            next.set(profile.externalKey, profile)
          }
          for (const key of next.keys()) {
            if (!assumeKeys.includes(key) && !profileByKey.has(key)) {
              next.delete(key)
            }
          }
          return next
        })
      })
      .catch(() => {})

    return () => controller.abort()
  }, [profileByKey, rankAdjustments])

  const baselineProfilesByKey = useMemo(() => {
    const merged = new Map(adjustmentProfilesByKey)
    for (const [key, profile] of profileByKey) {
      merged.set(key, profile)
    }
    return merged
  }, [adjustmentProfilesByKey, profileByKey])

  const potentialBaselineData = useMemo(
    () => applyRecommendationBaseline(data, baselineProfilesByKey, rankAdjustments),
    [baselineProfilesByKey, data, rankAdjustments],
  )

  const potentialBaselineAdjustmentCount = useMemo(
    () => countAppliedBaselineAdjustments(baselineProfilesByKey, rankAdjustments),
    [baselineProfilesByKey, rankAdjustments],
  )

  const potentialAnalysis = useMemo(
    () =>
      analyzePotentialCard(
        potentialBaselineData,
        {
          name: form.name,
          sport: form.sport,
          season: form.season,
          simulatedRarityLabel: form.previewAs || undefined,
        },
        potentialRows,
      ),
    [
      form.name,
      form.previewAs,
      form.season,
      form.sport,
      potentialBaselineData,
      potentialRows,
    ],
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

  const isRecommendationOwnedAtIconic = (externalKey: string, trackerData: RaxTrackerData = data) => {
    const profile = profileByKey.get(externalKey)
    if (profile) {
      return isRecommendationPassOwnedAtIconic(trackerData, profile)
    }
    const owned = trackerData.cards.find((card) => card.externalKey === externalKey)
    return Boolean(owned && isAtLeastIconic1Rarity(owned.rarityLabel))
  }

  const cancelRanking = () => {
    rankAbortRef.current?.abort()
    rankAbortRef.current = null
    setRankingInProgress(false)
    setRankProgress(null)
    setRankStatus('Ranking cancelled.')
  }

  const cancelSportOpportunityScan = () => {
    sportOpportunityAbortRef.current?.abort()
    sportOpportunityAbortRef.current = null
    setSportOpportunityInProgress(false)
    setSportOpportunityStatus('Sport scan cancelled.')
  }

  const focusSportForRanking = (sport: Sport) => {
    setRankSport(sport)
    document.getElementById('catalog-recommendations')?.scrollIntoView({ behavior: 'smooth' })
  }

  const runSportOpportunityScan = async () => {
    sportOpportunityAbortRef.current?.abort()
    rankAbortRef.current?.abort()
    const controller = new AbortController()
    sportOpportunityAbortRef.current = controller
    setSportOpportunityInProgress(true)
    setSportOpportunityStatus('')
    setSportOpportunityResults([])
    setSportOpportunityCalculatedAt(null)
    setSportOpportunityBaselineCount(0)

    const seasonFilter = { excludedSportSeasonKeys }

    try {
      const assumeIconicKeys = rankAdjustments
        .filter((adjustment) => adjustment.mode === 'assume-iconic-1')
        .map((adjustment) => adjustment.externalKey)
      let baselineProfileMap = new Map<string, CatalogImportProfile>()
      if (assumeIconicKeys.length > 0) {
        setSportOpportunityStatus('Loading baseline adjustments…')
        const { profiles, storageConfigured } = await fetchCatalogImportProfilesBulk(
          assumeIconicKeys,
          controller.signal,
        )
        if (!storageConfigured) {
          setSportOpportunityStatus('Shared catalog is not configured yet.')
          return
        }
        baselineProfileMap = new Map(profiles.map((profile) => [profile.externalKey, profile]))
      }

      const baselineData = applyRecommendationBaseline(data, baselineProfileMap, rankAdjustments)
      const baselineAdjustmentCount = countAppliedBaselineAdjustments(
        baselineProfileMap,
        rankAdjustments,
      )
      setSportOpportunityBaselineCount(baselineAdjustmentCount)
      const collectionStats = computeSportCollectionStats(baselineData)
      const rows: SportOpportunityRow[] = []

      for (let sportIndex = 0; sportIndex < SPORTS.length; sportIndex += 1) {
        const sport = SPORTS[sportIndex]!
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }

        setSportOpportunityStatus(
          `Loading ${sport} catalog… (${sportIndex + 1}/${SPORTS.length})`,
        )
        const { results: summaries, storageConfigured } = await fetchCatalogPassSummaries(
          { sport, passKind: 'player', limit: SPORT_OPPORTUNITY_SUMMARY_LIMIT },
          controller.signal,
        )
        if (!storageConfigured) {
          setSportOpportunityStatus('Shared catalog is not configured yet.')
          return
        }

        const selected = selectSummariesForBulkFetch(baselineData, summaries, {
          ...seasonFilter,
          sport,
          cap: SPORT_OPPORTUNITY_FETCH_CAP,
          adjustments: rankAdjustments,
        })

        const collection = collectionStats.get(sport) ?? {
          ownedCards: 0,
          currentClaimableRax: 0,
          overlapRax: 0,
        }

        if (selected.keys.length === 0) {
          rows.push(
            buildSportOpportunityRow(
              sport,
              collection,
              summaries.length,
              {
                rows: [],
                skippedOwnedIconic: selected.skippedOwnedIconic,
                skippedNoRows: 0,
                skippedAdjusted: selected.skippedAdjusted,
                analyzedCount: 0,
                prefilterTrimmed: 0,
              },
              { picks: [], combinedNetDelta: 0 },
            ),
          )
          continue
        }

        setSportOpportunityStatus(
          `Fetching ${sport} earnings (${selected.keys.length} passes)… (${sportIndex + 1}/${SPORTS.length})`,
        )
        const { profiles, storageConfigured: bulkConfigured } = await fetchCatalogImportProfilesBulk(
          selected.keys,
          controller.signal,
        )
        if (!bulkConfigured) {
          setSportOpportunityStatus('Shared catalog is not configured yet.')
          return
        }

        setSportOpportunityStatus(`Analyzing ${sport}… (${sportIndex + 1}/${SPORTS.length})`)
        const { ranked, bundle } = await rankAndRecommendAsync(
          baselineData,
          profiles,
          SPORT_OPPORTUNITY_BUNDLE_SIZE,
          {
            sport,
            ...seasonFilter,
            adjustments: rankAdjustments,
            signal: controller.signal,
            caps: {
              bulkFetchCap: SPORT_OPPORTUNITY_FETCH_CAP,
              analysisCap: SPORT_OPPORTUNITY_ANALYSIS_CAP,
              greedyRerankCap: RECOMMENDATION_GREEDY_RERANK_CAP,
            },
            batchSize: 24,
          },
        )

        rows.push(
          buildSportOpportunityRow(sport, collection, summaries.length, ranked, bundle),
        )
      }

      const sorted = sortSportOpportunityRows(rows)
      setSportOpportunityResults(sorted)
      setSportOpportunityCalculatedAt(new Date().toISOString())
      const focus = topSportOpportunityFocus(sorted)
      setSportOpportunityStatus(
        focus
          ? focus.greedyCombinedNet > 0
            ? `Done · ${focus.sport} has the most room to grow — up to ${formatSignedRax(displayRaxValue(focus.greedyCombinedNet))} net from the top ${SPORT_OPPORTUNITY_BUNDLE_SIZE} greedy picks (at ${RECOMMENDATION_SIMULATED_RARITY})${
                baselineAdjustmentCount > 0
                  ? ` · baseline includes ${baselineAdjustmentCount} assumed upgrade${baselineAdjustmentCount === 1 ? '' : 's'}`
                  : ''
              }.`
            : `Done · ${focus.sport} has the best single-pass upside (${formatSignedRax(displayRaxValue(focus.bestSingleNet))} net), but no positive ${SPORT_OPPORTUNITY_BUNDLE_SIZE}-pass bundle with current filters.`
          : 'Done · no positive catalog opportunities found with your current collection and filters.',
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setSportOpportunityStatus(
        error instanceof Error ? error.message : 'Could not analyze sport opportunities.',
      )
    } finally {
      if (sportOpportunityAbortRef.current === controller) {
        sportOpportunityAbortRef.current = null
      }
      setSportOpportunityInProgress(false)
    }
  }

  const rankAllSports = rankSport === ALL_SPORTS_RANK

  const excludedSportSeasonKeys = useMemo(
    () => excludedSportSeasons.map((entry) => entry.key),
    [excludedSportSeasons],
  )

  const addExcludedSportSeason = () => {
    const seasonLabel = excludeFormSeasonLabel.trim()
    if (!seasonLabel) return
    const key = sportSeasonFilterKey(excludeFormSport, seasonLabel)
    if (excludedSportSeasons.some((entry) => entry.key === key)) return
    setExcludedSportSeasons((current) => [
      ...current,
      { key, sport: excludeFormSport, seasonLabel },
    ])
  }

  const removeExcludedSportSeason = (key: string) => {
    setExcludedSportSeasons((current) => current.filter((entry) => entry.key !== key))
  }

  useEffect(() => {
    let cancelled = false
    setExcludeFormSeasonsLoading(true)

    fetchCatalogSeasonYears({ sport: excludeFormSport, passKind: 'player' })
      .then(({ seasonYears, storageConfigured }) => {
        if (cancelled) return
        if (!storageConfigured) {
          setExcludeFormSeasonOptions([])
          return
        }
        const options = seasonYears.map((option) => ({
          sport: excludeFormSport,
          seasonYear: option.seasonYear,
          seasonLabel: option.seasonLabel.trim() || String(option.seasonYear),
        }))
        setExcludeFormSeasonOptions(options)
        setExcludeFormSeasonLabel((current) => {
          if (current && options.some((option) => option.seasonLabel === current)) {
            return current
          }
          return options[0]?.seasonLabel ?? ''
        })
      })
      .catch(() => {
        if (!cancelled) setExcludeFormSeasonOptions([])
      })
      .finally(() => {
        if (!cancelled) setExcludeFormSeasonsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [excludeFormSport])

  const ownedAdjustableCards = useMemo(
    () =>
      [...data.cards]
        .filter(
          (card) => card.passKind !== 'team' && !isAtLeastIconic1Rarity(card.rarityLabel),
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
      const haystack = [card.name, card.sport, card.season, card.rarityLabel ?? '', card.externalKey ?? '']
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [ownedAdjustableCards, ownedQuickAddFilter])

  const adjustmentExternalKeys = useMemo(
    () => new Set(rankAdjustments.map((adjustment) => adjustment.externalKey)),
    [rankAdjustments],
  )

  const addRankAdjustment = (
    result: Pick<CatalogSearchResult, 'externalKey' | 'name' | 'sport' | 'seasonLabel' | 'seasonYear'>,
    mode: RecommendationPassAdjustmentMode = 'assume-iconic-1',
  ) => {
    if (adjustmentExternalKeys.has(result.externalKey)) {
      setAdjustmentSearchStatus('That pass is already in the adjustment list.')
      return
    }
    setRankAdjustments((current) => [
      ...current,
      {
        externalKey: result.externalKey,
        name: result.name,
        sport: sportFromCatalog(result.sport),
        season: result.seasonLabel.trim() || String(result.seasonYear),
        mode,
      },
    ])
    setAdjustmentSearchStatus(`Added ${result.name} — ${mode === 'assume-iconic-1' ? `assume ${RECOMMENDATION_SIMULATED_RARITY}` : 'exclude from ranking'}.`)
    setAdjustmentSearchQuery('')
    setAdjustmentSearchResults([])
  }

  const addOwnedCardAdjustment = (card: (typeof ownedAdjustableCards)[number]) => {
    if (!card.externalKey) {
      setAdjustmentSearchStatus(
        `${card.name} has no catalog link — use catalog search below or re-import with a linked pass.`,
      )
      return
    }
    addRankAdjustment({
      externalKey: card.externalKey,
      name: card.name,
      sport: card.sport,
      seasonLabel: card.season,
      seasonYear: 0,
    })
  }

  const addableFilteredOwnedCards = useMemo(
    () =>
      filteredOwnedQuickAddCards.filter(
        (card) => card.externalKey && !adjustmentExternalKeys.has(card.externalKey),
      ),
    [adjustmentExternalKeys, filteredOwnedQuickAddCards],
  )

  const addAllFilteredOwnedAdjustments = () => {
    if (addableFilteredOwnedCards.length === 0) {
      setAdjustmentSearchStatus(
        'No eligible passes to add — they may already be listed, lack a catalog link, or not match the filter.',
      )
      return
    }

    setRankAdjustments((current) => {
      const existingKeys = new Set(current.map((adjustment) => adjustment.externalKey))
      const next = [...current]
      for (const card of addableFilteredOwnedCards) {
        if (!card.externalKey || existingKeys.has(card.externalKey)) continue
        existingKeys.add(card.externalKey)
        next.push({
          externalKey: card.externalKey,
          name: card.name,
          sport: card.sport,
          season: card.season,
          mode: 'assume-iconic-1',
        })
      }
      return next
    })

    const skipped = filteredOwnedQuickAddCards.length - addableFilteredOwnedCards.length
    setAdjustmentSearchStatus(
      `Added ${addableFilteredOwnedCards.length} pass${addableFilteredOwnedCards.length === 1 ? '' : 'es'} as assume ${RECOMMENDATION_SIMULATED_RARITY}.${
        skipped > 0 ? ` Skipped ${skipped} without catalog link or already listed.` : ''
      }`,
    )
  }

  const removeRankAdjustment = (externalKey: string) => {
    setRankAdjustments((current) =>
      current.filter((adjustment) => adjustment.externalKey !== externalKey),
    )
  }

  const setRankAdjustmentMode = (
    externalKey: string,
    mode: RecommendationPassAdjustmentMode,
  ) => {
    setRankAdjustments((current) =>
      current.map((adjustment) =>
        adjustment.externalKey === externalKey ? { ...adjustment, mode } : adjustment,
      ),
    )
  }

  useEffect(() => {
    const trimmed = adjustmentSearchQuery.trim()
    if (trimmed.length < 2) {
      setAdjustmentSearchResults([])
      setAdjustmentSearchStatus('')
      setAdjustmentSearchBusy(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setAdjustmentSearchBusy(true)
      searchCatalog(trimmed, controller.signal)
        .then((result) => {
          if (!result.storageConfigured) {
            setAdjustmentSearchStatus('Shared catalog search is not configured yet.')
            setAdjustmentSearchResults([])
            return
          }
          const playerResults = result.results.filter((item) => item.passKind === 'player')
          setAdjustmentSearchResults(playerResults)
          setAdjustmentSearchStatus(
            playerResults.length === 0 ? 'No player passes match that search.' : '',
          )
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          setAdjustmentSearchResults([])
          setAdjustmentSearchStatus(error instanceof Error ? error.message : 'Catalog search failed.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setAdjustmentSearchBusy(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [adjustmentSearchQuery])

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

  const isBundlePickClaimable = (row: PassRecommendationRow) =>
    profileByKey.has(row.externalKey) &&
    !adjustmentExternalKeys.has(row.externalKey) &&
    !isRecommendationOwnedAtIconic(row.externalKey)

  const claimableBundlePicks = useMemo(
    () => recommendationBundle?.picks.filter(isBundlePickClaimable) ?? [],
    [recommendationBundle, profileByKey, adjustmentExternalKeys, data.cards],
  )

  const selectedClaimableBundlePicks = useMemo(
    () => claimableBundlePicks.filter((row) => bundleClaimSelection.has(row.externalKey)),
    [bundleClaimSelection, claimableBundlePicks],
  )

  useEffect(() => {
    if (!recommendationBundle) {
      setBundleClaimSelection(new Set())
      return
    }
    setBundleClaimSelection(
      new Set(
        recommendationBundle.picks
          .filter(isBundlePickClaimable)
          .map((row) => row.externalKey),
      ),
    )
  }, [recommendationBundle, profileByKey, adjustmentExternalKeys, data.cards])

  const toggleBundleClaimSelection = (externalKey: string) => {
    setBundleClaimSelection((current) => {
      const next = new Set(current)
      if (next.has(externalKey)) {
        next.delete(externalKey)
      } else {
        next.add(externalKey)
      }
      return next
    })
  }

  const assumeRecommendationPicks = async (rows: PassRecommendationRow[]) => {
    if (rows.length === 0) {
      setRankStatus('Select at least one pass to claim for ranking.')
      return
    }
    if (rankCatalogProfiles.length === 0) {
      setRankStatus('Run Rank catalog passes before claiming recommendations.')
      return
    }

    const missingProfile = rows.find((row) => !profileByKey.has(row.externalKey))
    if (missingProfile) {
      setRankStatus('Catalog profile is no longer loaded — run Rank catalog passes again.')
      return
    }

    const existingKeys = new Set(rankAdjustments.map((adjustment) => adjustment.externalKey))
    const additions = rows.filter((row) => !existingKeys.has(row.externalKey))
    if (additions.length === 0) {
      setRankStatus('Selected passes are already in your ranking baseline adjustments.')
      return
    }

    const nextAdjustments: RecommendationPassAdjustment[] = [
      ...rankAdjustments,
      ...additions.map((row) => ({
        externalKey: row.externalKey,
        name: row.name,
        sport: row.sport,
        season: row.season,
        mode: 'assume-iconic-1' as const,
      })),
    ]

    const combinedNet = additions.reduce((sum, row) => sum + row.netClaimableDelta, 0)
    const label =
      additions.length === 1
        ? additions[0]!.name
        : `${additions.length} passes`

    setBundleClaimInProgress(true)
    setRankStatus(`Assuming ${label} at ${RECOMMENDATION_SIMULATED_RARITY} for ranking…`)

    const prevAdjustments = rankAdjustments

    try {
      setRankAdjustments(nextAdjustments)

      const baselineAfterClaim = applyRecommendationBaseline(data, profileByKey, nextAdjustments)
      const caps = rankAllSports
        ? recommendationCapsForSports(includedRankSports)
        : recommendationCapsForSport(rankSport as Sport)

      setRankStatus('Recalculating greedy recommendations…')
      const bundle = await greedyPickBundleAsync(
        baselineAfterClaim,
        rankCatalogProfiles,
        bundleSize,
        {
          excludedSportSeasonKeys,
          adjustments: nextAdjustments,
          ...(rankAllSports ? { caps } : { sport: rankSport as Sport }),
          batchSize: 24,
        },
      )

      setRecommendationBundle(bundle)
      setRankStatus(
        `Assumed ${label} at ${RECOMMENDATION_SIMULATED_RARITY} (${formatSignedRax(displayRaxValue(combinedNet))} combined net) — ranking only. Showing next ${bundle.picks.length} greedy pick${bundle.picks.length === 1 ? '' : 's'}.`,
      )
    } catch (error) {
      setRankAdjustments(prevAdjustments)
      setRankStatus(error instanceof Error ? error.message : 'Could not assume recommendations.')
    } finally {
      setBundleClaimInProgress(false)
    }
  }

  const claimRecommendationPick = (row: PassRecommendationRow) => {
    void assumeRecommendationPicks([row])
  }

  const claimSelectedBundlePicks = () => {
    void assumeRecommendationPicks(selectedClaimableBundlePicks)
  }

  const claimAllBundlePicks = () => {
    void assumeRecommendationPicks(claimableBundlePicks)
  }

  const runCatalogRanking = async () => {
    rankAbortRef.current?.abort()
    sportOpportunityAbortRef.current?.abort()
    const controller = new AbortController()
    rankAbortRef.current = controller
    setRankingInProgress(true)
    setRankProgress(null)
    setRankStatus('')
    setRecommendationRows([])
    setRankResultsPage(1)
    setRecommendationBundle(null)
    setRecommendationMeta(null)
    setProfileByKey(new Map())
    setRankCatalogProfiles([])
    setBundleClaimSelection(new Set())

    const rankSports: Sport[] = rankAllSports ? includedRankSports : [rankSport]

    try {
      if (rankAllSports && rankSports.length === 0) {
        setRankStatus('Select at least one sport to rank.')
        return
      }

      const seasonFilter = {
        excludedSportSeasonKeys,
        adjustments: rankAdjustments,
      }
      let catalogCount = 0
      let skippedOwnedIconic = 0
      let skippedAdjusted = 0
      let fetchTrimmed = 0
      const candidateKeys: string[] = []
      const seenCandidateKeys = new Set<string>()

      const caps = rankAllSports
        ? recommendationCapsForSports(rankSports)
        : recommendationCapsForSport(rankSport)

      const { bySport, storageConfigured: summariesConfigured } = await loadSportCatalogSummaries(
        rankSports,
        (sport) => {
          const sportCaps = recommendationCapsForSport(sport)
          return Math.min(sportCaps.bulkFetchCap + 250, 1500)
        },
        controller.signal,
        (sport, sportIndex, total) => {
          setRankStatus(
            rankAllSports
              ? `Loading ${sport} catalog passes… (${sportIndex + 1}/${total})`
              : `Loading ${sport} catalog passes…`,
          )
        },
      )
      if (!summariesConfigured) {
        setRankStatus('Shared catalog is not configured yet.')
        return
      }

      for (const sport of rankSports) {
        const results = bySport.get(sport) ?? []
        catalogCount += results.length

        const selected = selectSummariesForBulkFetch(data, results, { ...seasonFilter, sport })
        skippedOwnedIconic += selected.skippedOwnedIconic
        skippedAdjusted += selected.skippedAdjusted
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

      const assumeIconicKeys = rankAdjustments
        .filter((adjustment) => adjustment.mode === 'assume-iconic-1')
        .map((adjustment) => adjustment.externalKey)
      const allProfileKeys = [...new Set([...candidateKeys, ...assumeIconicKeys])]

      setRankStatus(
        rankAllSports
          ? `Fetching earnings for ${allProfileKeys.length} passes across ${rankSports.length} sport${
              rankSports.length === 1 ? '' : 's'
            } (cap ${caps.bulkFetchCap} total)…`
          : `Fetching earnings for ${allProfileKeys.length} passes${
              fetchTrimmed > 0
                ? ` (top ${candidateKeys.length} by base RAX · cap ${caps.bulkFetchCap})`
                : ''
            }…`,
      )
      const reportBulkProgress = (loaded: number, total: number) => {
        setRankStatus(`Fetching earnings ${loaded}/${total} passes…`)
      }
      const { profiles, storageConfigured: bulkConfigured } = await fetchCatalogImportProfilesBulk(
        allProfileKeys,
        controller.signal,
        { onBatch: reportBulkProgress },
      )
      if (!bulkConfigured) {
        setRankStatus('Shared catalog is not configured yet.')
        return
      }

      const profileMap = new Map(profiles.map((profile) => [profile.externalKey, profile]))

      setProfileByKey(profileMap)
      setRankCatalogProfiles(profiles)

      const baselineData = applyRecommendationBaseline(data, profileMap, rankAdjustments)
      const baselineAdjustmentCount = rankAdjustments.filter(
        (adjustment) =>
          adjustment.mode === 'assume-iconic-1' &&
          (profileMap.get(adjustment.externalKey)?.rows.length ?? 0) > 0,
      ).length

      setRankStatus(`Analyzing top candidates at ${RECOMMENDATION_SIMULATED_RARITY} OTD…`)
      const { ranked, bundle } = await rankAndRecommendAsync(baselineData, profiles, bundleSize, {
        ...seasonFilter,
        ...(rankAllSports ? { caps } : { sport: rankSport }),
        signal: controller.signal,
        batchSize: 24,
        onProgress: setRankProgress,
      })

      setRecommendationRows(ranked.rows.slice(0, TOP_RANKING_RESULTS))
      setRankResultsPage(1)
      setRecommendationBundle(bundle)
      setRecommendationMeta({
        calculatedAt: new Date().toISOString(),
        skippedOwnedIconic: ranked.skippedOwnedIconic + skippedOwnedIconic,
        skippedAdjusted: skippedAdjusted + ranked.skippedAdjusted,
        skippedNoRows: ranked.skippedNoRows,
        catalogCount,
        fetchTrimmed,
        prefilterTrimmed: ranked.prefilterTrimmed,
        baselineAdjustmentCount,
      })
      const sportLabel = rankAllSports
        ? rankSports.length === SPORTS.length
          ? 'all sports'
          : rankSports.join(', ')
        : rankSport
      setRankStatus(
        `Ranked ${ranked.analyzedCount} pass${ranked.analyzedCount === 1 ? '' : 'es'} at ${RECOMMENDATION_SIMULATED_RARITY} for ${sportLabel} · showing top ${Math.min(TOP_RANKING_RESULTS, ranked.rows.length)}${
          excludedSportSeasons.length > 0
            ? ` · excluding ${excludedSportSeasons.map(formatExcludedSportSeason).join(', ')}`
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

  const rankResultsPageTotal = pageCount(recommendationRows.length, RANKING_PAGE_SIZE)
  const paginatedRecommendationRows = useMemo(
    () => paginate(recommendationRows, rankResultsPage, RANKING_PAGE_SIZE),
    [recommendationRows, rankResultsPage],
  )

  useEffect(() => {
    if (rankResultsPage > rankResultsPageTotal) {
      setRankResultsPage(rankResultsPageTotal)
    }
  }, [rankResultsPage, rankResultsPageTotal])

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
          higher for MLB and other large sports). The catalog may be incomplete or outdated. The
          recommended bundle uses a <strong>greedy</strong> pick: best pass first, then re-rank
          remaining candidates with each prior pick virtually added.
          {rankSport === ALL_SPORTS_RANK ? (
            <>
              {' '}
              <strong>All sports</strong> loads every sport&apos;s catalog, fetches each sport&apos;s
              top passes by base RAX, then ranks across the combined pool — expect long runtimes.
            </>
          ) : null}
        </p>

        <section className="panel nested-panel recommendation-adjustments">
          <div className="section-heading">
            <div>
              <h3>Ranking baseline adjustments</h3>
              <p>
                Temporarily change how your collection is treated for catalog ranking and the
                potential card analyzer below. Does not modify your saved cards.
              </p>
            </div>
            {rankAdjustments.length > 0 ? (
              <span className="badge">{rankAdjustments.length} adjusted</span>
            ) : null}
          </div>
          <p className="import-hint">
            <strong>Assume {RECOMMENDATION_SIMULATED_RARITY}</strong> — treat a pass as already at{' '}
            {RECOMMENDATION_SIMULATED_RARITY} in your collection (for passes you are upgrading, like
            a lower-tier Ashton Jeanty). Rankings for other passes use that baseline and the pass
            will not appear as a recommendation. <strong>Exclude</strong> — skip a pass from
            recommendations without adding it to your baseline.
          </p>

          {ownedAdjustableCards.length > 0 ? (
            <div className="recommendation-adjustment-owned">
              <div className="section-heading recommendation-adjustment-owned-heading">
                <div>
                  <h4>Quick add from your collection</h4>
                  <p className="import-hint">
                    All player passes below {RECOMMENDATION_SIMULATED_RARITY} in your saved
                    collection ({ownedAdjustableCards.length} total).
                  </p>
                </div>
                {ownedQuickAddFilter.trim() ? (
                  <span className="badge">
                    {filteredOwnedQuickAddCards.length} match
                    {filteredOwnedQuickAddCards.length === 1 ? '' : 'es'}
                  </span>
                ) : null}
              </div>
              <div className="sort-controls">
                <label className="field inline-field recommendation-adjustment-owned-search">
                  <span>Filter your collection</span>
                  <input
                    value={ownedQuickAddFilter}
                    disabled={catalogAnalysisBusy}
                    placeholder="Name, sport, season, or rarity"
                    onChange={(event) => setOwnedQuickAddFilter(event.target.value)}
                  />
                </label>
                <button
                  className="button"
                  type="button"
                  disabled={catalogAnalysisBusy || addableFilteredOwnedCards.length === 0}
                  onClick={addAllFilteredOwnedAdjustments}
                >
                  Add all{addableFilteredOwnedCards.length > 0 ? ` (${addableFilteredOwnedCards.length})` : ''}
                </button>
              </div>
              {filteredOwnedQuickAddCards.length > 0 ? (
                <div className="recommendation-adjustment-owned-list button-row wrap-row">
                  {filteredOwnedQuickAddCards.map((card) => {
                    const alreadyAdded = card.externalKey
                      ? adjustmentExternalKeys.has(card.externalKey)
                      : false
                    const missingCatalogLink = !card.externalKey
                    return (
                      <button
                        className="button compact"
                        type="button"
                        key={card.id}
                        disabled={catalogAnalysisBusy || alreadyAdded || missingCatalogLink}
                        title={
                          missingCatalogLink
                            ? 'No catalog link on this card — use catalog search below'
                            : alreadyAdded
                              ? 'Already in adjustment list'
                              : `Add ${card.name} as assume ${RECOMMENDATION_SIMULATED_RARITY}`
                        }
                        onClick={() => addOwnedCardAdjustment(card)}
                      >
                        {card.name}
                        {card.season ? ` · ${card.season}` : ''}
                        {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="empty">No collection passes match that filter.</p>
              )}
            </div>
          ) : null}

          <div className="sort-controls">
            <label className="field inline-field recommendation-adjustment-search">
              <span>Search catalog to add</span>
              <input
                value={adjustmentSearchQuery}
                disabled={catalogAnalysisBusy}
                placeholder="Player name, e.g. Ashton Jeanty"
                onChange={(event) => setAdjustmentSearchQuery(event.target.value)}
              />
            </label>
          </div>
          {adjustmentSearchBusy ? (
            <p className="import-hint">Searching catalog…</p>
          ) : null}
          {adjustmentSearchStatus ? <p className="import-status">{adjustmentSearchStatus}</p> : null}
          {adjustmentSearchResults.length > 0 ? (
            <div className="list recommendation-adjustment-search-results">
              {adjustmentSearchResults.slice(0, 8).map((result) => (
                <div className="list-row" key={result.externalKey}>
                  <span>
                    <strong>{result.name}</strong>
                    <small>
                      {sportFromCatalog(result.sport)} ·{' '}
                      {result.seasonLabel.trim() || result.seasonYear} ·{' '}
                      {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
                    </small>
                  </span>
                  <span className="button-row compact-actions">
                    <button
                      className="button compact"
                      type="button"
                      disabled={
                        catalogAnalysisBusy || adjustmentExternalKeys.has(result.externalKey)
                      }
                      onClick={() => addRankAdjustment(result, 'assume-iconic-1')}
                    >
                      Assume {RECOMMENDATION_SIMULATED_RARITY}
                    </button>
                    <button
                      className="button compact"
                      type="button"
                      disabled={
                        catalogAnalysisBusy || adjustmentExternalKeys.has(result.externalKey)
                      }
                      onClick={() => addRankAdjustment(result, 'exclude')}
                    >
                      Exclude
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {rankAdjustments.length > 0 ? (
            <div className="list recommendation-adjustment-list">
              {rankAdjustments.map((adjustment) => (
                <div className="list-row" key={adjustment.externalKey}>
                  <span>
                    <strong>{adjustment.name}</strong>
                    <small>
                      {adjustment.sport} · {adjustment.season}
                    </small>
                  </span>
                  <span className="button-row compact-actions">
                    <select
                      className="adjustment-mode-select"
                      value={adjustment.mode}
                      disabled={catalogAnalysisBusy}
                      onChange={(event) =>
                        setRankAdjustmentMode(
                          adjustment.externalKey,
                          event.target.value as RecommendationPassAdjustmentMode,
                        )
                      }
                    >
                      <option value="assume-iconic-1">Assume {RECOMMENDATION_SIMULATED_RARITY}</option>
                      <option value="exclude">Exclude from ranking</option>
                    </select>
                    <button
                      className="button danger compact"
                      type="button"
                      disabled={catalogAnalysisBusy}
                      onClick={() => removeRankAdjustment(adjustment.externalKey)}
                    >
                      Remove
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">No adjustments — ranking uses your collection as saved.</p>
          )}
        </section>

        <section className="panel nested-panel" id="sport-opportunity-scan">
          <div className="section-heading">
            <div>
              <h3>Sport opportunity scan</h3>
              <p>
                Compare every sport against your adjusted baseline and the shared catalog. Each
                sport is scored by how much <strong>net claimable RAX</strong> you could add with
                the top {SPORT_OPPORTUNITY_BUNDLE_SIZE} greedy catalog picks at{' '}
                {RECOMMENDATION_SIMULATED_RARITY}.
              </p>
            </div>
          </div>
          <p className="import-hint">
            Add quick-add or catalog baseline adjustments above first — the scan treats those as
            already at {RECOMMENDATION_SIMULATED_RARITY} when scoring your collection and
            recommendations. Uses a lighter pass than full ranking ({SPORT_OPPORTUNITY_FETCH_CAP}{' '}
            catalog passes fetched per sport). Excluded sport+season filters apply too.
          </p>
          <div className="sort-controls">
            <button
              className="button primary"
              type="button"
              disabled={catalogAnalysisBusy}
              onClick={() => void runSportOpportunityScan()}
            >
              {sportOpportunityInProgress ? 'Scanning sports…' : 'Analyze sport opportunities'}
            </button>
            {sportOpportunityInProgress ? (
              <button className="button" type="button" onClick={cancelSportOpportunityScan}>
                Cancel
              </button>
            ) : null}
          </div>
          {sportOpportunityStatus ? <p className="import-status">{sportOpportunityStatus}</p> : null}

          {sportOpportunityFocus && sportOpportunityResults.length > 0 ? (
            <p className="import-hint">
              <strong>Focus suggestion:</strong> {sportOpportunityFocus.sport}
              {sportOpportunityFocus.greedyCombinedNet > 0
                ? ` — up to ${formatSignedRax(displayRaxValue(sportOpportunityFocus.greedyCombinedNet))} combined net from ${sportOpportunityFocus.greedyPickCount} recommended pass${sportOpportunityFocus.greedyPickCount === 1 ? '' : 'es'}`
                : sportOpportunityFocus.bestSinglePassLabel
                  ? ` — best single add ${sportOpportunityFocus.bestSinglePassLabel} (${formatSignedRax(displayRaxValue(sportOpportunityFocus.bestSingleNet))} net)`
                  : ''}
              .{' '}
              <button
                className="link-button"
                type="button"
                onClick={() => focusSportForRanking(sportOpportunityFocus.sport)}
              >
                Rank {sportOpportunityFocus.sport} in depth
              </button>
            </p>
          ) : null}

          {sportOpportunityResults.length > 0 ? (
            <>
              {sportOpportunityCalculatedAt ? (
                <p className="import-hint">
                  Saved {new Date(sportOpportunityCalculatedAt).toLocaleString()} · sorted by
                  available net (greedy top {SPORT_OPPORTUNITY_BUNDLE_SIZE})
                  {sportOpportunityBaselineCount > 0
                    ? ` · ${sportOpportunityBaselineCount} pass${sportOpportunityBaselineCount === 1 ? '' : 'es'} assumed at ${RECOMMENDATION_SIMULATED_RARITY} in baseline`
                    : ''}
                  . Click a sport to open full ranking.
                </p>
              ) : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sport</th>
                      <th>Your claimable</th>
                      <th>Overlap waste</th>
                      <th>Available net</th>
                      <th>Best single</th>
                      <th>Top picks</th>
                      <th>Cards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sportOpportunityResults.map((row) => (
                      <tr key={row.sport}>
                        <td>
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => focusSportForRanking(row.sport)}
                          >
                            {row.sport}
                          </button>
                          {sportOpportunityFocus?.sport === row.sport ? (
                            <>
                              <br />
                              <small className="table-sub">Top focus</small>
                            </>
                          ) : null}
                        </td>
                        <td>{formatRax(displayRaxValue(row.currentClaimableRax))}</td>
                        <td>
                          {row.overlapRax > 0
                            ? formatRax(displayRaxValue(row.overlapRax))
                            : '—'}
                        </td>
                        <td>
                          <strong
                            className={
                              row.greedyCombinedNet > 0
                                ? 'sale-positive'
                                : row.greedyCombinedNet < 0
                                  ? 'sale-negative'
                                  : ''
                            }
                          >
                            {formatSignedRax(displayRaxValue(row.greedyCombinedNet))}
                          </strong>
                          {row.greedyPickCount > 0 ? (
                            <>
                              <br />
                              <small className="table-sub">
                                {row.greedyPickCount} pick{row.greedyPickCount === 1 ? '' : 'es'}
                              </small>
                            </>
                          ) : null}
                        </td>
                        <td>
                          {row.bestSinglePassLabel ? (
                            <>
                              {formatSignedRax(displayRaxValue(row.bestSingleNet))}
                              <br />
                              <small className="table-sub">{row.bestSinglePassLabel}</small>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {row.greedyPickLabels.length > 0 ? row.greedyPickLabels.join('; ') : '—'}
                        </td>
                        <td>{row.ownedCards}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>

        <div className="sort-controls">
          <label className="field inline-field">
            <span>Sport</span>
            <select
              value={rankSport}
              disabled={catalogAnalysisBusy}
              onChange={(event) => {
                const next = event.target.value
                setRankSport(next === ALL_SPORTS_RANK ? ALL_SPORTS_RANK : (next as Sport))
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
                disabled={catalogAnalysisBusy}
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
          <label className="field inline-field">
            <span>Bundle size</span>
            <input
              type="number"
              min={1}
              max={RECOMMENDATION_MAX_BUNDLE_SIZE}
              value={bundleSize}
              disabled={catalogAnalysisBusy}
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

        <section className="panel nested-panel recommendation-exclusions">
          <div className="section-heading recommendation-adjustment-owned-heading">
            <div>
              <h4>Exclude sport + season from ranking</h4>
              <p className="import-hint">
                Skip catalog passes for a specific sport and season (e.g. NFL · 2022-23 no longer on
                Real). Exclusions stay when you change the rank sport above.
              </p>
            </div>
            {excludedSportSeasons.length > 0 ? (
              <span className="badge">{excludedSportSeasons.length} excluded</span>
            ) : null}
          </div>
          <div className="sort-controls">
            <label className="field inline-field">
              <span>Sport</span>
              <select
                value={excludeFormSport}
                disabled={catalogAnalysisBusy}
                onChange={(event) => setExcludeFormSport(event.target.value as Sport)}
              >
                {SPORTS.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline-field">
              <span>Season</span>
              {excludeFormSeasonOptions.length > 0 ? (
                <select
                  value={excludeFormSeasonLabel}
                  disabled={catalogAnalysisBusy || excludeFormSeasonsLoading}
                  onChange={(event) => setExcludeFormSeasonLabel(event.target.value)}
                >
                  {excludeFormSeasonOptions.map((option) => (
                    <option key={option.seasonLabel} value={option.seasonLabel}>
                      {option.seasonLabel}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={excludeFormSeasonLabel}
                  disabled={catalogAnalysisBusy || excludeFormSeasonsLoading}
                  placeholder="e.g. 2022-23"
                  onChange={(event) => setExcludeFormSeasonLabel(event.target.value)}
                />
              )}
            </label>
            <button
              className="button"
              type="button"
              disabled={
                catalogAnalysisBusy ||
                excludeFormSeasonsLoading ||
                !excludeFormSeasonLabel.trim() ||
                excludedSportSeasons.some(
                  (entry) =>
                    entry.key ===
                    sportSeasonFilterKey(excludeFormSport, excludeFormSeasonLabel.trim()),
                )
              }
              onClick={addExcludedSportSeason}
            >
              Exclude pair
            </button>
          </div>
          {excludeFormSeasonsLoading ? (
            <p className="import-hint">Loading seasons for {excludeFormSport}…</p>
          ) : null}
          {excludedSportSeasons.length > 0 ? (
            <div className="list recommendation-adjustment-list">
              {excludedSportSeasons.map((entry) => (
                <div className="list-row" key={entry.key}>
                  <span>
                    <strong>{formatExcludedSportSeason(entry)}</strong>
                  </span>
                  <button
                    className="button danger compact"
                    type="button"
                    disabled={catalogAnalysisBusy}
                    onClick={() => removeExcludedSportSeason(entry.key)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">No exclusions — all catalog sport + season pairs are eligible.</p>
          )}
        </section>

        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={
              catalogAnalysisBusy ||
              (rankAllSports && includedRankSports.length === 0)
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

        {recommendationBundle ? (
          <section className="panel nested-panel">
            <div className="section-heading">
              <div>
                <h3>Recommended bundle (greedy)</h3>
                <p>
                  {recommendationBundle.picks.length > 0 ? (
                    <>
                      Top {recommendationBundle.picks.length} pass
                      {recommendationBundle.picks.length === 1 ? '' : 'es'} to add one at a time.
                      Claim assumes selected passes at {RECOMMENDATION_SIMULATED_RARITY} in your
                      ranking baseline — nothing is saved to your real collection. Each pick&apos;s
                      net is <strong>marginal</strong> (after prior picks in the bundle). After
                      claims, big jumps can happen when a pass fits open calendar days in the same
                      sport.
                    </>
                  ) : (
                    <>No more positive greedy picks with the current catalog pool and baseline.</>
                  )}
                </p>
              </div>
              {recommendationBundle.picks.length > 0 ? (
                <span className="badge">
                  {formatSignedRax(displayRaxValue(recommendationBundle.combinedNetDelta))} combined
                  net
                </span>
              ) : null}
            </div>
            {claimableBundlePicks.length > 0 ? (
              <div className="sort-controls bundle-claim-actions">
                <button
                  className="button primary"
                  type="button"
                  disabled={
                    catalogAnalysisBusy ||
                    selectedClaimableBundlePicks.length === 0
                  }
                  onClick={claimSelectedBundlePicks}
                >
                  {bundleClaimInProgress
                    ? 'Claiming…'
                    : `Claim selected (${selectedClaimableBundlePicks.length})`}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={catalogAnalysisBusy || claimableBundlePicks.length === 0}
                  onClick={claimAllBundlePicks}
                >
                  Claim all ({claimableBundlePicks.length})
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={catalogAnalysisBusy || claimableBundlePicks.length === 0}
                  onClick={() =>
                    setBundleClaimSelection(
                      new Set(claimableBundlePicks.map((row) => row.externalKey)),
                    )
                  }
                >
                  Select all
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={catalogAnalysisBusy || bundleClaimSelection.size === 0}
                  onClick={() => setBundleClaimSelection(new Set())}
                >
                  Clear
                </button>
              </div>
            ) : null}
            <div className="list">
              {recommendationBundle.picks.map((row, index) => {
                const alreadyOwned = isRecommendationOwnedAtIconic(row.externalKey)
                const alreadyAssumed = adjustmentExternalKeys.has(row.externalKey)
                const claimable = isBundlePickClaimable(row)
                const selected = bundleClaimSelection.has(row.externalKey)
                return (
                  <div className="list-row recommendation-bundle-row" key={row.externalKey}>
                    {claimable ? (
                      <label className="bundle-claim-check">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={catalogAnalysisBusy}
                          onChange={() => toggleBundleClaimSelection(row.externalKey)}
                        />
                      </label>
                    ) : (
                      <span className="bundle-claim-check-spacer" aria-hidden="true" />
                    )}
                    <button
                      className="link-button-row bundle-pick-main"
                      type="button"
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
                    <button
                      className="button compact primary"
                      type="button"
                      disabled={catalogAnalysisBusy || alreadyOwned || alreadyAssumed}
                      title={
                        alreadyAssumed
                          ? 'Already in ranking baseline adjustments'
                          : alreadyOwned
                            ? `Already in your collection at ${RECOMMENDATION_SIMULATED_RARITY}+`
                            : `Assume ${RECOMMENDATION_SIMULATED_RARITY} for ranking and recalculate the next ${bundleSize} greedy picks`
                      }
                      onClick={() => void claimRecommendationPick(row)}
                    >
                      {alreadyAssumed
                        ? 'In baseline'
                        : alreadyOwned
                          ? 'Owned'
                          : bundleClaimInProgress
                            ? 'Claiming…'
                            : 'Claim'}
                    </button>
                  </div>
                )
              })}
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
                {recommendationMeta.skippedAdjusted > 0
                  ? ` · ${recommendationMeta.skippedAdjusted} skipped by your adjustments`
                  : ''}
                {recommendationMeta.baselineAdjustmentCount > 0
                  ? ` · ${recommendationMeta.baselineAdjustmentCount} assumed at ${RECOMMENDATION_SIMULATED_RARITY} in baseline`
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
                  {paginatedRecommendationRows.map((row, index) => {
                    const rankNumber = (rankResultsPage - 1) * RANKING_PAGE_SIZE + index + 1
                    return (
                    <tr key={row.externalKey}>
                      <td>{rankNumber}</td>
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
                    )
                  })}
                </tbody>
              </table>
            </div>
            {recommendationRows.length > RANKING_PAGE_SIZE ? (
              <div className="table-pagination">
                <button
                  className="button"
                  type="button"
                  disabled={rankResultsPage <= 1}
                  onClick={() => setRankResultsPage((page) => page - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {rankResultsPage} of {rankResultsPageTotal} ·{' '}
                  {recommendationRows.length} passes
                </span>
                <button
                  className="button"
                  type="button"
                  disabled={rankResultsPage >= rankResultsPageTotal}
                  onClick={() => setRankResultsPage((page) => page + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
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
        <PotentialAnalysisResults
          analysis={potentialAnalysis}
          previewAs={form.previewAs}
          baselineAdjustmentCount={potentialBaselineAdjustmentCount}
        />
      ) : null}
    </div>
  )
}
