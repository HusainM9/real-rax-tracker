import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { displayRaxValue } from '../lib/displayRax'
import { formatClaimDay, formatRax } from '../lib/format'
import { analyzePotentialCard } from '../lib/potentialAnalysis'
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

export default function PotentialPage() {
  const { data, addPotentialCard, updatePotentialCard, deletePotentialCard } = useRaxData()
  const [form, setForm] = useState(EMPTY_FORM)
  const [potentialRows, setPotentialRows] = useState<ParsedRealAppToolsRow[]>([])
  const [status, setStatus] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showTutorial, setShowTutorial] = useState(true)

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
      const parsed = parseRealAppToolsRows(form.rawJson)
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

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">What-if</p>
          <h2>Potential card checker</h2>
          <p>
            Test a player or team pass you do not own yet. Paste daily RAX from{' '}
            <a href="https://realapp.tools" target="_blank" rel="noreferrer">
              realapp.tools
            </a>{' '}
            and see what would be claimable vs overlapped against your collection. Saved profiles
            stay out of your real totals.
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
            <p>Paste one card at a time from realapp.tools — no username import needed.</p>
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
                <a href="https://realapp.tools" target="_blank" rel="noreferrer">
                  realapp.tools
                </a>{' '}
                and go to the <strong>OTD Table</strong>.
              </li>
              <li>
                Find the player or team pass you are considering and open their profile. Click the{' '}
                <strong>calendar</strong> on that profile to load daily earnings.
              </li>
              <li>
                <strong>On desktop (PC/Mac):</strong> press <kbd>F12</kbd> or right-click →{' '}
                <strong>Inspect</strong>, open the <strong>Network</strong> tab, then refresh or
                click the calendar again. Filter for <code>market-data</code>, click that request,
                and copy the JSON from the Response panel.
              </li>
              <li>
                <strong>On mobile:</strong> use your browser&apos;s desktop site mode if needed, or
                connect remote debugging (Safari Web Inspector on iOS, Chrome{' '}
                <code>chrome://inspect</code> on Android). Open Network, trigger the calendar load,
                and copy the <code>market-data</code> response JSON. Alternatively, paste on desktop
                first and save the profile here for later.
              </li>
              <li>
                Fill in the player name, sport, and season/card label below, paste the JSON, and
                click <strong>Analyze potential card</strong>. Paste base earnings from the JSON —
                use <strong>Preview as</strong> to simulate OTD at a higher rarity (e.g. Iconic).
              </li>
              <li>
                Click <strong>Save profile</strong> to keep the player info and JSON for later.
              </li>
            </ol>
            <p className="import-hint">
              The JSON usually looks like{' '}
              <code>{'{"rows":[{"day":"2025-08-22","earnings":26,...}]}'}</code> or a plain array of
              row objects from the <code>market-data</code> request.
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
          <span>{data.potentialCards.length} saved</span>
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
                : 'Enter profile details and paste realapp.tools JSON.'}
            </p>
          </div>
          <span>{editingId ? 'Editing' : 'Draft'}</span>
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
          <span>realapp.tools JSON</span>
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
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Analysis result</h2>
              <p>
                {formatRax(displayRaxValue(potentialAnalysis.claimableRax))} claimable
                · {formatRax(displayRaxValue(potentialAnalysis.overlapRax))}{' '}
                overlapped for this card ·{' '}
                {formatRax(
                  displayRaxValue(
                    potentialAnalysis.claimableRax - potentialAnalysis.displacedRax,
                  ),
                )}{' '}
                net claimable change after displaced cards.
                {form.previewAs ? (
                  <>
                    {' '}
                    OTD preview: <strong>{form.previewAs}</strong>.
                  </>
                ) : null}
              </p>
            </div>
            <span>
              {potentialAnalysis.displacedExisting.length} existing card
              {potentialAnalysis.displacedExisting.length === 1 ? '' : 's'} displaced
            </span>
          </div>
          <section className="content-grid">
            <div>
              <p className="mini-heading">Potential card days</p>
              <div className="list">
                {potentialAnalysis.candidates.map(({ day, candidate }) => (
                  <div className={`list-row claim-row ${candidate.status}`} key={candidate.performance.id}>
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
            </div>

            <div>
              <p className="mini-heading">Existing cards displaced</p>
              {potentialAnalysis.displacedExisting.length === 0 ? (
                <p className="empty">No currently claimable cards would be pushed out.</p>
              ) : (
                <div className="list">
                  {potentialAnalysis.displacedExisting.map(({ day, candidate, previousStatus }) => (
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
            </div>
          </section>
        </section>
      ) : null}
    </div>
  )
}
