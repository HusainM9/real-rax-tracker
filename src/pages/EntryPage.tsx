import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { formatClaimDay, formatRax, todayIsoLocal } from '../lib/format'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { parseRealAppToolsRows } from '../lib/realAppToolsImport'
import type { UsernameImportProgress } from '../lib/usernameImport'
import { useRaxData } from '../context/RaxDataContext'
import { SPORTS, type Sport } from '../types/rax'

const ENTRY_PAGE_SIZE = 50
const HEAVY_TABLE_THRESHOLD = 100

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize))
}

export default function EntryPage() {
  const {
    data,
    addCard,
    updateCard,
    deleteCard,
    addPerformance,
    addPerformances,
    updatePerformance,
    deletePerformance,
    importFromUsername,
  } = useRaxData()
  const [newCard, setNewCard] = useState({
    name: '',
    sport: 'NBA' as Sport,
    season: '',
    notes: '',
  })
  const [newPerformance, setNewPerformance] = useState({
    cardId: '',
    claimDay: todayIsoLocal(),
    raxEarned: '',
    note: '',
  })
  const [usernameImport, setUsernameImport] = useState({
    username: data.settings.savedUsername ?? '',
  })
  const [showHeavyTables, setShowHeavyTables] = useState(
    () => data.cards.length <= HEAVY_TABLE_THRESHOLD && data.performances.length <= HEAVY_TABLE_THRESHOLD,
  )
  const [cardsPage, setCardsPage] = useState(1)
  const [performancesPage, setPerformancesPage] = useState(1)
  const [usernameImportStatus, setUsernameImportStatus] = useState('')
  const [usernameImportProgress, setUsernameImportProgress] = useState<UsernameImportProgress | null>(
    null,
  )
  const [usernameImporting, setUsernameImporting] = useState(false)
  const [usernameImportFetchErrors, setUsernameImportFetchErrors] = useState(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const [showAdvancedPaste, setShowAdvancedPaste] = useState(false)
  const [bulkImport, setBulkImport] = useState({
    cardId: '',
    rawJson: '',
  })
  const [bulkImportStatus, setBulkImportStatus] = useState('')

  const cardsById = useMemo(() => new Map(data.cards.map((card) => [card.id, card])), [data.cards])
  const sortedPerformances = useMemo(
    () =>
      [...data.performances].sort(
        (a, b) =>
          b.claimDay.localeCompare(a.claimDay) ||
          (cardsById.get(a.cardId)?.name ?? '').localeCompare(cardsById.get(b.cardId)?.name ?? ''),
      ),
    [cardsById, data.performances],
  )
  const paginatedCards = useMemo(
    () => paginate(data.cards, cardsPage, ENTRY_PAGE_SIZE),
    [cardsPage, data.cards],
  )
  const paginatedPerformances = useMemo(
    () => paginate(sortedPerformances, performancesPage, ENTRY_PAGE_SIZE),
    [performancesPage, sortedPerformances],
  )
  const cardsPageTotal = pageCount(data.cards.length, ENTRY_PAGE_SIZE)
  const performancesPageTotal = pageCount(sortedPerformances.length, ENTRY_PAGE_SIZE)

  const submitCard = (event: FormEvent) => {
    event.preventDefault()
    if (!newCard.name.trim()) return
    addCard(newCard)
    setNewCard({ name: '', sport: newCard.sport, season: '', notes: '' })
  }

  const submitPerformance = (event: FormEvent) => {
    event.preventDefault()
    const cardId = newPerformance.cardId || data.cards[0]?.id || ''
    const raxEarned = Number(newPerformance.raxEarned)
    if (!cardId || !newPerformance.claimDay || !Number.isFinite(raxEarned) || raxEarned <= 0) return
    addPerformance({
      cardId,
      claimDay: newPerformance.claimDay,
      raxEarned,
      note: newPerformance.note,
    })
    setNewPerformance((current) => ({ ...current, cardId, raxEarned: '', note: '' }))
  }

  const submitUsernameImport = async (event: FormEvent) => {
    event.preventDefault()
    const username = usernameImport.username.trim()
    if (!username) return

    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    setUsernameImporting(true)
    setUsernameImportStatus('')
    setUsernameImportProgress(null)
    setUsernameImportFetchErrors(0)

    try {
      const result = await importFromUsername(username, {
        signal: controller.signal,
        onProgress: setUsernameImportProgress,
      })
      const errorNote =
        result.errors.length > 0 ? ` · ${result.errors.length} pass fetch error(s)` : ''
      const skipNote =
        result.passesSkipped > 0
          ? ` · skipped ${result.passesSkipped} pass${result.passesSkipped === 1 ? '' : 'es'} by rarity`
          : ''
      setUsernameImportFetchErrors(result.errors.length)
      setUsernameImportStatus(
        `Imported ${result.rowsImported} RAX row${result.rowsImported === 1 ? '' : 's'} from ${
          result.passesFetched
        } pass${result.passesFetched === 1 ? '' : 'es'} (${result.cardsCreated} new card${
          result.cardsCreated === 1 ? '' : 's'
        }, ${result.cardsUpdated} updated)${result.skipped ? ` · skipped ${result.skipped} duplicate/invalid row${result.skipped === 1 ? '' : 's'}` : ''}${skipNote}${errorNote}.`,
      )
      if (result.rowsImported >= HEAVY_TABLE_THRESHOLD) {
        setShowHeavyTables(false)
      }
      setCardsPage(1)
      setPerformancesPage(1)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setUsernameImportStatus('Import cancelled.')
      } else {
        setUsernameImportStatus(
          error instanceof Error ? error.message : 'Import failed. Try again or use manual paste.',
        )
      }
    } finally {
      setUsernameImporting(false)
      setUsernameImportProgress(null)
      importAbortRef.current = null
    }
  }

  const cancelUsernameImport = () => {
    importAbortRef.current?.abort()
  }

  const submitBulkImport = (event: FormEvent) => {
    event.preventDefault()
    const cardId = bulkImport.cardId || data.cards[0]?.id || ''
    if (!cardId) return

    try {
      const card = data.cards.find((item) => item.id === cardId)
      const parsed = parseRealAppToolsRows(bulkImport.rawJson, {
        sport: card?.sport,
        rarityLabel: card?.rarityLabel,
        applyOtdMultiplier: Boolean(card?.sport && card?.rarityLabel),
        passKind: card?.passKind ?? 'player',
      })
      const existingKeys = new Set(
        data.performances.map(
          (performance) =>
            `${performance.cardId}|${performance.claimDay}|${performance.raxEarned}`,
        ),
      )
      const imported = parsed.rows
        .map((row) => ({ ...row, cardId }))
        .filter((row) => !existingKeys.has(`${row.cardId}|${row.claimDay}|${row.raxEarned}`))
      const duplicateCount = parsed.rows.length - imported.length

      addPerformances(imported)
      setBulkImport((current) => ({ ...current, cardId, rawJson: '' }))
      setBulkImportStatus(
        `Imported ${imported.length} row${imported.length === 1 ? '' : 's'}${
          duplicateCount || parsed.skipped
            ? ` · skipped ${duplicateCount + parsed.skipped} duplicate/invalid row${
                duplicateCount + parsed.skipped === 1 ? '' : 's'
              }`
            : ''
        }.`,
      )
    } catch (error) {
      setBulkImportStatus(error instanceof Error ? error.message : 'Could not parse pasted JSON.')
    }
  }

  return (
    <div className="page-stack">
      <form className="panel form-panel import-panel" onSubmit={submitUsernameImport}>
        <div className="section-heading">
          <div>
            <h2>Import from Real username</h2>
            <p>
              Enter your @username to fetch Legendary+ player and team passes with daily RAX
              automatically. Data via{' '}
              <a href="https://realapp.tools" target="_blank" rel="noreferrer">
                realapp.tools
              </a>{' '}
              / Meowbot — no Real API key needed. Re-importing updates existing cards by pass ID.
            </p>
          </div>
          <span>Auto import</span>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Real username</span>
            <input
              value={usernameImport.username}
              placeholder="yourname"
              disabled={usernameImporting}
              onChange={(event) =>
                setUsernameImport((current) => ({ ...current, username: event.target.value }))
              }
            />
          </label>
        </div>
        <p className="import-hint">
          Imports Legendary, Mystic, and Iconic passes only — fewer API calls and faster loads.
          Your username is saved in this browser after a successful import.
        </p>
        <div className="button-row">
          <button
            className="button primary"
            type="submit"
            disabled={usernameImporting || usernameImport.username.trim().length === 0}
          >
            {usernameImporting ? 'Importing…' : 'Import Legendary+ passes'}
          </button>
          {usernameImporting ? (
            <button className="button" type="button" onClick={cancelUsernameImport}>
              Cancel
            </button>
          ) : null}
          <Link className="button" to="/help">
            How it works
          </Link>
        </div>
        {usernameImportProgress ? (
          <p className="import-progress">
            {usernameImportProgress.phase === 'resolving'
              ? usernameImportProgress.label
              : `Fetching pass ${usernameImportProgress.current}/${usernameImportProgress.total} — ${usernameImportProgress.label}`}
          </p>
        ) : null}
        {usernameImportStatus ? <p className="import-status">{usernameImportStatus}</p> : null}
        {usernameImportFetchErrors > 0 && !usernameImporting ? (
          <p className="import-hint">
            <strong>
              {usernameImportFetchErrors} pass{usernameImportFetchErrors === 1 ? '' : 'es'} had no
              daily RAX from realapp.tools.
            </strong>{' '}
            Paste earnings from{' '}
            <a href="https://www.realapp.com" target="_blank" rel="noreferrer">
              realapp.com
            </a>{' '}
            using{' '}
            <button
              className="link-button"
              type="button"
              onClick={() => setShowAdvancedPaste(true)}
            >
              Advanced paste
            </button>{' '}
            below.
          </p>
        ) : null}
        {usernameImportStatus && !usernameImporting ? (
          <div className="button-row">
            <Link className="button primary" to="/">
              View Dashboard
            </Link>
            <Link className="button" to="/calendar">
              Open Calendar
            </Link>
          </div>
        ) : null}
      </form>

      <section className="content-grid">
        <form className="panel form-panel" onSubmit={submitCard}>
          <div className="section-heading">
            <h2>Add player card</h2>
            <span>{data.cards.length} saved</span>
          </div>
          <label className="field">
            <span>Player</span>
            <input
              value={newCard.name}
              placeholder="Steph Curry"
              onChange={(event) => setNewCard((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Sport</span>
              <select
                value={newCard.sport}
                onChange={(event) => setNewCard((current) => ({ ...current, sport: event.target.value as Sport }))}
              >
                {SPORTS.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Season/card label</span>
              <input
                value={newCard.season}
                placeholder="2022-23 Rare"
                onChange={(event) => setNewCard((current) => ({ ...current, season: event.target.value }))}
              />
            </label>
          </div>
          <label className="field">
            <span>Notes</span>
            <input
              value={newCard.notes}
              placeholder="Optional"
              onChange={(event) => setNewCard((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
          <button className="button primary" type="submit">
            Add card
          </button>
        </form>

        <form className="panel form-panel" onSubmit={submitPerformance}>
          <div className="section-heading">
            <h2>Add daily RAX</h2>
            <span>{data.performances.length} entries</span>
          </div>
          <label className="field">
            <span>Player card</span>
            <select
              value={newPerformance.cardId || data.cards[0]?.id || ''}
              disabled={data.cards.length === 0}
              onChange={(event) => setNewPerformance((current) => ({ ...current, cardId: event.target.value }))}
            >
              {data.cards.length === 0 ? (
                <option value="">Import your collection or add a card first</option>
              ) : null}
              {data.cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name} · {card.sport} {card.season}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Claim day</span>
              <input
                type="date"
                value={newPerformance.claimDay}
                onChange={(event) => setNewPerformance((current) => ({ ...current, claimDay: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>RAX earned</span>
              <input
                type="number"
                min="0"
                step="1"
                value={newPerformance.raxEarned}
                placeholder="29"
                onChange={(event) => setNewPerformance((current) => ({ ...current, raxEarned: event.target.value }))}
              />
            </label>
          </div>
          <label className="field">
            <span>Note</span>
            <input
              value={newPerformance.note}
              placeholder="Optional performance note"
              onChange={(event) => setNewPerformance((current) => ({ ...current, note: event.target.value }))}
            />
          </label>
          <button className="button primary" type="submit" disabled={data.cards.length === 0}>
            Add RAX entry
          </button>
        </form>
      </section>

      <section className="panel form-panel">
        <div className="section-heading">
          <div>
            <h2>Advanced: paste earnings JSON</h2>
            <p>
              Paste daily RAX for one card at a time from realapp.tools or realapp.com. For cards
              you do not own yet, use the <Link to="/potential">Potential</Link> tab instead.
            </p>
          </div>
          <button
            className="button"
            type="button"
            onClick={() => setShowAdvancedPaste((current) => !current)}
          >
            {showAdvancedPaste ? 'Hide' : 'Show'}
          </button>
        </div>
        {showAdvancedPaste ? (
          <>
            <section className="panel import-hint">
              <p>
                <strong>When username import misses daily RAX</strong> — use realapp.com on a{' '}
                <strong>desktop</strong> browser (Real Pro). Mobile redirects to the app store.
              </p>
              <ol className="help-list ordered">
                <li>
                  Open{' '}
                  <a href="https://www.realapp.com" target="_blank" rel="noreferrer">
                    realapp.com
                  </a>{' '}
                  and log in.
                </li>
                <li>
                  Open DevTools (<kbd>F12</kbd>) and the <strong>Network</strong> tab before loading
                  earnings.
                </li>
                <li>
                  Go to the player&apos;s season and open the card earnings screen by clicking the{' '}
                  <strong>RAX icon</strong> on a performance.
                </li>
                <li>
                  In Network, filter for <code>userpassearnings</code> and click the request whose
                  URL includes <code>playerBoxScoreId</code> (for example{' '}
                  <code>
                    userpassearnings/nba/season/2023/entity/player/…?playerBoxScoreId=…
                  </code>
                  ).
                </li>
                <li>
                  Copy the full <strong>Response</strong> JSON — it should contain an{' '}
                  <code>earnings</code> array with <code>day</code> and <code>earnings</code> fields.
                </li>
                <li>
                  Select the matching player card below, paste the JSON, and click{' '}
                  <strong>Import pasted rows</strong>. OTD rarity is applied from the card when set.
                </li>
              </ol>
            </section>
            <form onSubmit={submitBulkImport}>
            <div className="form-grid">
              <label className="field">
                <span>Player card</span>
                <select
                  value={bulkImport.cardId || data.cards[0]?.id || ''}
                  disabled={data.cards.length === 0}
                  onChange={(event) =>
                    setBulkImport((current) => ({ ...current, cardId: event.target.value }))
                  }
                >
                  {data.cards.length === 0 ? (
                    <option value="">Import your collection or add a card first</option>
                  ) : null}
                  {data.cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.name} · {card.sport} {card.season}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Earnings JSON</span>
              <textarea
                className="bulk-import-textarea"
                value={bulkImport.rawJson}
                placeholder='{"rows":[{"day":"2025-08-22","earnings":26}]} or {"earnings":[{"day":"2025-08-22","earnings":26,"playerBoxScoreIds":[123]}]}'
                onChange={(event) =>
                  setBulkImport((current) => ({ ...current, rawJson: event.target.value }))
                }
              />
            </label>
            <div className="button-row">
              <button
                className="button primary"
                type="submit"
                disabled={data.cards.length === 0 || bulkImport.rawJson.trim().length === 0}
              >
                Import pasted rows
              </button>
              {bulkImportStatus ? <p className="import-status">{bulkImportStatus}</p> : null}
            </div>
          </form>
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Player cards</h2>
            <p>
              {data.cards.length} saved
              {data.cards.length > ENTRY_PAGE_SIZE
                ? ` · showing page ${cardsPage} of ${cardsPageTotal}`
                : ''}
            </p>
          </div>
          {data.cards.length > HEAVY_TABLE_THRESHOLD ? (
            <button className="button" type="button" onClick={() => setShowHeavyTables((current) => !current)}>
              {showHeavyTables ? 'Hide tables' : 'Show tables'}
            </button>
          ) : (
            <span>Edit inline</span>
          )}
        </div>
        {!showHeavyTables && data.cards.length > HEAVY_TABLE_THRESHOLD ? (
          <p className="empty">
            Large collection loaded. Use Dashboard, Calendar, and Cards to explore totals.{' '}
            <button className="link-button" type="button" onClick={() => setShowHeavyTables(true)}>
              Show editable tables
            </button>
          </p>
        ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Sport</th>
                <th>Season/card</th>
                <th>Rarity</th>
                <th>Preview as</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.cards.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    Import your collection above or add your first player card.
                  </td>
                </tr>
              ) : (
                paginatedCards.map((card) => (
                  <tr key={card.id}>
                    <td>
                      <input value={card.name} onChange={(event) => updateCard(card.id, { name: event.target.value })} />
                    </td>
                    <td>
                      <select
                        value={card.sport}
                        onChange={(event) => updateCard(card.id, { sport: event.target.value as Sport })}
                      >
                        {SPORTS.map((sport) => (
                          <option key={sport} value={sport}>
                            {sport}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={card.season}
                        onChange={(event) => updateCard(card.id, { season: event.target.value })}
                      />
                    </td>
                    <td>{card.rarityLabel || '—'}</td>
                    <td>
                      <select
                        value={card.simulatedRarityLabel ?? ''}
                        aria-label={`Preview rarity for ${card.name}`}
                        onChange={(event) =>
                          updateCard(card.id, {
                            simulatedRarityLabel: event.target.value || undefined,
                          })
                        }
                      >
                        {RARITY_PREVIEW_OPTIONS.map((option) => (
                          <option key={option || 'actual'} value={option}>
                            {option || 'Actual'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={card.notes} onChange={(event) => updateCard(card.id, { notes: event.target.value })} />
                    </td>
                    <td>
                      <button className="button danger" type="button" onClick={() => deleteCard(card.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
        {showHeavyTables && data.cards.length > ENTRY_PAGE_SIZE ? (
          <div className="table-pagination">
            <button
              className="button"
              type="button"
              disabled={cardsPage <= 1}
              onClick={() => setCardsPage((page) => page - 1)}
            >
              Previous
            </button>
            <span>
              Page {cardsPage} of {cardsPageTotal}
            </span>
            <button
              className="button"
              type="button"
              disabled={cardsPage >= cardsPageTotal}
              onClick={() => setCardsPage((page) => page + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>RAX entries</h2>
            <p>
              {sortedPerformances.length} total
              {sortedPerformances.length > ENTRY_PAGE_SIZE
                ? ` · showing page ${performancesPage} of ${performancesPageTotal}`
                : ''}
            </p>
          </div>
          <span>Every row can become a claim candidate</span>
        </div>
        {!showHeavyTables && sortedPerformances.length > HEAVY_TABLE_THRESHOLD ? (
          <p className="empty">
            {sortedPerformances.length.toLocaleString()} RAX rows loaded.{' '}
            <button className="link-button" type="button" onClick={() => setShowHeavyTables(true)}>
              Show editable table
            </button>{' '}
            (paginated — use Dashboard for planning)
          </p>
        ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Player card</th>
                <th>RAX</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sortedPerformances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    Import your collection or add RAX entries to start seeing overlaps.
                  </td>
                </tr>
              ) : (
                paginatedPerformances.map((performance) => {
                  const card = cardsById.get(performance.cardId)
                  return (
                    <tr key={performance.id}>
                      <td>
                        <input
                          type="date"
                          value={performance.claimDay}
                          onChange={(event) => updatePerformance(performance.id, { claimDay: event.target.value })}
                          aria-label={`Claim day ${formatClaimDay(performance.claimDay)}`}
                        />
                      </td>
                      <td>
                        {data.cards.length <= 100 ? (
                          <select
                            value={performance.cardId}
                            onChange={(event) =>
                              updatePerformance(performance.id, { cardId: event.target.value })
                            }
                          >
                            {data.cards.map((cardOption) => (
                              <option key={cardOption.id} value={cardOption.id}>
                                {cardOption.name} · {cardOption.sport}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>
                            {card ? `${card.name} · ${card.sport}` : 'Unknown card'}
                          </span>
                        )}
                        {card ? <small className="table-sub">{card.season}</small> : null}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={performance.raxEarned}
                          onChange={(event) =>
                            updatePerformance(performance.id, {
                              raxEarned: Math.max(0, Number(event.target.value) || 0),
                            })
                          }
                          aria-label={`${formatRax(performance.raxEarned)} RAX`}
                        />
                      </td>
                      <td>
                        <input
                          value={performance.note}
                          onChange={(event) => updatePerformance(performance.id, { note: event.target.value })}
                        />
                      </td>
                      <td>
                        <button className="button danger" type="button" onClick={() => deletePerformance(performance.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        )}
        {showHeavyTables && sortedPerformances.length > ENTRY_PAGE_SIZE ? (
          <div className="table-pagination">
            <button
              className="button"
              type="button"
              disabled={performancesPage <= 1}
              onClick={() => setPerformancesPage((page) => page - 1)}
            >
              Previous
            </button>
            <span>
              Page {performancesPage} of {performancesPageTotal}
            </span>
            <button
              className="button"
              type="button"
              disabled={performancesPage >= performancesPageTotal}
              onClick={() => setPerformancesPage((page) => page + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
