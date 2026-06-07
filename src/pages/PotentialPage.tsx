import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { displayRaxValue } from '../lib/displayRax'
import { formatClaimDay, formatRax } from '../lib/format'
import { analyzePotentialCard, type PotentialAnalysisResult } from '../lib/potentialAnalysis'
import { realappToolsShutdownLabel } from '../lib/importShutdown'
import { cachedEarningsToJson } from '../lib/playerEarningsCache'
import { formatSignedRax } from '../lib/removeCardAnalysis'
import { parseRealAppToolsRows, type ParsedRealAppToolsRow } from '../lib/realAppToolsImport'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { useRaxData } from '../context/RaxDataContext'
import { SPORTS, type Sport } from '../types/rax'

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

export default function PotentialPage() {
  const { data, addPotentialCard, updatePotentialCard, deletePotentialCard } = useRaxData()
  const [form, setForm] = useState(EMPTY_FORM)
  const [potentialRows, setPotentialRows] = useState<ParsedRealAppToolsRow[]>([])
  const [status, setStatus] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showTutorial, setShowTutorial] = useState(true)
  const [cachedProfileQuery, setCachedProfileQuery] = useState('')
  const cachedEarningsProfiles = useMemo(
    () => [...(data.cachedPlayerEarnings ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data.cachedPlayerEarnings],
  )
  const filteredCachedEarningsProfiles = useMemo(() => {
    const query = cachedProfileQuery.trim().toLowerCase()
    if (!query) return []
    return cachedEarningsProfiles
      .filter((profile) =>
        [
          profile.name,
          profile.sport,
          profile.season,
          String(profile.seasonYear),
          profile.rarityLabel ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 24)
  }, [cachedEarningsProfiles, cachedProfileQuery])

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

  const loadCachedEarnings = (cacheKey: string) => {
    const profile = data.cachedPlayerEarnings?.find((item) => item.cacheKey === cacheKey)
    if (!profile) return
    setEditingId(null)
    setPotentialRows([])
    setForm({
      name: profile.name,
      sport: profile.sport,
      season: profile.season,
      notes: `Loaded from cached ${profile.source.replace('_', ' ')}`,
      rawJson: cachedEarningsToJson(profile),
      previewAs: profile.rarityLabel ?? '',
    })
    setStatus(
      `Loaded cached earnings for ${profile.name} (${profile.rows.length} row${
        profile.rows.length === 1 ? '' : 's'
      }). Click Analyze potential card to run the what-if.`,
    )
  }

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">What-if</p>
          <h2>Potential card checker</h2>
          <p>
            Test a player or team pass you do not own yet. Load cached player earnings from prior
            imports or paste daily RAX JSON from realapp.com. Saved profiles stay out of your real
            totals.
          </p>
        </div>
        <Link className="button" to="/overlaps">
          View overlaps
        </Link>
      </section>

      <section className="panel help-section">
        <div className="section-heading">
          <div>
            <h2>Manual import walkthrough</h2>
            <p>
              Username import closes after {realappToolsShutdownLabel()}; after that, use cached
              earnings or paste one card at a time from realapp.com.
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

      <form className="panel form-panel" onSubmit={submitAnalyze}>
        <div className="section-heading">
          <div>
            <h2>{editingId ? 'Edit profile' : 'New potential card'}</h2>
            <p>
              {editingId
                ? 'Update fields or JSON, then analyze again or save.'
                : 'Enter profile details, load cached earnings, or paste realapp.com JSON.'}
            </p>
          </div>
          <span className="badge">{editingId ? 'Editing' : 'Draft'}</span>
        </div>
        {cachedEarningsProfiles.length > 0 ? (
          <section className="cached-profile-panel">
            <div className="section-heading">
              <div>
                <h3>Cached player earnings</h3>
                <p>
                  Player daily earnings saved from previous imports. Search here to run a what-if
                  without copying JSON again.
                </p>
              </div>
              <span className="badge">{cachedEarningsProfiles.length} cached</span>
            </div>
            <label className="field">
              <span>Search cached profiles</span>
              <input
                type="search"
                value={cachedProfileQuery}
                placeholder="Player name, sport, season, rarity…"
                onChange={(event) => setCachedProfileQuery(event.target.value)}
              />
            </label>
            {!cachedProfileQuery.trim() ? (
              <p className="card-picker-empty">
                Start typing to find cached base earnings from previous imports. These profiles are
                reusable what-if inputs, not saved Potential cards.
              </p>
            ) : filteredCachedEarningsProfiles.length === 0 ? (
              <p className="card-picker-empty">No cached profiles match that search.</p>
            ) : (
              <div className="cached-profile-list" role="listbox" aria-label="Cached player earnings">
                {filteredCachedEarningsProfiles.map((profile) => (
                  <button
                    key={profile.cacheKey}
                    type="button"
                    className="cached-profile-item"
                    onClick={() => loadCachedEarnings(profile.cacheKey)}
                  >
                    <strong>{profile.name}</strong>
                    <small>
                      {profile.sport} · {profile.season || profile.seasonYear}
                      {profile.rarityLabel ? ` · ${profile.rarityLabel}` : ''} · {profile.rows.length}{' '}
                      row{profile.rows.length === 1 ? '' : 's'}
                    </small>
                    <span>Use in Potential</span>
                  </button>
                ))}
              </div>
            )}
            <p className="import-hint">
              Cached profiles are reusable base earnings. Pick a profile, choose a rarity in
              Preview as, then analyze the impact against your collection.
            </p>
          </section>
        ) : null}
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
