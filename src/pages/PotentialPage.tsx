import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
import CollapsiblePanel from '../components/CollapsiblePanel'
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
import { computeYearRollup } from '../lib/claimOptimizer'
import { sportFromCatalog } from '../lib/catalogImport'
import { catalogProfileToFilteredJson } from '../lib/catalogProfileJson'
import { formatClaimDay, formatRax, todayIsoLocal } from '../lib/format'
import {
  analyzePotentialCard,
  netWithProDelta,
  type PotentialAnalysisResult,
  type PotentialClaimDayBreakdown,
  type PotentialClaimLadderEntry,
} from '../lib/potentialAnalysis'
import {
  analyzeIconic20CheckerImpacts,
  analyzeCatalogBundleImpacts,
  analyzeOwnedIconicUpgradeImpacts,
  applyRecommendationBaseline,
  catalogProfileToIconic20CheckerCandidate,
  countAppliedBaselineAdjustments,
  iconic20CatalogSelectionKey,
  iconic20OwnedSelectionKey,
  ICONIC_20_SIMULATED_RARITY,
  isAtLeastIconic1Rarity,
  isIconicBelowLevel,
  isPassInRecommendationAdjustments,
  isRecommendationPassOwnedAtIconic,
  ownedCardToIconic20CheckerCandidate,
  ownedCardToIconicUpgradeCandidate,
  type OwnedIconicUpgradeCandidate,
  rankAndRecommendAsync,
  rankCatalogRecommendationsForMonthAsync,
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
  type MonthPassRecommendationRow,
} from '../lib/passRecommendation'
import { CALENDAR_MONTH_NAMES } from '../lib/calendarView'
import { monthIndexFromClaimDay } from '../lib/claimDayKey'
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
import { realappToolsShutdownLabel, realProviderImportEnabled } from '../lib/importShutdown'
import { formatSignedRax } from '../lib/removeCardAnalysis'
import { parseRealAppToolsRows, type ParsedRealAppToolsRow } from '../lib/realAppToolsImport'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { useRaxData } from '../context/RaxDataContext'
import { plannedPassFromRecommendationRow } from '../lib/plannedPasses'
import { isPlayerLikeCatalogPass, isPlayerPass, isUfcCatalogSport } from '../lib/passKind'
import { SPORTS, type RaxTrackerData, type Sport } from '../types/rax'

const TOP_RANKING_RESULTS = 50
const MONTH_BOOST_PAGE_SIZE = 10
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
          { sport, limit: summaryLimitForSport(sport) },
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
  previewAs: RECOMMENDATION_SIMULATED_RARITY,
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

function claimStatusLabel(status: string): string {
  switch (status) {
    case 'guaranteed':
      return 'Guaranteed'
    case 'pro-bonus':
      return 'Pro bonus'
    case 'overlap':
      return 'Overlap'
    default:
      return status
  }
}

function PotentialCandidateRow({ entry }: { entry: PotentialClaimLadderEntry }) {
  return (
    <div
      className={`claim-row ${entry.statusAfter}${entry.isPotential ? ' is-potential' : ''}`}
    >
      <span>
        <strong>{entry.name}</strong>
        <small>
          rank #{entry.rankInSport}
          {entry.season ? ` · ${entry.season}` : ''}
          {entry.isPotential ? ' · potential pass' : ''}
          {entry.statusBefore && entry.statusBefore !== entry.statusAfter
            ? ` · was ${claimStatusLabel(entry.statusBefore).toLowerCase()}`
            : null}
          {entry.raxDelta !== 0 ? (
            <>
              {' · '}
              <span className={entry.raxDelta > 0 ? 'sale-positive' : 'sale-negative'}>
                {formatSignedRax(displayRaxValue(entry.raxDelta))} net
              </span>
            </>
          ) : null}
        </small>
      </span>
      <b>{formatRax(displayRaxValue(entry.raxEarned))} RAX</b>
    </div>
  )
}

