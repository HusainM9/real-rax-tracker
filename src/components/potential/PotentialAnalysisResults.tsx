import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PassIdentity } from '../PassIdentity'
import { displayRaxValue } from '../../lib/displayRax'
import { formatClaimDay, formatRax } from '../../lib/format'
import {
  netWithProDelta,
  type PotentialAnalysisResult,
  type PotentialClaimDayBreakdown,
  type PotentialClaimLadderEntry,
} from '../../lib/potentialAnalysis'
import { RECOMMENDATION_SIMULATED_RARITY } from '../../lib/passRecommendation'
import { formatSignedRax } from '../../lib/removeCardAnalysis'

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
      <PassIdentity
        name={entry.name}
        passKind={entry.passKind === 'team' ? 'team' : 'player'}
        sport={entry.sport}
        avatar={entry.avatar}
        meta={
          <>
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
          </>
        }
      />
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

export function CheckerNetGainMetrics({
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

export function PotentialAnalysisResults({
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
        Net gain is the change in collection claimable RAX (top 2 per sport + Pro), always simulated
        with Pro on.
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
          <small className="table-sub">Collection claimable change (with Pro)</small>
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
                        <PassIdentity
                          name={row.name}
                          passKind={row.passKind}
                          sport={row.sport}
                          avatar={row.avatar}
                          meta={row.season || undefined}
                        />
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
                    <PassIdentity
                      name={candidate.card.name}
                      passKind={candidate.card.passKind === 'team' ? 'team' : 'player'}
                      sport={candidate.card.sport}
                      avatar={candidate.card.avatar}
                      meta={
                        <>
                          {formatClaimDay(day.claimDay)} · was{' '}
                          {previousStatus === 'pro-bonus' ? 'Pro bonus' : 'guaranteed'} · now
                          overlap
                        </>
                      }
                    />
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