function PotentialOverlapSection({ overlaps }: { overlaps: PotentialClaimLadderEntry[] }) {
  const [open, setOpen] = useState(false)
  const overlapRax = overlaps.reduce((sum, entry) => sum + entry.raxEarned, 0)

  if (overlaps.length === 0) {
    return <p className="empty overlap-empty">No overlap in this sport.</p>
  }

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
        <span>
          Overlaps ({overlaps.length}) · {formatRax(displayRaxValue(overlapRax))} RAX
        </span>
      </button>
      {open ? (
        <div className="overlap-list">
          {overlaps.map((entry) => (
            <PotentialCandidateRow entry={entry} key={`${entry.cardId}-${entry.rankInSport}`} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PotentialDayPanel({ day }: { day: PotentialClaimDayBreakdown }) {
  return (
    <article className="day-panel compact-day-panel">
      <div className="section-heading">
        <div>
          <h3>
            <Link to={`/calendar?monthDay=${day.claimDay}`}>{formatClaimDay(day.claimDay)}</Link>
          </h3>
          <p>
            {formatSignedRax(displayRaxValue(day.dayNetDelta))} net · {day.monthLabel} · top 2 per
            sport + Pro bonus
          </p>
        </div>
        <span className="badge">{formatSignedRax(displayRaxValue(day.dayNetDelta))}</span>
      </div>

      {day.proBonusBefore?.cardId !== day.proBonusAfter?.cardId ? (
        <p className="mini-heading potential-probonus-note">
          Pro bonus:{' '}
          {day.proBonusBefore
            ? `${day.proBonusBefore.name} (${formatRax(displayRaxValue(day.proBonusBefore.raxEarned))})`
            : 'none'}{' '}
          →{' '}
          {day.proBonusAfter
            ? `${day.proBonusAfter.name} (${formatRax(displayRaxValue(day.proBonusAfter.raxEarned))})`
            : 'none'}
        </p>
      ) : day.proBonusAfter ? (
        <p className="mini-heading potential-probonus-note">
          Pro: {day.proBonusAfter.name} · {formatRax(displayRaxValue(day.proBonusAfter.raxEarned))} RAX
        </p>
      ) : null}

      <div className="sport-grid">
        {day.sports.map((sportBlock) => {
          const guaranteed = sportBlock.ladder.filter((entry) => entry.statusAfter === 'guaranteed')
          const overlaps = sportBlock.ladder.filter((entry) => entry.statusAfter !== 'guaranteed')

          return (
            <section className="sport-card" key={`${day.claimDay}-${sportBlock.sport}`}>
              <h3>
                {sportBlock.sport}
                {sportBlock.sportNetDelta !== 0 ? (
                  <small className="sport-net-chip">
                    {' '}
                    · {formatSignedRax(displayRaxValue(sportBlock.sportNetDelta))}
                  </small>
                ) : null}
              </h3>
              <p className="mini-heading">Top two claims</p>
              {guaranteed.length > 0 ? (
                guaranteed.map((entry) => (
                  <PotentialCandidateRow
                    entry={entry}
                    key={`${entry.cardId}-${entry.rankInSport}`}
                  />
                ))
              ) : (
                <p className="empty">No claims for this sport.</p>
              )}
              <PotentialOverlapSection overlaps={overlaps} />
            </section>
          )
        })}
      </div>
    </article>
  )
}

function PotentialClaimDayBreakdownPanel({
  breakdowns,
  netCollectionDelta,
}: {
  breakdowns: PotentialClaimDayBreakdown[]
  netCollectionDelta: number
}) {
  if (breakdowns.length === 0) return null

  const totalFromDays = breakdowns.reduce((sum, day) => sum + day.dayNetDelta, 0)
  const defaultOpenDay = breakdowns.length === 1

  return (
    <CollapsibleAnalysisSection
      defaultOpen
      label={`Claim days (${breakdowns.length}) · ${formatSignedRax(displayRaxValue(totalFromDays))} net`}
    >
      <p className="import-hint">
        Same layout as <Link to="/calendar">Calendar</Link> — top 2 per sport, overlaps collapsed.
        Expand a day to see ranks and net changes.
      </p>
      <div className="potential-claim-days">
        {breakdowns.map((day) => (
          <CollapsibleAnalysisSection
            defaultOpen={defaultOpenDay}
            key={day.claimDay}
            label={`${formatClaimDay(day.claimDay)} · ${formatSignedRax(displayRaxValue(day.dayNetDelta))} net · ${day.sports.map((sport) => sport.sport).join(', ')}`}
          >
            <PotentialDayPanel day={day} />
          </CollapsibleAnalysisSection>
        ))}
      </div>
      {totalFromDays !== netCollectionDelta ? (
        <p className="import-hint">
          Day totals sum to {formatSignedRax(displayRaxValue(totalFromDays))}; summary net is{' '}
          {formatSignedRax(displayRaxValue(netCollectionDelta))}.
        </p>
      ) : null}
    </CollapsibleAnalysisSection>
  )
}

function signedRaxClass(value: number): string {
  if (value > 0) return 'sale-positive'
  if (value < 0) return 'sale-negative'
  return ''
}

function claimableProBonusShare(total: number, proBonus: number): string {
  if (proBonus <= 0) return 'none from this pass'
  if (total <= 0) return 'Pro bonus only'
  return `${Math.round((proBonus / total) * 100)}% of claimable`
}

function CheckerNetGainMetrics({
  baselineGuaranteed,
  baselineWithPro,
  combinedWithProNetDelta,
  baselineLabel = 'Baseline collection',
  afterLabel = 'After simulation',
  netGainDetail = 'total',
  passClaimable,
  passClaimableLabel = 'Pass claimable after upgrade',
}: {
  baselineGuaranteed: number
  baselineWithPro: number
  combinedGuaranteedNetDelta: number
  combinedWithProNetDelta: number
  baselineLabel?: string
  afterLabel?: string
  netGainDetail?: string
  passClaimable?: { guaranteed: number; withPro: number }
  passClaimableLabel?: string
}) {
  const netDelta = combinedWithProNetDelta
  const passTotal = passClaimable?.withPro ?? null
  const passGuaranteed = passClaimable?.guaranteed ?? null
  const passProBonus =
    passClaimable != null ? Math.max(0, passClaimable.withPro - passClaimable.guaranteed) : null

  return (
    <>
      <p className="import-hint">
        Net gain includes top 2 guaranteed slots per sport plus any Pro bonus slots (always
        simulated).
      </p>
      <div className="owned-upgrade-analysis-metrics">
        <div className="metric-card">
          <span>{baselineLabel}</span>
          <strong>{formatRax(displayRaxValue(baselineWithPro))}</strong>
          <small>
            {formatRax(displayRaxValue(baselineGuaranteed))} guaranteed · rest Pro bonus
          </small>
        </div>
        <div className="metric-card">
          <span>{afterLabel}</span>
          <strong>{formatRax(displayRaxValue(baselineWithPro + netDelta))}</strong>
          <small>claimable after simulation</small>
        </div>
        {passTotal != null && passGuaranteed != null && passProBonus != null ? (
          <>
            <div className="metric-card">
              <span>{passClaimableLabel}</span>
              <strong>{formatRax(displayRaxValue(passTotal))}</strong>
              <small>guaranteed + Pro bonus</small>
            </div>
            <div className="metric-card">
              <span>Pass — guaranteed</span>
              <strong>{formatRax(displayRaxValue(passGuaranteed))}</strong>
              <small>top 2 per sport</small>
            </div>
            <div className="metric-card">
              <span>Pass — Pro bonus</span>
              <strong>{formatRax(displayRaxValue(passProBonus))}</strong>
              <small>{claimableProBonusShare(passTotal, passProBonus)}</small>
            </div>
          </>
        ) : null}
        <div className="metric-card highlight">
          <span>Net gain</span>
          <strong className={signedRaxClass(netDelta)}>
            {formatSignedRax(displayRaxValue(netDelta))}
          </strong>
          <small>{netGainDetail}</small>
        </div>
      </div>
    </>
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
  const netCollectionDelta = netWithProDelta(analysis)
  const displacedRax = analysis.displacedRax
  const displacedByCard = analysis.displacedByCard
  const displacedCardCount = displacedByCard.length

  return (
    <>
      <p className="import-hint">
        Net gain from top 2 per sport plus any Pro bonus slots this pass would earn. Pro bonus is
        always simulated here.
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

      <PotentialClaimDayBreakdownPanel
        breakdowns={analysis.claimDayBreakdowns}
        netCollectionDelta={netCollectionDelta}
      />

      <div className="stats-grid potential-summary-grid">
        <article className="stat-card panel">
          <span>New card — claimable</span>
          <strong>{formatRax(displayRaxValue(analysis.claimableRax))}</strong>
          <small className="table-sub">Guaranteed + Pro bonus</small>
        </article>
        <article className="stat-card panel">
          <span>Guaranteed claims</span>
          <strong>{formatRax(displayRaxValue(analysis.guaranteedRax))}</strong>
          <small className="table-sub">Top 2 per sport</small>
        </article>
        <article className="stat-card panel">
          <span>Pro bonus</span>
          <strong>{formatRax(displayRaxValue(analysis.proBonusRax))}</strong>
          <small className="table-sub">
            {claimableProBonusShare(analysis.claimableRax, analysis.proBonusRax)}
          </small>
        </article>
        <article className="stat-card panel">
          <span>New card — overlap only</span>
          <strong>{formatRax(displayRaxValue(analysis.overlapRax))}</strong>
          <small className="table-sub">Would not count if added</small>
        </article>
        <article className="stat-card panel">
          <span>Existing cards lost</span>
          <strong className="sale-negative">−{formatRax(displayRaxValue(displacedRax))}</strong>
          <small className="table-sub">
            {displacedCardCount} card{displacedCardCount === 1 ? '' : 's'} pushed to overlap
          </small>
        </article>
        <article className="stat-card panel highlight">
          <span>Net gain</span>
          <strong className={signedRaxClass(netCollectionDelta)}>
            {formatSignedRax(displayRaxValue(netCollectionDelta))}
          </strong>
          <small className="table-sub">New claimable − displaced</small>
        </article>
      </div>

      <CollapsibleAnalysisSection
        defaultOpen
        label={
          displacedCardCount === 0
            ? 'Most displaced existing cards (none)'
            : `Most displaced existing cards (${displacedCardCount}) · −${formatRax(displayRaxValue(displacedRax))} RAX lost`
        }
      >
        {displacedCardCount === 0 ? (
          <p className="empty overlap-empty">
            No currently claimable cards would be pushed to overlap.
          </p>
        ) : (
          <>
            <p className="import-hint">
              Ranked by total RAX lost across OTD days (guaranteed + Pro bonus).
            </p>
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
                  {displacedByCard.map((row, index) => (
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
                      {displacedByCard.reduce((sum, row) => sum + row.daysDisplaced, 0)}
                    </td>
                    <td>
                      <strong className="sale-negative">
                        −{formatRax(displayRaxValue(displacedRax))}
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
            Per calendar month: claimable from the new card minus existing cards pushed to overlap
            (guaranteed + Pro bonus).
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
                      <strong className={signedRaxClass(row.netDelta)}>
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
    </>
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
  soloPreviewRarity: string,
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
      previewAs: soloPreviewRarity,
    })
    const storedRows = profile.storedRowCount ?? 0
    setters.setStatus(
      storedRows > 0
        ? `${profile.name} has ${storedRows} stored catalog row${storedRows === 1 ? '' : 's'} for season ${profile.seasonLabel || profile.seasonYear}, but none are valid after season filtering — re-import this pass in Admin (Meowbot or realapp JSON), or paste earnings manually below.`
        : `${profile.name} is in the catalog but has no daily RAX rows yet — re-import in Admin or paste earnings manually below.`,
    )
    return false
  }

  const sport = sportFromCatalog(profile.sport)
  const passKind = isUfcCatalogSport(profile.sport) ? 'player' : profile.passKind
  const rawJson = catalogProfileToFilteredJson(profile)
  const parsed = parseRealAppToolsRows(rawJson, {
    sport,
    passKind,
  })
  setters.setEditingId(null)
  setters.setPotentialRows(parsed.rows)
  setters.setForm({
    name: profile.name,
    sport,
    season: profile.seasonLabel || String(profile.seasonYear),
    notes: 'Loaded from shared Meowbot catalog',
    rawJson,
    previewAs: soloPreviewRarity,
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

const POTENTIAL_RARITY_OPTIONS = RARITY_PREVIEW_OPTIONS.filter((option) => option.length > 0)

export default function PotentialPage() {
  const { data, addPotentialCard, updatePotentialCard, deletePotentialCard, addPlannedPass, addPlannedPassFromCatalog } = useRaxData()
  const [form, setForm] = useState(EMPTY_FORM)
  const [potentialRows, setPotentialRows] = useState<ParsedRealAppToolsRow[]>([])
  const [status, setStatus] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [catalogLoadingKey, setCatalogLoadingKey] = useState('')
  const [potentialBundleSelection, setPotentialBundleSelection] = useState<Set<string>>(new Set())
  const [potentialBundleProfilesByKey, setPotentialBundleProfilesByKey] = useState<
    Map<string, CatalogImportProfile>
  >(new Map())
  const [potentialBundleProfilesLoading, setPotentialBundleProfilesLoading] = useState(false)
  const [potentialBundleRarity, setPotentialBundleRarity] = useState(RECOMMENDATION_SIMULATED_RARITY)
  const [catalogRankOpen, setCatalogRankOpen] = useState(false)
  const [monthBoostOpen, setMonthBoostOpen] = useState(false)
  const [monthBoostSport, setMonthBoostSport] = useState<RankSportChoice>('FC')
  const [monthBoostExcludedSports, setMonthBoostExcludedSports] = useState<Sport[]>([])
  const [monthBoostMonthIdx, setMonthBoostMonthIdx] = useState(() => {
    const idx = monthIndexFromClaimDay(todayIsoLocal())
    return idx >= 0 ? idx : 0
  })
  const [monthBoostInProgress, setMonthBoostInProgress] = useState(false)
  const [monthBoostProgress, setMonthBoostProgress] = useState<PassRecommendationProgress | null>(
    null,
  )
  const [monthBoostStatus, setMonthBoostStatus] = useState('')
  const [monthBoostAllRows, setMonthBoostAllRows] = useState<MonthPassRecommendationRow[]>([])
  const [monthBoostVisibleCount, setMonthBoostVisibleCount] = useState(MONTH_BOOST_PAGE_SIZE)
  const [monthBoostMeta, setMonthBoostMeta] = useState<{
    calculatedAt: string
    skippedOwnedIconic: number
    skippedAdjusted: number
    skippedNoRows: number
    catalogCount: number
    fetchTrimmed: number
    prefilterTrimmed: number
    baselineAdjustmentCount: number
    monthIdx: number
    month: string
  } | null>(null)
  const [baselineAdjustmentsOpen, setBaselineAdjustmentsOpen] = useState(false)
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
  const [rankingClaimSelection, setRankingClaimSelection] = useState<Set<string>>(new Set())
  const [rankAdjustments, setRankAdjustments] = useState<RecommendationPassAdjustment[]>([])
  const [ownedQuickAddFilter, setOwnedQuickAddFilter] = useState('')
  const [quickAddAnalysisSelection, setQuickAddAnalysisSelection] = useState<Set<string>>(
    () => new Set(),
  )
  const [iconic20OwnedFilter, setIconic20OwnedFilter] = useState('')
  const [iconic20CatalogSearchQuery, setIconic20CatalogSearchQuery] = useState('')
  const [iconic20CatalogSearchResults, setIconic20CatalogSearchResults] = useState<
    CatalogSearchResult[]
  >([])
  const [iconic20CatalogSearchBusy, setIconic20CatalogSearchBusy] = useState(false)
  const [iconic20CatalogSearchStatus, setIconic20CatalogSearchStatus] = useState('')
  const [iconic20Selection, setIconic20Selection] = useState<Set<string>>(() => new Set())
  const [iconic20ProfilesByKey, setIconic20ProfilesByKey] = useState<
    Map<string, CatalogImportProfile>
  >(new Map())
  const [iconic20ProfilesLoading, setIconic20ProfilesLoading] = useState(false)
  const [adjustmentSearchQuery, setAdjustmentSearchQuery] = useState('')
  const [adjustmentSearchResults, setAdjustmentSearchResults] = useState<CatalogSearchResult[]>([])
  const [adjustmentSearchBusy, setAdjustmentSearchBusy] = useState(false)
  const [adjustmentSearchStatus, setAdjustmentSearchStatus] = useState('')
  const [adjustmentProfilesByKey, setAdjustmentProfilesByKey] = useState<
    Map<string, CatalogImportProfile>
  >(new Map())
  const rankAbortRef = useRef<AbortController | null>(null)
  const monthBoostAbortRef = useRef<AbortController | null>(null)
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

  const catalogAnalysisBusy =
    rankingInProgress ||
    monthBoostInProgress ||
    sportOpportunityInProgress ||
    bundleClaimInProgress ||
    iconic20ProfilesLoading

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


  const potentialBaselineWithPro = useMemo(
    () => ({
      ...potentialBaselineData,
      settings: { ...potentialBaselineData.settings, proBonusEnabled: true },
    }),
    [potentialBaselineData],
  )

  const potentialCollectionGuaranteed = useMemo(
    () => computeYearRollup(potentialBaselineWithPro).totalGuaranteedRax,
    [potentialBaselineWithPro],
  )

  const potentialCollectionWithPro = useMemo(
    () => computeYearRollup(potentialBaselineWithPro).totalClaimableRax,
    [potentialBaselineWithPro],
  )

  const potentialBundleProfiles = useMemo(
    () =>
      [...potentialBundleSelection]
        .map((externalKey) => potentialBundleProfilesByKey.get(externalKey))
        .filter((profile): profile is CatalogImportProfile => Boolean(profile?.rows.length)),
    [potentialBundleProfilesByKey, potentialBundleSelection],
  )

  const potentialBundleAnalysis = useMemo(() => {
    if (potentialBundleProfiles.length === 0) return null
    return analyzeCatalogBundleImpacts(
      potentialBaselineData,
      potentialBundleProfiles,
      potentialBundleRarity,
    )
  }, [potentialBaselineData, potentialBundleProfiles, potentialBundleRarity])

  const potentialAnalysis = useMemo(
    () =>
      analyzePotentialCard(
        potentialBaselineData,
        {
          name: form.name,
          sport: form.sport,
          season: form.season,
          simulatedRarityLabel: form.previewAs || RECOMMENDATION_SIMULATED_RARITY,
          passKind: 'player',
        },
        potentialRows,
      ),
    [form.name, form.previewAs, form.season, form.sport, potentialBaselineData, potentialRows],
  )

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setPotentialRows([])
    setEditingId(null)
    setStatus('')
  }

  const togglePotentialBundle = (result: CatalogSearchResult) => {
    if (result.rowCount === 0) return
    setPotentialBundleSelection((current) => {
      const next = new Set(current)
      if (next.has(result.externalKey)) {
        next.delete(result.externalKey)
      } else {
        next.add(result.externalKey)
      }
      return next
    })
  }

  const goToBaselineAdjustments = () => {
    setCatalogRankOpen(true)
    setBaselineAdjustmentsOpen(true)
    window.setTimeout(() => {
      document.getElementById('recommendation-adjustments')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }

  const submitAnalyze = (event: FormEvent) => {
    event.preventDefault()
    try {
      const parsed = parseRealAppToolsRows(form.rawJson, {
        sport: form.sport,
        passKind: 'player',
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
      simulatedRarityLabel: form.previewAs || RECOMMENDATION_SIMULATED_RARITY,
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
      previewAs: saved.simulatedRarityLabel ?? RECOMMENDATION_SIMULATED_RARITY,
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

  const loadFromCatalog = async (result: CatalogSearchResult, _rarityLabel = '') => {
    const soloPreviewRarity = form.previewAs || RECOMMENDATION_SIMULATED_RARITY
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
      applyCatalogProfileToForm(
        profile,
        {
          setEditingId,
          setPotentialRows,
          setForm,
          setStatus,
        },
        soloPreviewRarity,
      )
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
    const soloPreviewRarity = form.previewAs || RECOMMENDATION_SIMULATED_RARITY
    applyCatalogProfileToForm(
      profile,
      {
        setEditingId,
        setPotentialRows,
        setForm,
        setStatus,
      },
      soloPreviewRarity,
    )
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

  const cancelMonthBoostRanking = () => {
    monthBoostAbortRef.current?.abort()
    monthBoostAbortRef.current = null
    setMonthBoostInProgress(false)
    setMonthBoostProgress(null)
    setMonthBoostStatus('Month boost ranking cancelled.')
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
    monthBoostAbortRef.current?.abort()
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
          { sport, limit: SPORT_OPPORTUNITY_SUMMARY_LIMIT },
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

    fetchCatalogSeasonYears({ sport: excludeFormSport })
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

  const ownedIconic20EligibleCards = useMemo(
    () =>
      [...data.cards]
        .filter(
          (card) =>
            isPlayerPass(card) &&
            card.externalKey &&
            isIconicBelowLevel(card.rarityLabel, 20),
        )
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            a.sport.localeCompare(b.sport) ||
            a.season.localeCompare(b.season),
        ),
    [data.cards],
  )

  const filteredIconic20OwnedCards = useMemo(() => {
    const query = iconic20OwnedFilter.trim().toLowerCase()
    if (!query) return ownedIconic20EligibleCards
    return ownedIconic20EligibleCards.filter((card) => {
      const haystack = [card.name, card.sport, card.season, card.rarityLabel ?? '', card.externalKey ?? '']
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [ownedIconic20EligibleCards, iconic20OwnedFilter])

  const ownedCollectionExternalKeys = useMemo(
    () => new Set(data.cards.map((card) => card.externalKey).filter(Boolean) as string[]),
    [data.cards],
  )

  const iconic20AnalysisCandidates = useMemo(() => {
    const cardsByKey = new Map(
      ownedIconic20EligibleCards
        .filter((card): card is (typeof ownedIconic20EligibleCards)[number] & { externalKey: string } =>
          Boolean(card.externalKey),
        )
        .map((card) => [iconic20OwnedSelectionKey(card.externalKey), card] as const),
    )
    const candidates = [...iconic20Selection]
      .map((selectionKey) => {
        if (selectionKey.startsWith('owned:')) {
          const card = cardsByKey.get(selectionKey)
          return card ? ownedCardToIconic20CheckerCandidate(card) : null
        }
        if (selectionKey.startsWith('catalog:')) {
          const externalKey = selectionKey.slice('catalog:'.length)
          const profile = iconic20ProfilesByKey.get(externalKey)
          return profile ? catalogProfileToIconic20CheckerCandidate(profile) : null
        }
        return null
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    return candidates
  }, [iconic20Selection, ownedIconic20EligibleCards, iconic20ProfilesByKey])

  const iconic20Analysis = useMemo(
    () => analyzeIconic20CheckerImpacts(data, iconic20AnalysisCandidates),
    [data, iconic20AnalysisCandidates],
  )

  const selectedIconic20PassLabels = useMemo(
    () =>
      iconic20AnalysisCandidates.map((candidate) => {
        const sourceLabel = candidate.source === 'owned' ? 'upgrade' : 'new'
        return `${candidate.name} (${candidate.sport} · ${candidate.season} · ${sourceLabel})`
      }),
    [iconic20AnalysisCandidates],
  )

  const toggleIconic20Selection = (selectionKey: string) => {
    setIconic20Selection((current) => {
      const next = new Set(current)
      if (next.has(selectionKey)) {
        next.delete(selectionKey)
      } else {
        next.add(selectionKey)
      }
      return next
    })
  }

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
      const haystack = [card.name, card.sport, card.season, card.rarityLabel ?? '', card.externalKey ?? '']
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [ownedAdjustableCards, ownedQuickAddFilter])

  const addRankAdjustment = (
    result: Pick<CatalogSearchResult, 'externalKey' | 'name' | 'sport' | 'seasonLabel' | 'seasonYear'>,
    mode: RecommendationPassAdjustmentMode = 'assume-iconic-1',
  ) => {
    if (isPassInRecommendationAdjustments(result, rankAdjustments)) {
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

  const addableFilteredOwnedCards = useMemo(
    () =>
      filteredOwnedQuickAddCards.filter(
        (card) =>
          card.externalKey &&
          !isPassInRecommendationAdjustments(
            {
              externalKey: card.externalKey,
              name: card.name,
              sport: card.sport,
              season: card.season,
              seasonYear: 0,
              passKind: card.passKind ?? 'player',
            },
            rankAdjustments,
          ),
      ),
    [filteredOwnedQuickAddCards, rankAdjustments],
  )

  const quickAddAnalysisCandidates = useMemo((): OwnedIconicUpgradeCandidate[] => {
    const cardsByKey = new Map(
      filteredOwnedQuickAddCards
        .filter((card): card is (typeof ownedAdjustableCards)[number] & { externalKey: string } =>
          Boolean(card.externalKey),
        )
        .map((card) => [card.externalKey, card] as const),
    )
    return [...quickAddAnalysisSelection]
      .map((key) => {
        const card = cardsByKey.get(key)
        return card ? ownedCardToIconicUpgradeCandidate(card) : null
      })
      .filter((candidate): candidate is OwnedIconicUpgradeCandidate => candidate !== null)
  }, [filteredOwnedQuickAddCards, ownedAdjustableCards, quickAddAnalysisSelection])

  const quickAddAnalysis = useMemo(
    () => analyzeOwnedIconicUpgradeImpacts(data, quickAddAnalysisCandidates),
    [data, quickAddAnalysisCandidates],
  )

  const collectionDataWithPro = useMemo(
    () => ({
      ...data,
      settings: { ...data.settings, proBonusEnabled: true },
    }),
    [data],
  )

  const collectionGuaranteedNow = useMemo(
    () => computeYearRollup(collectionDataWithPro).totalGuaranteedRax,
    [collectionDataWithPro],
  )

  const collectionWithProNow = useMemo(
    () => computeYearRollup(collectionDataWithPro).totalClaimableRax,
    [collectionDataWithPro],
  )

  const selectedUpgradePassLabels = useMemo(
    () =>
      quickAddAnalysisCandidates.map(
        (candidate) => `${candidate.name} (${candidate.sport} · ${candidate.season})`,
      ),
    [quickAddAnalysisCandidates],
  )

  const toggleQuickAddAnalysisSelection = (externalKey: string) => {
    setQuickAddAnalysisSelection((current) => {
      const next = new Set(current)
      if (next.has(externalKey)) {
        next.delete(externalKey)
      } else {
        next.add(externalKey)
      }
      return next
    })
  }

  const addOwnedCardToBaseline = (card: (typeof ownedAdjustableCards)[number]) => {
    if (!card.externalKey) return
    if (
      isPassInRecommendationAdjustments(
        {
          externalKey: card.externalKey,
          name: card.name,
          sport: card.sport,
          season: card.season,
          seasonYear: 0,
          passKind: card.passKind ?? 'player',
        },
        rankAdjustments,
      )
    ) {
      setAdjustmentSearchStatus('That pass is already in the baseline list.')
      return
    }
    setRankAdjustments((current) => [
      ...current,
      {
        externalKey: card.externalKey!,
        name: card.name,
        sport: card.sport,
        season: card.season,
        mode: 'assume-iconic-1',
      },
    ])
    setAdjustmentSearchStatus(
      `Added ${card.name} — assume ${RECOMMENDATION_SIMULATED_RARITY}.`,
    )
  }

  const addSelectedQuickAddToBaseline = () => {
    const cards = filteredOwnedQuickAddCards.filter(
      (card) => card.externalKey && quickAddAnalysisSelection.has(card.externalKey),
    )
    if (cards.length === 0) return

    let added = 0
    setRankAdjustments((current) => {
      const next = [...current]
      for (const card of cards) {
        if (
          !card.externalKey ||
          isPassInRecommendationAdjustments(
            {
              externalKey: card.externalKey,
              name: card.name,
              sport: card.sport,
              season: card.season,
              seasonYear: 0,
              passKind: card.passKind ?? 'player',
            },
            next,
          )
        ) {
          continue
        }
        next.push({
          externalKey: card.externalKey,
          name: card.name,
          sport: card.sport,
          season: card.season,
          mode: 'assume-iconic-1',
        })
        added += 1
      }
      return next
    })
    setAdjustmentSearchStatus(
      added > 0
        ? `Added ${added} pass${added === 1 ? '' : 'es'} to ranking baseline as ${RECOMMENDATION_SIMULATED_RARITY}.`
        : 'Selected passes are already in the baseline list.',
    )
  }

  const addAllFilteredOwnedAdjustments = () => {
    if (addableFilteredOwnedCards.length === 0) {
      setAdjustmentSearchStatus(
        'No eligible passes to add — they may already be listed, lack a catalog link, or not match the filter.',
      )
      return
    }

    setRankAdjustments((current) => {
      const next = [...current]
      for (const card of addableFilteredOwnedCards) {
        if (
          !card.externalKey ||
          isPassInRecommendationAdjustments(
            {
              externalKey: card.externalKey,
              name: card.name,
              sport: card.sport,
              season: card.season,
              seasonYear: 0,
              passKind: card.passKind ?? 'player',
            },
            next,
          )
        ) {
          continue
        }
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
          const playerResults = result.results.filter((item) => isPlayerLikeCatalogPass(item))
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

  useEffect(() => {
    const trimmed = iconic20CatalogSearchQuery.trim()
    if (trimmed.length < 2) {
      setIconic20CatalogSearchResults([])
      setIconic20CatalogSearchStatus('')
      setIconic20CatalogSearchBusy(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setIconic20CatalogSearchBusy(true)
      searchCatalog(trimmed, controller.signal)
        .then((result) => {
          if (!result.storageConfigured) {
            setIconic20CatalogSearchStatus('Shared catalog search is not configured yet.')
            setIconic20CatalogSearchResults([])
            return
          }
          const playerResults = result.results.filter(
            (item) =>
              isPlayerLikeCatalogPass(item) &&
              item.rowCount > 0 &&
              !ownedCollectionExternalKeys.has(item.externalKey),
          )
          setIconic20CatalogSearchResults(playerResults)
          setIconic20CatalogSearchStatus(
            playerResults.length === 0
              ? 'No new player passes match that search (already-owned passes use the collection list).'
              : '',
          )
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          setIconic20CatalogSearchResults([])
          setIconic20CatalogSearchStatus(
            error instanceof Error ? error.message : 'Catalog search failed.',
          )
        })
        .finally(() => {
          if (!controller.signal.aborted) setIconic20CatalogSearchBusy(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [iconic20CatalogSearchQuery, ownedCollectionExternalKeys])

  useEffect(() => {
    const catalogKeys = [...iconic20Selection]
      .filter((key) => key.startsWith('catalog:'))
      .map((key) => key.slice('catalog:'.length))
    const missingKeys = catalogKeys.filter((key) => !iconic20ProfilesByKey.has(key))
    if (missingKeys.length === 0) return

    const controller = new AbortController()
    setIconic20ProfilesLoading(true)
    void fetchCatalogImportProfilesBulk(missingKeys, controller.signal)
      .then(({ profiles, storageConfigured }) => {
        if (!storageConfigured) return
        setIconic20ProfilesByKey((current) => {
          const next = new Map(current)
          for (const profile of profiles) {
            if (profile.rows.length > 0) next.set(profile.externalKey, profile)
          }
          return next
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setIconic20ProfilesLoading(false)
      })

    return () => controller.abort()
  }, [iconic20Selection, iconic20ProfilesByKey])

  useEffect(() => {
    const missingKeys = [...potentialBundleSelection].filter(
      (key) => !potentialBundleProfilesByKey.has(key),
    )
    if (missingKeys.length === 0) return

    const controller = new AbortController()
    setPotentialBundleProfilesLoading(true)
    void fetchCatalogImportProfilesBulk(missingKeys, controller.signal)
      .then(({ profiles, storageConfigured }) => {
        if (!storageConfigured) return
        setPotentialBundleProfilesByKey((current) => {
          const next = new Map(current)
          for (const profile of profiles) {
            if (profile.rows.length > 0) next.set(profile.externalKey, profile)
          }
          return next
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setPotentialBundleProfilesLoading(false)
      })

    return () => controller.abort()
  }, [potentialBundleProfilesByKey, potentialBundleSelection])

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

  const monthBoostAllSports = monthBoostSport === ALL_SPORTS_RANK

  const includedMonthBoostSports = useMemo(
    () => SPORTS.filter((sport) => !monthBoostExcludedSports.includes(sport)),
    [monthBoostExcludedSports],
  )

  const excludedMonthBoostSportOptions = useMemo(
    () => rankSportOptions.filter((option) => monthBoostExcludedSports.includes(option.value as Sport)),
    [monthBoostExcludedSports, rankSportOptions],
  )

  const isRecommendationRowClaimable = (row: PassRecommendationRow) =>
    profileByKey.has(row.externalKey) &&
    !isPassInRecommendationAdjustments(row, rankAdjustments) &&
    !isRecommendationOwnedAtIconic(row.externalKey)

  const claimableBundlePicks = useMemo(
    () => recommendationBundle?.picks.filter(isRecommendationRowClaimable) ?? [],
    [recommendationBundle, profileByKey, rankAdjustments, data.cards],
  )

  const claimableRankingRows = useMemo(
    () => recommendationRows.filter(isRecommendationRowClaimable),
    [recommendationRows, profileByKey, rankAdjustments, data.cards],
  )

  const visibleBundlePicks = useMemo(
    () =>
      recommendationBundle?.picks.filter(
        (row) =>
          !isPassInRecommendationAdjustments(row, rankAdjustments) &&
          !isRecommendationOwnedAtIconic(row.externalKey),
      ) ?? [],
    [recommendationBundle, rankAdjustments, data.cards, profileByKey],
  )

  const visibleBundleCombinedNet = useMemo(
    () => visibleBundlePicks.reduce((sum, row) => sum + row.netClaimableDelta, 0),
    [visibleBundlePicks],
  )

  const selectedClaimableBundlePicks = useMemo(
    () => claimableBundlePicks.filter((row) => bundleClaimSelection.has(row.externalKey)),
    [bundleClaimSelection, claimableBundlePicks],
  )

  const selectedClaimableRankingRows = useMemo(
    () => claimableRankingRows.filter((row) => rankingClaimSelection.has(row.externalKey)),
    [claimableRankingRows, rankingClaimSelection],
  )

  useEffect(() => {
    if (!recommendationBundle) {
      setBundleClaimSelection(new Set())
      return
    }
    setBundleClaimSelection(
      new Set(
        recommendationBundle.picks
          .filter(isRecommendationRowClaimable)
          .map((row) => row.externalKey),
      ),
    )
  }, [recommendationBundle, profileByKey, rankAdjustments, data.cards])

  useEffect(() => {
    if (recommendationRows.length === 0) {
      setRankingClaimSelection(new Set())
      return
    }
    setRankingClaimSelection(
      new Set(
        recommendationRows
          .filter(isRecommendationRowClaimable)
          .map((row) => row.externalKey),
      ),
    )
  }, [recommendationRows, profileByKey, rankAdjustments, data.cards])

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

  const toggleRankingClaimSelection = (externalKey: string) => {
    setRankingClaimSelection((current) => {
      const next = new Set(current)
      if (next.has(externalKey)) {
        next.delete(externalKey)
      } else {
        next.add(externalKey)
      }
      return next
    })
  }

  const recommendationClaimButtonProps = (row: PassRecommendationRow) => {
    const alreadyOwned = isRecommendationOwnedAtIconic(row.externalKey)
    const alreadyAssumed = isPassInRecommendationAdjustments(row, rankAdjustments)
    return {
      disabled: catalogAnalysisBusy || alreadyOwned || alreadyAssumed,
      title: alreadyAssumed
        ? 'Already in ranking baseline adjustments'
        : alreadyOwned
          ? `Already in your collection at ${RECOMMENDATION_SIMULATED_RARITY}+`
          : `Assume ${RECOMMENDATION_SIMULATED_RARITY} for ranking, recalculate rankings and the next ${bundleSize} greedy picks`,
      label: alreadyAssumed
        ? 'In baseline'
        : alreadyOwned
          ? 'Owned'
          : bundleClaimInProgress
            ? 'Claiming…'
            : 'Claim',
    }
  }

  const recommendationPlanButtonProps = (row: PassRecommendationRow) => {
    const onPlan = (data.plannedPasses ?? []).some((pass) => pass.externalKey === row.externalKey)
    return {
      disabled: catalogAnalysisBusy || onPlan,
      title: onPlan ? 'Already on your plan' : 'Save to Plan page',
      label: onPlan ? 'On plan' : 'Plan',
    }
  }

  const addRecommendationToPlan = (row: PassRecommendationRow) => {
    const id = addPlannedPass(plannedPassFromRecommendationRow(row, 'ranking'))
    setRankStatus(
      id ? `Added ${row.name} to your plan.` : `${row.name} is already on your plan.`,
    )
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

    const additions = rows.filter(
      (row) => !isPassInRecommendationAdjustments(row, rankAdjustments),
    )
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
      const baselineAdjustmentCount = countAppliedBaselineAdjustments(
        profileByKey,
        nextAdjustments,
      )
      const seasonFilter = {
        excludedSportSeasonKeys,
        adjustments: nextAdjustments,
      }

      setRankProgress(null)
      setRankStatus('Recalculating rankings and greedy recommendations…')
      const { ranked, bundle } = await rankAndRecommendAsync(
        baselineAfterClaim,
        rankCatalogProfiles,
        bundleSize,
        {
          ...seasonFilter,
          ...(rankAllSports ? { caps } : { sport: rankSport as Sport }),
          batchSize: 24,
          onProgress: setRankProgress,
        },
      )

      setRecommendationRows(ranked.rows.slice(0, TOP_RANKING_RESULTS))
      setRankResultsPage(1)
      setRecommendationBundle(bundle)
      setRecommendationMeta((prev) => ({
        calculatedAt: new Date().toISOString(),
        catalogCount: prev?.catalogCount ?? rankCatalogProfiles.length,
        fetchTrimmed: prev?.fetchTrimmed ?? 0,
        skippedOwnedIconic: prev?.skippedOwnedIconic ?? ranked.skippedOwnedIconic,
        skippedAdjusted: prev
          ? prev.skippedAdjusted + additions.length
          : ranked.skippedAdjusted,
        skippedNoRows: ranked.skippedNoRows,
        prefilterTrimmed: ranked.prefilterTrimmed,
        baselineAdjustmentCount,
      }))
      const rankSports: Sport[] = rankAllSports ? includedRankSports : [rankSport as Sport]
      const sportLabel = rankAllSports
        ? rankSports.length === SPORTS.length
          ? 'all sports'
          : rankSports.join(', ')
        : rankSport
      setRankStatus(
        `Assumed ${label} at ${RECOMMENDATION_SIMULATED_RARITY} (${formatSignedRax(displayRaxValue(combinedNet))} combined net) — ranking only. Recalculated top ${Math.min(TOP_RANKING_RESULTS, ranked.rows.length)} for ${sportLabel} · next ${bundle.picks.length} greedy pick${bundle.picks.length === 1 ? '' : 's'}.`,
      )
    } catch (error) {
      setRankAdjustments(prevAdjustments)
      setRankStatus(error instanceof Error ? error.message : 'Could not assume recommendations.')
    } finally {
      setBundleClaimInProgress(false)
      setRankProgress(null)
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

  const claimSelectedRankingRows = () => {
    void assumeRecommendationPicks(selectedClaimableRankingRows)
  }

  const claimAllRankingRows = () => {
    void assumeRecommendationPicks(claimableRankingRows)
  }

  const runCatalogRanking = async () => {
    rankAbortRef.current?.abort()
    monthBoostAbortRef.current?.abort()
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
    setRankingClaimSelection(new Set())

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
      const baselineAdjustmentCount = countAppliedBaselineAdjustments(profileMap, rankAdjustments)

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

  const runMonthBoostRanking = async () => {
    monthBoostAbortRef.current?.abort()
    rankAbortRef.current?.abort()
    sportOpportunityAbortRef.current?.abort()
    const controller = new AbortController()
    monthBoostAbortRef.current = controller
    setMonthBoostInProgress(true)
    setMonthBoostProgress(null)
    setMonthBoostStatus('')
    setMonthBoostAllRows([])
    setMonthBoostVisibleCount(MONTH_BOOST_PAGE_SIZE)
    setMonthBoostMeta(null)

    const seasonFilter = {
      excludedSportSeasonKeys,
      adjustments: rankAdjustments,
    }
    const monthBoostSports: Sport[] = monthBoostAllSports
      ? includedMonthBoostSports
      : [monthBoostSport as Sport]
    const caps = monthBoostAllSports
      ? recommendationCapsForSports(monthBoostSports)
      : recommendationCapsForSport(monthBoostSport as Sport)
    const monthLabel = CALENDAR_MONTH_NAMES[monthBoostMonthIdx] ?? 'Other'

    try {
      if (monthBoostAllSports && monthBoostSports.length === 0) {
        setMonthBoostStatus('Select at least one sport to rank.')
        return
      }

      let catalogCount = 0
      let skippedOwnedIconic = 0
      let skippedAdjusted = 0
      let fetchTrimmed = 0
      const candidateKeys: string[] = []
      const seenCandidateKeys = new Set<string>()

      const { bySport, storageConfigured: summariesConfigured } = await loadSportCatalogSummaries(
        monthBoostSports,
        (sport) => {
          const sportCaps = recommendationCapsForSport(sport)
          return Math.min(sportCaps.bulkFetchCap + 250, 1500)
        },
        controller.signal,
        (sport, sportIndex, total) => {
          setMonthBoostStatus(
            monthBoostAllSports
              ? `Loading ${sport} catalog passes… (${sportIndex + 1}/${total})`
              : `Loading ${sport} catalog passes…`,
          )
        },
      )
      if (!summariesConfigured) {
        setMonthBoostStatus('Shared catalog is not configured yet.')
        return
      }

      for (const sport of monthBoostSports) {
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
        setMonthBoostStatus(
          skippedOwnedIconic > 0
            ? monthBoostAllSports
              ? `All eligible catalog passes across every sport are already in your collection at ${RECOMMENDATION_SIMULATED_RARITY} or higher.`
              : `All eligible ${monthBoostSport} catalog passes are already in your collection at ${RECOMMENDATION_SIMULATED_RARITY} or higher.`
            : monthBoostAllSports
              ? 'No player passes with earnings found across any sport.'
              : `No player passes with earnings found for ${monthBoostSport}.`,
        )
        return
      }

      const assumeIconicKeys = rankAdjustments
        .filter((adjustment) => adjustment.mode === 'assume-iconic-1')
        .map((adjustment) => adjustment.externalKey)
      const allProfileKeys = [...new Set([...candidateKeys, ...assumeIconicKeys])]

      setMonthBoostStatus(
        monthBoostAllSports
          ? `Fetching earnings for ${allProfileKeys.length} passes across ${monthBoostSports.length} sport${
              monthBoostSports.length === 1 ? '' : 's'
            } (cap ${caps.bulkFetchCap} total)…`
          : `Fetching earnings for ${allProfileKeys.length} passes${
              fetchTrimmed > 0
                ? ` (top ${candidateKeys.length} by base RAX · cap ${caps.bulkFetchCap})`
                : ''
            }…`,
      )
      const reportBulkProgress = (loaded: number, total: number) => {
        setMonthBoostStatus(`Fetching earnings ${loaded}/${total} passes…`)
      }
      const { profiles, storageConfigured: bulkConfigured } = await fetchCatalogImportProfilesBulk(
        allProfileKeys,
        controller.signal,
        { onBatch: reportBulkProgress },
      )
      if (!bulkConfigured) {
        setMonthBoostStatus('Shared catalog is not configured yet.')
        return
      }

      const profileMap = new Map(profiles.map((profile) => [profile.externalKey, profile]))
      const baselineData = applyRecommendationBaseline(data, profileMap, rankAdjustments)
      const baselineAdjustmentCount = countAppliedBaselineAdjustments(profileMap, rankAdjustments)

      setMonthBoostStatus(
        `Analyzing top candidates for ${monthLabel} at ${RECOMMENDATION_SIMULATED_RARITY} OTD…`,
      )
      const ranked = await rankCatalogRecommendationsForMonthAsync(
        baselineData,
        profiles,
        monthBoostMonthIdx,
        {
          ...seasonFilter,
          ...(monthBoostAllSports ? { analysisCap: caps.analysisCap } : {}),
          signal: controller.signal,
          batchSize: 24,
          onProgress: setMonthBoostProgress,
        },
      )

      setMonthBoostAllRows(ranked.rows)
      setMonthBoostMeta({
        calculatedAt: new Date().toISOString(),
        skippedOwnedIconic: ranked.skippedOwnedIconic + skippedOwnedIconic,
        skippedAdjusted: skippedAdjusted + ranked.skippedAdjusted,
        skippedNoRows: ranked.skippedNoRows,
        catalogCount,
        fetchTrimmed,
        prefilterTrimmed: ranked.prefilterTrimmed,
        baselineAdjustmentCount,
        monthIdx: monthBoostMonthIdx,
        month: monthLabel,
      })
      const sportLabel = monthBoostAllSports
        ? monthBoostSports.length === SPORTS.length
          ? 'all sports'
          : monthBoostSports.join(', ')
        : monthBoostSport
      setMonthBoostStatus(
        `Ranked ${ranked.analyzedCount} pass${ranked.analyzedCount === 1 ? '' : 'es'} for ${monthLabel} (${sportLabel}) · showing top ${Math.min(MONTH_BOOST_PAGE_SIZE, ranked.rows.length)}${
          excludedSportSeasons.length > 0
            ? ` · excluding ${excludedSportSeasons.map(formatExcludedSportSeason).join(', ')}`
            : ''
        }.`,
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setMonthBoostStatus(error instanceof Error ? error.message : 'Could not rank passes for month.')
    } finally {
      if (monthBoostAbortRef.current === controller) {
        monthBoostAbortRef.current = null
      }
      setMonthBoostInProgress(false)
      setMonthBoostProgress(null)
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

  const visibleMonthBoostRows = useMemo(
    () => monthBoostAllRows.slice(0, monthBoostVisibleCount),
    [monthBoostAllRows, monthBoostVisibleCount],
  )

  const monthBoostHasMore =
    monthBoostVisibleCount < monthBoostAllRows.length

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">What-if</p>
          <h2>Potential card checker</h2>
          <p>
            Test a player pass you do not own yet, rank catalog passes by net claimable RAX, or analyze
            Iconic upgrades on passes you already own. Search the shared Meowbot catalog — new card
            analysis previews at {RECOMMENDATION_SIMULATED_RARITY} OTD — or paste JSON from
            realapp.com. Saved profiles stay out of your real totals.
          </p>
        </div>
        <Link className="button" to="/overlaps">
          View overlaps
        </Link>
      </section>

      {ownedAdjustableCards.length > 0 ? (
        <CollapsiblePanel
          id="owned-iconic-upgrade"
          className="owned-iconic-upgrade-analyzer"
          title="Iconic 1 upgrade analyzer"
          description={`See how much extra claimable RAX you would get if you upgraded player passes you already own to ${RECOMMENDATION_SIMULATED_RARITY}. Pick one pass for a solo check, or several for a bundle.`}
          badge={
            quickAddAnalysisSelection.size > 0
              ? `${quickAddAnalysisSelection.size} selected`
              : undefined
          }
          defaultOpen={false}
        >
          <p className="import-hint">
            <strong>What is analyzed:</strong> daily earnings saved on each selected pass, recomputed
            at {RECOMMENDATION_SIMULATED_RARITY} OTD multipliers, then run through the same claim
            rules as the Dashboard (top 2 guaranteed per sport per day, plus Pro bonus if enabled).
            Your saved cards are not changed — results show net claimable gain vs your collection
            today.
          </p>
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
            {ownedQuickAddFilter.trim() ? (
              <span className="badge">
                {filteredOwnedQuickAddCards.length} match
                {filteredOwnedQuickAddCards.length === 1 ? '' : 'es'}
              </span>
            ) : null}
          </div>
          {filteredOwnedQuickAddCards.length > 0 ? (
            <>
              <p className="import-hint">Click passes to select them for analysis.</p>
              <div className="recommendation-adjustment-owned-list button-row wrap-row">
                {filteredOwnedQuickAddCards.map((card) => {
                  const missingCatalogLink = !card.externalKey
                  const selected = card.externalKey
                    ? quickAddAnalysisSelection.has(card.externalKey)
                    : false
                  return (
                    <button
                      className={`button compact${selected ? ' primary' : ''}`}
                      type="button"
                      key={card.id}
                      disabled={catalogAnalysisBusy || missingCatalogLink}
                      title={
                        missingCatalogLink
                          ? 'No catalog link — re-import or use catalog search in baseline adjustments'
                          : selected
                            ? 'Remove from analysis'
                            : 'Add to analysis'
                      }
                      onClick={() => {
                        if (!card.externalKey) return
                        toggleQuickAddAnalysisSelection(card.externalKey)
                      }}
                    >
                      {card.name}
                      {card.season ? ` · ${card.season}` : ''}
                      {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                    </button>
                  )
                })}
              </div>
              {quickAddAnalysisSelection.size > 0 ? (
                <div className="owned-upgrade-analysis-results">
                  <div className="section-heading">
                    <div>
                      <h3>
                        {quickAddAnalysisSelection.size === 1
                          ? 'Analysis result'
                          : `Bundle analysis (${quickAddAnalysisSelection.size} passes)`}
                      </h3>
                      <p className="import-hint">
                        Simulating upgrade to {RECOMMENDATION_SIMULATED_RARITY} for:{' '}
                        {selectedUpgradePassLabels.join('; ')}
                      </p>
                    </div>
                    <button
                      className="button compact"
                      type="button"
                      disabled={catalogAnalysisBusy}
                      onClick={() => setQuickAddAnalysisSelection(new Set())}
                    >
                      Clear selection
                    </button>
                  </div>
                  <CheckerNetGainMetrics
                    baselineGuaranteed={collectionGuaranteedNow}
                    baselineWithPro={collectionWithProNow}
                    combinedGuaranteedNetDelta={quickAddAnalysis.combinedGuaranteedNetDelta}
                    combinedWithProNetDelta={quickAddAnalysis.combinedNetDelta}
                    baselineLabel="Your collection now"
                    afterLabel="After upgrade"
                    netGainDetail={
                      quickAddAnalysisSelection.size === 1
                        ? 'from this pass alone'
                        : 'bundle after same-sport overlap'
                    }
                    passClaimable={
                      quickAddAnalysis.rows.length === 1
                        ? {
                            guaranteed: quickAddAnalysis.rows[0]!.passGuaranteedRax,
                            withPro: quickAddAnalysis.rows[0]!.passClaimableRax,
                          }
                        : undefined
                    }
                    passClaimableLabel={`Pass claimable at ${RECOMMENDATION_SIMULATED_RARITY}`}
                  />
                  {quickAddAnalysis.rows.length > 1 ? (
                    <>
                      <p className="import-hint">Per-pass contribution inside this bundle:</p>
                      <ul className="list compact-list">
                        {quickAddAnalysis.rows.map((row) => (
                          <li key={row.key}>
                            <strong>{row.name}</strong>
                            <small>
                              {row.sport} · {row.season} ·{' '}
                              {formatRax(displayRaxValue(row.passClaimableRax))} claimable at{' '}
                              {RECOMMENDATION_SIMULATED_RARITY} · adds{' '}
                              {formatSignedRax(displayRaxValue(row.marginalNetDelta))} net
                            </small>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <p className="import-hint">
                    Want catalog ranking to treat these as already upgraded? Add them under{' '}
                    <button className="link-button" type="button" onClick={goToBaselineAdjustments}>
                      Ranking baseline adjustments
                    </button>{' '}
                    on the
                    catalog ranker below.
                  </p>
                  <div className="button-row">
                    <button
                      className="button"
                      type="button"
                      disabled={catalogAnalysisBusy}
                      onClick={addSelectedQuickAddToBaseline}
                    >
                      Add analyzed passes to ranking baseline
                    </button>
                  </div>
                </div>
              ) : (
                <p className="empty">Select at least one pass to run the analysis.</p>
              )}
            </>
          ) : (
            <p className="empty">No collection passes match that filter.</p>
          )}
        </CollapsiblePanel>
      ) : null}

      <CollapsiblePanel
        id="month-boost-passes"
        title="Best passes for a month"
        description={`Find catalog passes that would add the most net claimable RAX in a specific calendar month. Every candidate is simulated at ${RECOMMENDATION_SIMULATED_RARITY} OTD.`}
        open={monthBoostOpen}
        onOpenChange={setMonthBoostOpen}
        defaultOpen={false}
      >
        <p className="import-hint">
          Ranks player passes from the shared catalog by how much they would increase your net
          claimable RAX in the selected month (includes Pro bonus claims). Uses the same ranking
          baseline adjustments and season exclusions as{' '}
          <button className="link-button" type="button" onClick={() => setCatalogRankOpen(true)}>
            Rank catalog passes
          </button>
          . Only the top catalog passes by base RAX are fetched and analyzed.
          {monthBoostAllSports ? (
            <>
              {' '}
              <strong>All sports</strong> loads every sport&apos;s catalog and ranks across the
              combined pool — expect long runtimes.
            </>
          ) : null}
        </p>

        <div className="sort-controls">
          <label className="field inline-field">
            <span>Month</span>
            <select
              value={monthBoostMonthIdx}
              disabled={catalogAnalysisBusy}
              onChange={(event) => setMonthBoostMonthIdx(Number(event.target.value))}
            >
              {CALENDAR_MONTH_NAMES.map((month, index) => (
                <option key={month} value={index}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline-field">
            <span>Sport</span>
            <select
              value={monthBoostSport}
              disabled={catalogAnalysisBusy}
              onChange={(event) => {
                const next = event.target.value
                setMonthBoostSport(next === ALL_SPORTS_RANK ? ALL_SPORTS_RANK : (next as Sport))
                if (next !== ALL_SPORTS_RANK) {
                  setMonthBoostExcludedSports([])
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
          {monthBoostAllSports ? (
            <div className="field inline-field season-multi-select-field">
              <SeasonMultiSelect
                options={rankSportOptions}
                excludedValues={monthBoostExcludedSports}
                onExcludedValuesChange={(values) => setMonthBoostExcludedSports(values as Sport[])}
                disabled={catalogAnalysisBusy}
                label="Sports"
                menuTitle="Sports"
                allOptionLabel="All sports"
                emptyTriggerLabel="No sports"
                countUnit="sports"
              />
              {excludedMonthBoostSportOptions.length > 0 ? (
                <p className="season-filter-summary">
                  <span>
                    Including:{' '}
                    {includedMonthBoostSports.length > 0
                      ? includedMonthBoostSports.join(', ')
                      : 'none'}
                  </span>
                  {' · '}
                  <span>
                    Excluding: {excludedMonthBoostSportOptions.map((option) => option.label).join(', ')}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={
              catalogAnalysisBusy ||
              (monthBoostAllSports && includedMonthBoostSports.length === 0)
            }
            onClick={() => void runMonthBoostRanking()}
          >
            {monthBoostInProgress ? 'Ranking…' : `Rank for ${CALENDAR_MONTH_NAMES[monthBoostMonthIdx]}`}
          </button>
          {monthBoostInProgress ? (
            <button className="button" type="button" onClick={cancelMonthBoostRanking}>
              Cancel
            </button>
          ) : null}
        </div>
        {monthBoostProgress ? (
          <p className="import-progress">
            Analyzing pass {monthBoostProgress.current}/{monthBoostProgress.total} —{' '}
            {monthBoostProgress.label}
          </p>
        ) : null}
        {monthBoostStatus ? <p className="import-status">{monthBoostStatus}</p> : null}

        {monthBoostAllRows.length > 0 ? (
          <>
            {monthBoostMeta ? (
              <p className="import-hint">
                Saved {new Date(monthBoostMeta.calculatedAt).toLocaleString()} ·{' '}
                {monthBoostMeta.catalogCount} catalog pass
                {monthBoostMeta.catalogCount === 1 ? '' : 'es'} · target {monthBoostMeta.month}
                {monthBoostMeta.skippedOwnedIconic > 0
                  ? ` · ${monthBoostMeta.skippedOwnedIconic} already owned at ${RECOMMENDATION_SIMULATED_RARITY}+`
                  : ''}
                {monthBoostMeta.skippedAdjusted > 0
                  ? ` · ${monthBoostMeta.skippedAdjusted} skipped by your adjustments`
                  : ''}
                {monthBoostMeta.baselineAdjustmentCount > 0
                  ? ` · ${monthBoostMeta.baselineAdjustmentCount} assumed at ${RECOMMENDATION_SIMULATED_RARITY} in baseline`
                  : ''}
                {monthBoostMeta.fetchTrimmed > 0
                  ? ` · ${monthBoostMeta.fetchTrimmed} not fetched (base RAX pre-filter)`
                  : ''}
                {monthBoostMeta.prefilterTrimmed > 0
                  ? ` · ${monthBoostMeta.prefilterTrimmed} not fully simulated (Iconic 1 pre-filter)`
                  : ''}
                . Net Δ includes Pro bonus; guaranteed-only shown for comparison. Click a pass to
                open detailed analysis below.
              </p>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Pass</th>
                    <th>{monthBoostMeta?.month ?? 'Month'} net Δ</th>
                    <th>Pro bonus</th>
                    <th>Year-round net Δ</th>
                    <th>Month gain</th>
                    <th>Month displaced</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMonthBoostRows.map((row, index) => {
                    const rankNumber = index + 1
                    const monthProBonus = row.monthNetDelta - row.monthGuaranteedNetDelta
                    const yearRoundProBonus = row.netClaimableDelta - row.netGuaranteedDelta
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
                              row.monthNetDelta > 0
                                ? 'sale-positive'
                                : row.monthNetDelta < 0
                                  ? 'sale-negative'
                                  : ''
                            }
                          >
                            {formatSignedRax(displayRaxValue(row.monthNetDelta))}
                          </strong>
                          <br />
                          <small className="table-sub">
                            {formatSignedRax(displayRaxValue(row.monthGuaranteedNetDelta))}{' '}
                            guaranteed
                          </small>
                        </td>
                        <td>
                          {monthProBonus > 0 ? (
                            <>+{formatRax(displayRaxValue(monthProBonus))}</>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {formatSignedRax(displayRaxValue(row.netClaimableDelta))}
                          <br />
                          <small className="table-sub">
                            {formatSignedRax(displayRaxValue(row.netGuaranteedDelta))} guaranteed
                            {yearRoundProBonus > 0
                              ? ` · +${formatRax(displayRaxValue(yearRoundProBonus))} Pro`
                              : ''}
                          </small>
                        </td>
                        <td>{formatRax(displayRaxValue(row.monthGain))}</td>
                        <td>
                          {row.monthDisplaced > 0
                            ? `−${formatRax(displayRaxValue(row.monthDisplaced))}`
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {monthBoostHasMore ? (
              <div className="button-row">
                <button
                  className="button"
                  type="button"
                  disabled={catalogAnalysisBusy}
                  onClick={() =>
                    setMonthBoostVisibleCount((count) =>
                      Math.min(count + MONTH_BOOST_PAGE_SIZE, monthBoostAllRows.length),
                    )
                  }
                >
                  Show next {Math.min(MONTH_BOOST_PAGE_SIZE, monthBoostAllRows.length - monthBoostVisibleCount)} (
                  {monthBoostVisibleCount} of {monthBoostAllRows.length})
                </button>
              </div>
            ) : monthBoostAllRows.length > MONTH_BOOST_PAGE_SIZE ? (
              <p className="import-hint">
                Showing all {monthBoostAllRows.length} ranked passes.
              </p>
            ) : null}
          </>
        ) : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        id="catalog-recommendations"
        title="Rank catalog passes"
        description="Find player passes in the shared catalog that would add the most net claimable RAX to your collection. Every candidate is simulated at Iconic 1 OTD."
        open={catalogRankOpen}
        onOpenChange={setCatalogRankOpen}
        defaultOpen={false}
      >
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

        <CollapsiblePanel
          id="recommendation-adjustments"
          className="nested-panel recommendation-adjustments"
          title="Ranking baseline adjustments"
          description="Temporarily change how your collection is treated for catalog ranking and the Search and analyze new potential card section (single-card and bundle checks). Does not modify saved cards."
          badge={rankAdjustments.length > 0 ? `${rankAdjustments.length} adjusted` : undefined}
          open={baselineAdjustmentsOpen}
          onOpenChange={setBaselineAdjustmentsOpen}
          defaultOpen={false}
        >
          <p className="import-hint">
            <strong>Assume {RECOMMENDATION_SIMULATED_RARITY}</strong> — treat a pass as already at{' '}
            {RECOMMENDATION_SIMULATED_RARITY} in your collection (for passes you are upgrading, like
            a lower-tier Ashton Jeanty). Rankings, single-card search analysis, and custom bundle
            tests all use this adjusted baseline. <strong>Exclude</strong> — skip a pass from
            recommendations without adding it to your baseline.
          </p>

          {ownedAdjustableCards.length > 0 ? (
            <div className="recommendation-adjustment-owned">
              <div className="section-heading recommendation-adjustment-owned-heading">
                <div>
                  <h4>Quick add from your collection</h4>
                  <p className="import-hint">
                    Click a pass to treat it as already at {RECOMMENDATION_SIMULATED_RARITY} when
                    ranking catalog candidates. Passes already in the baseline are marked and
                    skipped.
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
                  Add all
                  {addableFilteredOwnedCards.length > 0
                    ? ` (${addableFilteredOwnedCards.length})`
                    : ''}
                </button>
              </div>
              {filteredOwnedQuickAddCards.length > 0 ? (
                <div className="recommendation-adjustment-owned-list button-row wrap-row">
                  {filteredOwnedQuickAddCards.map((card) => {
                    const alreadyAdded = card.externalKey
                      ? isPassInRecommendationAdjustments(
                          {
                            externalKey: card.externalKey,
                            name: card.name,
                            sport: card.sport,
                            season: card.season,
                            seasonYear: 0,
                            passKind: card.passKind ?? 'player',
                          },
                          rankAdjustments,
                        )
                      : false
                    const missingCatalogLink = !card.externalKey
                    return (
                      <button
                        className="button compact"
                        type="button"
                        key={card.id}
                        disabled={catalogAnalysisBusy || missingCatalogLink || alreadyAdded}
                        title={
                          missingCatalogLink
                            ? 'No catalog link on this card'
                            : alreadyAdded
                              ? 'Already in ranking baseline'
                              : `Add as assume ${RECOMMENDATION_SIMULATED_RARITY}`
                        }
                        onClick={() => addOwnedCardToBaseline(card)}
                      >
                        {card.name}
                        {card.season ? ` · ${card.season}` : ''}
                        {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                        {alreadyAdded ? ' · baseline' : ''}
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
                        catalogAnalysisBusy ||
                        isPassInRecommendationAdjustments(result, rankAdjustments)
                      }
                      onClick={() => addRankAdjustment(result, 'assume-iconic-1')}
                    >
                      Assume {RECOMMENDATION_SIMULATED_RARITY}
                    </button>
                    <button
                      className="button compact"
                      type="button"
                      disabled={
                        catalogAnalysisBusy ||
                        isPassInRecommendationAdjustments(result, rankAdjustments)
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
        </CollapsiblePanel>

        <CollapsiblePanel
          id="sport-opportunity-scan"
          className="nested-panel"
          title="Sport opportunity scan"
          description={`Compare every sport against your adjusted baseline and score net claimable RAX from the top ${SPORT_OPPORTUNITY_BUNDLE_SIZE} greedy catalog picks at ${RECOMMENDATION_SIMULATED_RARITY}.`}
          defaultOpen={false}
        >
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
        </CollapsiblePanel>

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

        <CollapsiblePanel
          className="nested-panel recommendation-exclusions"
          title="Exclude sport + season from ranking"
          description="Skip catalog passes for a specific sport and season. Exclusions stay when you change the rank sport above."
          badge={
            excludedSportSeasons.length > 0
              ? `${excludedSportSeasons.length} excluded`
              : undefined
          }
          defaultOpen={false}
        >
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
        </CollapsiblePanel>

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
          <CollapsiblePanel
            className="nested-panel"
            title="Recommended bundle (greedy)"
            description={
              visibleBundlePicks.length > 0
                ? `Top ${visibleBundlePicks.length} pass${visibleBundlePicks.length === 1 ? '' : 'es'} to add one at a time — marginal net after prior picks in the bundle.`
                : 'No more positive greedy picks with the current catalog pool and baseline.'
            }
            badge={
              visibleBundlePicks.length > 0
                ? `${formatSignedRax(displayRaxValue(visibleBundleCombinedNet))} combined net`
                : undefined
            }
            defaultOpen={false}
          >
            {visibleBundlePicks.length > 0 ? (
              <p className="import-hint">
                Claim assumes selected passes at {RECOMMENDATION_SIMULATED_RARITY} in your ranking
                baseline — nothing is saved to your real collection.
              </p>
            ) : null}
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
              {visibleBundlePicks.map((row, index) => {
                const claimable = isRecommendationRowClaimable(row)
                const selected = bundleClaimSelection.has(row.externalKey)
                const claimButton = recommendationClaimButtonProps(row)
                const planButton = recommendationPlanButtonProps(row)
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
                      disabled={claimButton.disabled}
                      title={claimButton.title}
                      onClick={() => void claimRecommendationPick(row)}
                    >
                      {claimButton.label}
                    </button>
                    <button
                      className="button compact"
                      type="button"
                      disabled={planButton.disabled}
                      title={planButton.title}
                      onClick={() => addRecommendationToPlan(row)}
                    >
                      {planButton.label}
                    </button>
                  </div>
                )
              })}
            </div>
          </CollapsiblePanel>
        ) : null}

        {recommendationRows.length > 0 ? (
          <CollapsiblePanel
            className="nested-panel"
            title="Ranking results"
            description="Top catalog passes by net claimable RAX. Click a row to open detailed analysis below."
            badge={`${recommendationRows.length} passes`}
            defaultOpen={false}
          >
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
            {claimableRankingRows.length > 0 ? (
              <>
                <p className="import-hint">
                  Claim assumes selected passes at {RECOMMENDATION_SIMULATED_RARITY} in your ranking
                  baseline — nothing is saved to your real collection.
                </p>
                <div className="sort-controls bundle-claim-actions">
                  <button
                    className="button primary"
                    type="button"
                    disabled={
                      catalogAnalysisBusy ||
                      selectedClaimableRankingRows.length === 0
                    }
                    onClick={claimSelectedRankingRows}
                  >
                    {bundleClaimInProgress
                      ? 'Claiming…'
                      : `Claim selected (${selectedClaimableRankingRows.length})`}
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={catalogAnalysisBusy || claimableRankingRows.length === 0}
                    onClick={claimAllRankingRows}
                  >
                    Claim all ({claimableRankingRows.length})
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={catalogAnalysisBusy || claimableRankingRows.length === 0}
                    onClick={() =>
                      setRankingClaimSelection(
                        new Set(claimableRankingRows.map((row) => row.externalKey)),
                      )
                    }
                  >
                    Select all
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={catalogAnalysisBusy || rankingClaimSelection.size === 0}
                    onClick={() => setRankingClaimSelection(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="ranking-claim-col" aria-label="Select for claim" />
                    <th>#</th>
                    <th>Pass</th>
                    <th>Net Δ</th>
                    <th>New claimable</th>
                    <th>Displaced</th>
                    <th>Overlap</th>
                    <th>Base RAX</th>
                    <th>Claim</th>
                    <th>Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRecommendationRows.map((row, index) => {
                    const rankNumber = (rankResultsPage - 1) * RANKING_PAGE_SIZE + index + 1
                    const claimable = isRecommendationRowClaimable(row)
                    const selected = rankingClaimSelection.has(row.externalKey)
                    const claimButton = recommendationClaimButtonProps(row)
                    const planButton = recommendationPlanButtonProps(row)
                    return (
                    <tr key={row.externalKey}>
                      <td className="ranking-claim-col">
                        {claimable ? (
                          <label className="bundle-claim-check">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={catalogAnalysisBusy}
                              onChange={() => toggleRankingClaimSelection(row.externalKey)}
                            />
                          </label>
                        ) : null}
                      </td>
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
                      <td>
                        <button
                          className="button compact primary"
                          type="button"
                          disabled={claimButton.disabled}
                          title={claimButton.title}
                          onClick={() => void claimRecommendationPick(row)}
                        >
                          {claimButton.label}
                        </button>
                      </td>
                      <td>
                        <button
                          className="button compact"
                          type="button"
                          disabled={planButton.disabled}
                          title={planButton.title}
                          onClick={() => addRecommendationToPlan(row)}
                        >
                          {planButton.label}
                        </button>
                      </td>
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
          </CollapsiblePanel>
        ) : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        className="help-section"
        title="Manual import walkthrough"
        description={
          realProviderImportEnabled()
            ? 'Username import brings in your pass list, but not daily RAX. Use shared catalog search below for player RAX, or paste one card at a time from realapp.com.'
            : `Username import closes after ${realappToolsShutdownLabel()}. Use shared catalog search below for player passes and RAX, or paste one card at a time from realapp.com.`
        }
        defaultOpen={false}
      >
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
                click <strong>Analyze potential card</strong>. Analysis previews at{' '}
                {RECOMMENDATION_SIMULATED_RARITY} OTD.
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
      </CollapsiblePanel>

      <CollapsiblePanel
        id="potential-card-form"
        className="form-panel"
        title="Search and analyze new potential card"
        description="Search the shared catalog or paste realapp.com JSON. Solo analysis uses the preview rarity below (default Iconic 1)."
        badge={editingId ? 'Editing' : potentialAnalysis ? 'Results ready' : 'New'}
        defaultOpen
      >
        <p className="import-hint potential-baseline-notice">
          {potentialBaselineAdjustmentCount > 0 ? (
            <>
              Single-card and bundle analysis use your{' '}
              <strong>ranking baseline adjustments</strong> ({potentialBaselineAdjustmentCount}{' '}
              pass{potentialBaselineAdjustmentCount === 1 ? '' : 'es'} assumed at{' '}
              {RECOMMENDATION_SIMULATED_RARITY}).{' '}
              <button className="link-button" type="button" onClick={goToBaselineAdjustments}>
                Edit baseline adjustments
              </button>
            </>
          ) : (
            <>
              Single-card and bundle analysis use your collection as saved. To simulate upgrades you
              plan first, add{' '}
              <button className="link-button" type="button" onClick={goToBaselineAdjustments}>
                ranking baseline adjustments
              </button>{' '}
              under Rank
              catalog passes.
            </>
          )}
        </p>
        <div className="sort-controls potential-solo-rarity">
          <label className="field inline-field">
            <span>Solo preview rarity</span>
            <select
              value={form.previewAs || RECOMMENDATION_SIMULATED_RARITY}
              onChange={(event) =>
                setForm((current) => ({ ...current, previewAs: event.target.value }))
              }
            >
              {POTENTIAL_RARITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <CatalogSearchPanel
          embedded
          sectionId="catalog-search-panel"
          description="Analyze one pass at the solo preview rarity above, add several to a bundle, or save to your plan."
          passKind="player"
          actionLabel="Analyze solo"
          bundleActionLabel="Add to bundle"
          loadingKey={catalogLoadingKey}
          disabled={Boolean(catalogLoadingKey)}
          bundleExternalKeys={potentialBundleSelection}
          onToggleBundle={togglePotentialBundle}
          planAdd={{
            plannedExternalKeys: new Set((data.plannedPasses ?? []).map((pass) => pass.externalKey)),
            onPlanLabel: 'On plan',
          }}
          onAddToPlan={(result, rarityLabel) => {
            const id = addPlannedPassFromCatalog(
              result,
              rarityLabel || form.previewAs || RECOMMENDATION_SIMULATED_RARITY,
              'catalog',
            )
            setStatus(
              id ? `Added ${result.name} to your plan.` : `${result.name} is already on your plan.`,
            )
          }}
          onSelect={loadFromCatalog}
        />

        {potentialBundleSelection.size > 0 ? (
          <div className="potential-bundle-controls">
            <div className="sort-controls">
              <label className="field inline-field">
                <span>Bundle preview rarity</span>
                <select
                  value={potentialBundleRarity}
                  onChange={(event) => setPotentialBundleRarity(event.target.value)}
                >
                  {POTENTIAL_RARITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                type="button"
                onClick={() => setPotentialBundleSelection(new Set())}
              >
                Clear bundle ({potentialBundleSelection.size})
              </button>
            </div>
            {potentialBundleProfilesLoading ? (
              <p className="import-hint">Loading bundle catalog rows…</p>
            ) : null}
            {potentialBundleAnalysis && potentialBundleProfiles.length > 0 ? (
              <div className="owned-upgrade-analysis-results">
                <div className="section-heading">
                  <div>
                    <h3>
                      Bundle analysis ({potentialBundleProfiles.length} pass
                      {potentialBundleProfiles.length === 1 ? '' : 'es'} at {potentialBundleRarity})
                    </h3>
                    <p className="import-hint">
                      Same-sport overlap is counted in bundle order (best isolated net first within
                      each sport).
                    </p>
                  </div>
                </div>
                <CheckerNetGainMetrics
                  baselineGuaranteed={potentialCollectionGuaranteed}
                  baselineWithPro={potentialCollectionWithPro}
                  combinedGuaranteedNetDelta={potentialBundleAnalysis.combinedGuaranteedNetDelta}
                  combinedWithProNetDelta={potentialBundleAnalysis.combinedNetDelta}
                  baselineLabel="Baseline collection"
                  afterLabel="After bundle"
                  netGainDetail="bundle total"
                />
                {potentialBundleAnalysis.rows.length > 1 ? (
                  <>
                    <p className="import-hint">Per-pass contribution inside this bundle:</p>
                    <ul className="list compact-list">
                      {potentialBundleAnalysis.rows.map((row) => (
                        <li key={row.key}>
                          <strong>{row.name}</strong>
                          <small>
                            {' '}
                            · {row.sport} · {row.season} · isolated{' '}
                            {formatSignedRax(displayRaxValue(row.isolatedNetDelta))} · marginal{' '}
                            {formatSignedRax(displayRaxValue(row.marginalNetDelta))}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : potentialBundleSelection.size > 0 && !potentialBundleProfilesLoading ? (
              <p className="import-hint">
                Selected passes are loading or have no catalog earnings rows yet.
              </p>
            ) : null}
          </div>
        ) : null}

        <h3 className="mini-heading potential-section-divider">Or enter manually</h3>
        <form className="form-panel-inner" onSubmit={submitAnalyze}>
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
          <div className="potential-analysis-inline">
            <h3 className="mini-heading potential-section-divider">Analysis result</h3>
            <PotentialAnalysisResults
              analysis={potentialAnalysis}
              previewAs={form.previewAs || RECOMMENDATION_SIMULATED_RARITY}
              baselineAdjustmentCount={potentialBaselineAdjustmentCount}
            />
          </div>
        ) : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Saved profiles"
        description="Player info and pasted JSON — reload to re-run the what-if analysis."
        badge={`${data.potentialCards.length} saved`}
        defaultOpen={false}
      >
        {data.potentialCards.length === 0 ? (
          <p className="empty">No saved profiles yet. Analyze a card above, then save it for later.</p>
        ) : (
          <div className="list">
            {data.potentialCards.map((saved) => (
              <div className="list-row" key={saved.id}>
                <span>
                  <strong>{saved.name || 'Potential card'}</strong>
                  <small>
                    {saved.sport} · {saved.season || 'No season'} · {saved.rows.length} row
                    {saved.rows.length === 1 ? '' : 's'}
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
      </CollapsiblePanel>

      <CollapsiblePanel
        id="iconic-20-checker"
        className="iconic-20-checker"
        title="Iconic 20 potential checker"
        description={`Bundle what-if at ${ICONIC_20_SIMULATED_RARITY} OTD — upgrade owned Iconic passes and/or preview new catalog cards. Nothing is saved.`}
        badge={
          iconic20Selection.size > 0 ? `${iconic20Selection.size} selected` : undefined
        }
        defaultOpen={false}
      >
        <p className="import-hint">
          <strong>What is analyzed:</strong> saved daily earnings (owned upgrades) or catalog base
          stats (new cards), each at {ICONIC_20_SIMULATED_RARITY} multipliers, then Dashboard claim
          rules (top 2 per sport per day, Pro bonus if enabled). Mix owned upgrades and new catalog
          picks in one bundle — same-sport overlap is counted in bundle order.
        </p>

        <CollapsiblePanel
          className="nested-panel iconic-20-checker-owned"
          title="From your collection"
          description={`Upgrade owned Iconic passes below level 20 to ${ICONIC_20_SIMULATED_RARITY}.`}
          defaultOpen={false}
        >
          {ownedIconic20EligibleCards.length > 0 ? (
            <>
              <div className="sort-controls">
                <label className="field inline-field recommendation-adjustment-owned-search">
                  <span>Filter owned Iconic passes</span>
                  <input
                    value={iconic20OwnedFilter}
                    disabled={catalogAnalysisBusy}
                    placeholder="Name, sport, season, or rarity"
                    onChange={(event) => setIconic20OwnedFilter(event.target.value)}
                  />
                </label>
                {iconic20OwnedFilter.trim() ? (
                  <span className="badge">
                    {filteredIconic20OwnedCards.length} match
                    {filteredIconic20OwnedCards.length === 1 ? '' : 'es'}
                  </span>
                ) : null}
              </div>
              {filteredIconic20OwnedCards.length > 0 ? (
                <>
                  <p className="import-hint">Click to add or remove from the bundle.</p>
                  <div className="recommendation-adjustment-owned-list button-row wrap-row">
                    {filteredIconic20OwnedCards.map((card) => {
                      const selectionKey = iconic20OwnedSelectionKey(card.externalKey!)
                      const selected = iconic20Selection.has(selectionKey)
                      return (
                        <button
                          className={`button compact${selected ? ' primary' : ''}`}
                          type="button"
                          key={card.id}
                          disabled={catalogAnalysisBusy}
                          title={selected ? 'Remove from bundle' : 'Add upgrade to bundle'}
                          onClick={() => toggleIconic20Selection(selectionKey)}
                        >
                          {card.name}
                          {card.season ? ` · ${card.season}` : ''}
                          {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="empty">No owned Iconic passes match that filter.</p>
              )}
            </>
          ) : (
            <p className="empty">
              No owned Iconic passes below level 20 — use catalog search below for new-card previews.
            </p>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel
          className="nested-panel iconic-20-checker-catalog"
          title="From catalog (new card)"
          description={`Search passes you do not own. Each pick is simulated as a new ${ICONIC_20_SIMULATED_RARITY} card — not saved to your collection.`}
          defaultOpen={false}
        >
          <div className="sort-controls">
            <label className="field inline-field recommendation-adjustment-search">
              <span>Search catalog</span>
              <input
                value={iconic20CatalogSearchQuery}
                disabled={catalogAnalysisBusy}
                placeholder="Player name, e.g. Ashton Jeanty"
                onChange={(event) => setIconic20CatalogSearchQuery(event.target.value)}
              />
            </label>
          </div>
          {iconic20CatalogSearchBusy ? <p className="import-hint">Searching catalog…</p> : null}
          {iconic20CatalogSearchStatus ? (
            <p className="import-status">{iconic20CatalogSearchStatus}</p>
          ) : null}
          {iconic20CatalogSearchResults.length > 0 ? (
            <div className="recommendation-adjustment-owned-list button-row wrap-row">
              {iconic20CatalogSearchResults.slice(0, 12).map((result) => {
                const selectionKey = iconic20CatalogSelectionKey(result.externalKey)
                const selected = iconic20Selection.has(selectionKey)
                const profileReady = iconic20ProfilesByKey.has(result.externalKey)
                return (
                  <button
                    className={`button compact${selected ? ' primary' : ''}`}
                    type="button"
                    key={result.externalKey}
                    disabled={catalogAnalysisBusy}
                    title={
                      selected
                        ? 'Remove from bundle'
                        : profileReady
                          ? 'Add new-card preview to bundle'
                          : 'Add to bundle (loads catalog daily rows)'
                    }
                    onClick={() => toggleIconic20Selection(selectionKey)}
                  >
                    {result.name}
                    {' · '}
                    {sportFromCatalog(result.sport)} ·{' '}
                    {result.seasonLabel.trim() || result.seasonYear}
                    {selected && !profileReady ? ' · loading…' : ''}
                  </button>
                )
              })}
            </div>
          ) : null}
        </CollapsiblePanel>

        {iconic20Selection.size > 0 ? (
          <div className="owned-upgrade-analysis-results">
            <div className="section-heading">
              <div>
                <h3>
                  {iconic20Selection.size === 1
                    ? 'Analysis result'
                    : `Bundle analysis (${iconic20Selection.size} passes)`}
                </h3>
                <p className="import-hint">
                  Simulating {ICONIC_20_SIMULATED_RARITY} for:{' '}
                  {selectedIconic20PassLabels.length > 0
                    ? selectedIconic20PassLabels.join('; ')
                    : iconic20ProfilesLoading
                      ? 'Loading catalog rows…'
                      : 'Waiting for catalog rows…'}
                </p>
              </div>
              <button
                className="button compact"
                type="button"
                disabled={catalogAnalysisBusy}
                onClick={() => setIconic20Selection(new Set())}
              >
                Clear selection
              </button>
            </div>
            {iconic20AnalysisCandidates.length > 0 ? (
              <>
                <CheckerNetGainMetrics
                  baselineGuaranteed={collectionGuaranteedNow}
                  baselineWithPro={collectionWithProNow}
                  combinedGuaranteedNetDelta={iconic20Analysis.combinedGuaranteedNetDelta}
                  combinedWithProNetDelta={iconic20Analysis.combinedNetDelta}
                  baselineLabel="Your collection now"
                  afterLabel="After simulation"
                  netGainDetail={
                    iconic20Selection.size === 1
                      ? 'solo pass'
                      : 'bundle after same-sport overlap'
                  }
                />
                {iconic20Analysis.rows.length > 1 ? (
                  <>
                    <p className="import-hint">Per-pass contribution inside this bundle:</p>
                    <ul className="list compact-list">
                      {iconic20Analysis.rows.map((row) => {
                        const source = row.key.startsWith('catalog:') ? 'new' : 'upgrade'
                        return (
                          <li key={row.key}>
                            <strong>{row.name}</strong>
                            <small>
                              {row.sport} · {row.season} · {source} · adds{' '}
                              {formatSignedRax(displayRaxValue(row.marginalNetDelta))} net
                            </small>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                ) : null}
              </>
            ) : (
              <p className="empty">
                {iconic20ProfilesLoading
                  ? 'Loading catalog daily rows for selected passes…'
                  : 'Selected catalog passes need daily rows — try another pass or check catalog coverage.'}
              </p>
            )}
          </div>
        ) : (
          <p className="empty">
            Select owned upgrades and/or catalog passes above to run the {ICONIC_20_SIMULATED_RARITY}{' '}
            checker.
          </p>
        )}
      </CollapsiblePanel>
    </div>
  )
}
