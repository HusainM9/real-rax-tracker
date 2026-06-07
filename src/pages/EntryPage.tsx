import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { formatClaimDay, formatRax, todayIsoLocal } from '../lib/format'
import { RARITY_PREVIEW_OPTIONS } from '../lib/effectiveRax'
import { usernameImportDisabled, realappToolsShutdownLabel } from '../lib/importShutdown'
import { cachedEarningsToJson } from '../lib/playerEarningsCache'
import { parseRealAppToolsRows } from '../lib/realAppToolsImport'
import { reportImportAdminEvents } from '../lib/adminEvents'
import {
  getFailedPlayerPasses,
  type FailedPlayerPassImport,
  type UsernameImportProgress,
} from '../lib/usernameImport'
import { useRaxData } from '../context/RaxDataContext'
import { SPORTS, type Sport } from '../types/rax'

const ENTRY_PAGE_SIZE = 50
const HEAVY_TABLE_THRESHOLD = 100
const EXISTING_CARD_SEARCH_LIMIT = 50

function matchesExistingCardSearch(
  query: string,
  card: {
    name: string
    sport: string
    season: string
    rarityLabel?: string
  },
): boolean {
  const haystack = [card.name, card.sport, card.season, card.rarityLabel ?? '']
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize))
}

const CARD_RARITY_OPTIONS = RARITY_PREVIEW_OPTIONS.filter((option) => option.length > 0)

type CardEntryMode = 'new' | 'existing'
type EarningsInputMode = 'paste' | 'single'

function emptyCardEntry(cards: { id: string }[], existingCardId = '') {
  const resolvedCardId = existingCardId || cards[0]?.id || ''
  return {
    mode: 'new' as CardEntryMode,
    existingCardId: resolvedCardId,
    name: '',
    sport: 'NBA' as Sport,
    season: '',
    rarityLabel: '',
    passKind: 'player' as 'player' | 'team',
    notes: '',
    earningsInput: 'paste' as EarningsInputMode,
    rawJson: '',
    claimDay: todayIsoLocal(),
    raxEarned: '',
    singleNote: '',
  }
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
    importFromAdminOwnership,
    saveCardProfile,
    restoreCardProfile,
    deleteCardProfile,
  } = useRaxData()
  const [cardEntry, setCardEntry] = useState(() => emptyCardEntry(data.cards))
  const [cardEntryStatus, setCardEntryStatus] = useState('')
  const [profileStatus, setProfileStatus] = useState('')
  const cardEntryRef = useRef<HTMLFormElement>(null)
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
  const [adminSnapshotImporting, setAdminSnapshotImporting] = useState(false)
  const [usernameImportFailedPasses, setUsernameImportFailedPasses] = useState<
    FailedPlayerPassImport[]
  >([])
  const [existingCardQuery, setExistingCardQuery] = useState('')
  const [cachedProfileQuery, setCachedProfileQuery] = useState('')
  const importAbortRef = useRef<AbortController | null>(null)

  const cardsById = useMemo(() => new Map(data.cards.map((card) => [card.id, card])), [data.cards])
  const importDisabled = usernameImportDisabled()
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

  const sortedExistingCards = useMemo(
    () => [...data.cards].sort((a, b) => a.name.localeCompare(b.name)),
    [data.cards],
  )

  const selectedExistingCardId = cardEntry.existingCardId || data.cards[0]?.id || ''

  const filteredExistingCards = useMemo(() => {
    const query = existingCardQuery.trim().toLowerCase()
    const matches = query
      ? sortedExistingCards.filter((card) => matchesExistingCardSearch(query, card))
      : sortedExistingCards
    const limited = matches.slice(0, EXISTING_CARD_SEARCH_LIMIT)
    if (
      selectedExistingCardId &&
      !limited.some((card) => card.id === selectedExistingCardId)
    ) {
      const selected = sortedExistingCards.find((card) => card.id === selectedExistingCardId)
      if (selected) {
        return [selected, ...limited.slice(0, EXISTING_CARD_SEARCH_LIMIT - 1)]
      }
    }
    return limited
  }, [existingCardQuery, selectedExistingCardId, sortedExistingCards])

  const existingCardSearchHint =
    data.cards.length === 0
      ? 'Import your collection or add a new card first.'
      : existingCardQuery.trim()
        ? `${filteredExistingCards.length} match${filteredExistingCards.length === 1 ? '' : 'es'}`
        : `Showing first ${Math.min(sortedExistingCards.length, EXISTING_CARD_SEARCH_LIMIT)} of ${sortedExistingCards.length} — search to narrow`

  const loadCachedEarnings = (cacheKey: string) => {
    const profile = data.cachedPlayerEarnings?.find((item) => item.cacheKey === cacheKey)
    if (!profile) return
    const rawJson = cachedEarningsToJson(profile)
    setCardEntry((current) => ({
      ...current,
      mode: 'new',
      name: profile.name,
      sport: profile.sport,
      season: profile.season,
      rarityLabel: profile.rarityLabel ?? current.rarityLabel,
      passKind: profile.passKind,
      earningsInput: 'paste',
      rawJson,
    }))
    setCardEntryStatus(
      `Loaded cached earnings for ${profile.name} (${profile.rows.length} row${
        profile.rows.length === 1 ? '' : 's'
      }). Review the card details, then import earnings.`,
    )
  }

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

  const openCardEntryForExisting = () => {
    setCardEntry((current) => ({
      ...emptyCardEntry(data.cards, current.existingCardId || data.cards[0]?.id || ''),
      mode: 'existing',
      existingCardId: current.existingCardId || data.cards[0]?.id || '',
      earningsInput: 'paste',
    }))
    cardEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const submitCardEntry = (event: FormEvent) => {
    event.preventDefault()
    setCardEntryStatus('')

    let cardId = cardEntry.existingCardId
    let cardMeta: { sport: Sport; rarityLabel?: string; passKind?: 'player' | 'team' }

    if (cardEntry.mode === 'new') {
      if (!cardEntry.name.trim()) {
        setCardEntryStatus('Enter a player name.')
        return
      }
      cardId = addCard({
        name: cardEntry.name,
        sport: cardEntry.sport,
        season: cardEntry.season,
        notes: cardEntry.notes,
        rarityLabel: cardEntry.rarityLabel || undefined,
        passKind: cardEntry.passKind,
      })
      cardMeta = {
        sport: cardEntry.sport,
        rarityLabel: cardEntry.rarityLabel || undefined,
        passKind: cardEntry.passKind,
      }
    } else {
      if (!cardId) {
        setCardEntryStatus('Select a player card.')
        return
      }
      const existing = data.cards.find((card) => card.id === cardId)
      if (!existing) {
        setCardEntryStatus('Selected card was not found.')
        return
      }
      cardMeta = {
        sport: existing.sport,
        rarityLabel: existing.rarityLabel,
        passKind: existing.passKind,
      }
    }

    const hasPaste = cardEntry.earningsInput === 'paste' && cardEntry.rawJson.trim().length > 0
    const raxEarned = Number(cardEntry.raxEarned)
    const hasSingle =
      cardEntry.earningsInput === 'single' &&
      cardEntry.claimDay.length > 0 &&
      Number.isFinite(raxEarned) &&
      raxEarned > 0

    if (!hasPaste && !hasSingle) {
      if (cardEntry.mode === 'new') {
        setCardEntryStatus(`Added ${cardEntry.name.trim()}. Paste earnings JSON below when ready.`)
        setCardEntry({
          ...emptyCardEntry(data.cards, cardId),
          mode: 'existing',
          existingCardId: cardId,
          earningsInput: 'paste',
        })
      } else {
        setCardEntryStatus('Paste earnings JSON or switch to single day and enter RAX.')
      }
      return
    }

    const messages: string[] = []
    if (cardEntry.mode === 'new') {
      messages.push(`Added ${cardEntry.name.trim()}`)
    }

    if (hasPaste) {
      try {
        const parsed = parseRealAppToolsRows(cardEntry.rawJson, {
          sport: cardMeta.sport,
          rarityLabel: cardMeta.rarityLabel,
          applyOtdMultiplier: Boolean(cardMeta.rarityLabel),
          passKind: cardMeta.passKind ?? 'player',
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

        if (imported.length > 0) {
          addPerformances(imported)
        }

        messages.push(
          `imported ${imported.length} RAX row${imported.length === 1 ? '' : 's'}${
            duplicateCount || parsed.skipped
              ? ` (skipped ${duplicateCount + parsed.skipped} duplicate/invalid)`
              : ''
          }`,
        )
      } catch (error) {
        setCardEntryStatus(
          cardEntry.mode === 'new'
            ? `Card was added, but earnings JSON failed: ${
                error instanceof Error ? error.message : 'Could not parse pasted JSON.'
              }`
            : error instanceof Error
              ? error.message
              : 'Could not parse pasted JSON.',
        )
        if (cardEntry.mode === 'new') {
          setCardEntry((current) => ({
            ...emptyCardEntry(data.cards, cardId),
            mode: 'existing',
            existingCardId: cardId,
            rawJson: current.rawJson,
            earningsInput: 'paste',
          }))
        }
        return
      }
    }

    if (hasSingle) {
      addPerformance({
        cardId,
        claimDay: cardEntry.claimDay,
        raxEarned,
        note: cardEntry.singleNote,
      })
      messages.push('added 1 RAX row')
    }

    saveCardProfile(cardId, hasPaste ? cardEntry.rawJson : undefined)
    messages.push('saved to profile')
    setCardEntryStatus(`${messages.join(' · ')}.`)
    setCardEntry((current) => ({
      ...emptyCardEntry(data.cards, cardId),
      mode: 'existing',
      existingCardId: cardId,
      earningsInput: current.earningsInput,
    }))
  }

  const submitUsernameImport = async (event: FormEvent) => {
    event.preventDefault()
    const username = usernameImport.username.trim()
    if (!username) return
    if (importDisabled) {
      setUsernameImportStatus(
        'Automatic username import is closed because realapp.tools / Meowbot has shut down. Use Add card & earnings below for future entries.',
      )
      return
    }

    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    setUsernameImporting(true)
    setUsernameImportStatus('')
    setUsernameImportProgress(null)
    setUsernameImportFailedPasses([])

    try {
      const result = await importFromUsername(username, {
        signal: controller.signal,
        onProgress: setUsernameImportProgress,
      })
      const failedPlayerPasses = getFailedPlayerPasses(result)
      const noEarningsCount = failedPlayerPasses.filter((pass) => pass.reason === 'no_earnings').length
      const fetchErrorCount = failedPlayerPasses.filter((pass) => pass.reason === 'fetch_error').length
      const issueParts: string[] = []
      if (noEarningsCount > 0) {
        issueParts.push(
          `${noEarningsCount} player pass${noEarningsCount === 1 ? '' : 'es'} with no earnings (add RAX manually on Entry)`,
        )
      }
      if (fetchErrorCount > 0) {
        issueParts.push(`${fetchErrorCount} player fetch error${fetchErrorCount === 1 ? '' : 's'}`)
      }
      const issueNote = issueParts.length > 0 ? ` · ${issueParts.join(', ')}` : ''
      const skipNote =
        result.passesSkipped > 0
          ? ` · skipped ${result.passesSkipped} pass${result.passesSkipped === 1 ? '' : 'es'} by rarity`
          : ''
      setUsernameImportFailedPasses(failedPlayerPasses)
      void reportImportAdminEvents(username, result)
      if (result.errors.length > 0) {
        setCardEntry((current) => ({
          ...current,
          mode: 'existing',
          existingCardId: current.existingCardId || data.cards[0]?.id || '',
          earningsInput: 'paste',
        }))
      }
      setUsernameImportStatus(
        `Imported ${result.rowsImported} RAX row${result.rowsImported === 1 ? '' : 's'} from ${
          result.passesFetched
        } pass${result.passesFetched === 1 ? '' : 'es'} (${result.cardsCreated} new card${
          result.cardsCreated === 1 ? '' : 's'
        }, ${result.cardsUpdated} updated) · cached ${result.cachedPlayerPasses} player earning profile${
          result.cachedPlayerPasses === 1 ? '' : 's'
        } for manual Entry/Potential use${result.skipped ? ` · skipped ${result.skipped} duplicate/invalid row${result.skipped === 1 ? '' : 's'}` : ''}${skipNote}${issueNote}.`,
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

  const importFromAdminSnapshot = async () => {
    const username = usernameImport.username.trim()
    if (!username) return
    setAdminSnapshotImporting(true)
    setUsernameImportStatus('')
    setUsernameImportProgress(null)
    setUsernameImportFailedPasses([])
    try {
      const result = await importFromAdminOwnership(username)
      const skipNote =
        result.passesSkipped > 0
          ? ` · skipped ${result.passesSkipped} pass${result.passesSkipped === 1 ? '' : 'es'} below Legendary`
          : ''
      setUsernameImportStatus(
        `Imported ${result.passesFetched} Legendary+ pass${result.passesFetched === 1 ? '' : 'es'} from admin cached ownership (${result.cardsCreated} new card${result.cardsCreated === 1 ? '' : 's'}, ${result.cardsUpdated} updated)${skipNote}.`,
      )
      setCardsPage(1)
    } catch (error) {
      setUsernameImportStatus(
        error instanceof Error
          ? error.message
          : 'Could not import from admin cached ownership.',
      )
    } finally {
      setAdminSnapshotImporting(false)
    }
  }

  const cardEntrySubmitLabel =
    cardEntry.mode === 'new'
      ? cardEntry.earningsInput === 'paste' && cardEntry.rawJson.trim()
        ? 'Add card & import earnings'
        : 'Add card'
      : cardEntry.earningsInput === 'paste'
        ? 'Import earnings'
        : 'Add RAX entry'

  const saveSelectedCardProfile = () => {
    const cardId =
      cardEntry.mode === 'existing'
        ? cardEntry.existingCardId || data.cards[0]?.id || ''
        : ''
    if (!cardId) {
      setProfileStatus('Select an existing card with earnings to save.')
      return
    }
    const performanceCount = data.performances.filter((performance) => performance.cardId === cardId).length
    if (performanceCount === 0) {
      setProfileStatus('This card has no earnings rows to save yet.')
      return
    }
    saveCardProfile(cardId, cardEntry.rawJson.trim() || undefined)
    const card = data.cards.find((item) => item.id === cardId)
    setProfileStatus(
      `Saved ${card?.name ?? 'card'} (${performanceCount} row${performanceCount === 1 ? '' : 's'}) to profile.`,
    )
  }

  const handleRestoreProfile = (profileId: string) => {
    const profile = data.savedCardProfiles.find((item) => item.id === profileId)
    const restored = restoreCardProfile(profileId)
    if (!restored) {
      setProfileStatus('Could not restore profile — no earnings saved.')
      return
    }
    setProfileStatus(
      `Restored ${profile?.name ?? 'card'} with ${restored.rowsRestored} RAX row${
        restored.rowsRestored === 1 ? '' : 's'
      }.`,
    )
    setCardEntry((current) => ({
      ...current,
      mode: 'existing',
      existingCardId: restored.cardId,
      earningsInput: 'paste',
      rawJson: profile?.rawJson ?? current.rawJson,
    }))
  }

  return (
    <div className="page-stack">
      <form className="panel form-panel import-panel" onSubmit={submitUsernameImport}>
        <div className="section-heading">
          <div>
            <h2>Import from Real username</h2>
            <p>
              Enter your @username to fetch Legendary+ player and team passes while realapp.tools
              is still online. Automatic import closes after {realappToolsShutdownLabel()}; existing
              local data and backups keep working. Data via{' '}
              <a href="https://realapp.tools" target="_blank" rel="noreferrer">
                realapp.tools
              </a>{' '}
              / Meowbot — no Real API key needed.
            </p>
          </div>
          <span className="badge">{importDisabled ? 'Closed' : 'Until shutdown'}</span>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Real username</span>
            <input
              value={usernameImport.username}
              placeholder="yourname"
              disabled={usernameImporting || adminSnapshotImporting}
              onChange={(event) =>
                setUsernameImport((current) => ({ ...current, username: event.target.value }))
              }
            />
          </label>
        </div>
        <p className="import-hint">
          Imports Legendary, Mystic, and Iconic passes into your collection, and caches any player
          earnings it can fetch to speed up future manual Entry and Potential checks. Your username
          is saved in this browser after a successful import.
        </p>
        {importDisabled ? (
          <p className="import-status">
            Automatic username import is closed. If admin has cached your passes from earlier imports,
            use the admin snapshot button below. Existing imported data is still saved locally; use
            Export JSON on Dashboard for backups and Add card &amp; earnings below for new cards.
          </p>
        ) : null}
        <div className="button-row">
          <button
            className="button primary"
            type="submit"
            disabled={
              usernameImporting ||
              adminSnapshotImporting ||
              importDisabled ||
              usernameImport.username.trim().length === 0
            }
          >
            {usernameImporting ? 'Importing…' : 'Import Legendary+ passes'}
          </button>
          {importDisabled ? (
            <button
              className="button"
              type="button"
              disabled={usernameImporting || adminSnapshotImporting || usernameImport.username.trim().length === 0}
              onClick={() => void importFromAdminSnapshot()}
            >
              {adminSnapshotImporting ? 'Importing cached passes…' : 'Import from admin cached passes'}
            </button>
          ) : null}
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
        {usernameImportFailedPasses.length > 0 && !usernameImporting ? (
          <section className="import-failures">
            <p className="import-hint">
              <strong>
                {usernameImportFailedPasses.length} player pass
                {usernameImportFailedPasses.length === 1 ? '' : 'es'} could not import earnings.
              </strong>{' '}
              Use{' '}
              <a href="#add-card-earnings">Add card &amp; earnings</a> below to finish these passes
              {usernameImportFailedPasses.some((pass) => pass.reason === 'no_earnings') ? (
                <>
                  {' '}
                  (cards with <strong>no earnings</strong> were still created — select the card, paste
                  JSON, or add RAX day by day)
                </>
              ) : null}
              {usernameImportFailedPasses.some((pass) => pass.reason === 'fetch_error') ? (
                <>
                  {usernameImportFailedPasses.some((pass) => pass.reason === 'no_earnings')
                    ? '; for fetch failures you can paste from'
                    : ' — paste from'}
                </>
              ) : null}
              {usernameImportFailedPasses.some((pass) => pass.reason === 'fetch_error') ? (
                <>
                  {' '}
                  <a href="https://www.realapp.com" target="_blank" rel="noreferrer">
                    realapp.com
                  </a>{' '}
                  or restore a{' '}
                  <button className="link-button" type="button" onClick={openCardEntryForExisting}>
                    saved profile
                  </button>
                </>
              ) : (
                <> — paste from realapp.com, cached earnings, or old realapp.tools JSON if you have it</>
              )}
              .
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Player pass</th>
                    <th>Sport</th>
                    <th>Season</th>
                    <th>Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {usernameImportFailedPasses.map((pass) => (
                    <tr
                      key={`${pass.name}|${pass.sport}|${pass.season}|${pass.reason}|${pass.detail}`}
                    >
                      <td>
                        {pass.name}
                        {pass.rarityLabel ? (
                          <>
                            <br />
                            <small className="table-sub">{pass.rarityLabel}</small>
                          </>
                        ) : null}
                      </td>
                      <td>{pass.sport}</td>
                      <td>{pass.season || '—'}</td>
                      <td>
                        {pass.reason === 'no_earnings' ? 'No earnings (card added)' : 'Fetch failed'}
                        <br />
                        <small className="table-sub">{pass.detail}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
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

      <form
        className="panel form-panel"
        ref={cardEntryRef}
        id="add-card-earnings"
        onSubmit={submitCardEntry}
      >
        <div className="section-heading">
          <div>
            <h2>Add card & earnings</h2>
            <p>
              Set up the player pass and paste daily RAX in one step — or add earnings to a card
              that username import skipped.
            </p>
          </div>
          <span className="badge">{data.cards.length} cards saved</span>
        </div>

        {cachedEarningsProfiles.length > 0 ? (
          <section className="cached-profile-panel">
            <div className="section-heading">
              <div>
                <h3>Cached player earnings</h3>
                <p>
                  Player daily earnings saved from previous imports. Search here to prefill a new
                  manual card without copying JSON again.
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
                Start typing to find a cached player. These are saved base earnings from prior
                imports, not cards currently in your collection.
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
                    <span>Use cached earnings</span>
                  </button>
                ))}
              </div>
            )}
            <p className="import-hint">
              Cached profiles are not extra cards in your collection. Choosing one fills the new
              card form and earnings JSON below so you can review and save it manually.
            </p>
          </section>
        ) : null}

        <div className="entry-mode-toggle" role="group" aria-label="Card entry mode">
          <button
            className={`button${cardEntry.mode === 'new' ? ' active' : ''}`}
            type="button"
            onClick={() => setCardEntry((current) => ({ ...current, mode: 'new' }))}
          >
            New card
          </button>
          <button
            className={`button${cardEntry.mode === 'existing' ? ' active' : ''}`}
            type="button"
            disabled={data.cards.length === 0}
            onClick={() =>
              setCardEntry((current) => ({
                ...current,
                mode: 'existing',
                existingCardId: current.existingCardId || data.cards[0]?.id || '',
              }))
            }
          >
            Existing card
          </button>
        </div>

        {cardEntry.mode === 'new' ? (
          <>
            <label className="field">
              <span>Player</span>
              <input
                value={cardEntry.name}
                placeholder="Steph Curry"
                onChange={(event) =>
                  setCardEntry((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Sport</span>
                <select
                  value={cardEntry.sport}
                  onChange={(event) =>
                    setCardEntry((current) => ({
                      ...current,
                      sport: event.target.value as Sport,
                    }))
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
                  value={cardEntry.season}
                  placeholder="2023-24 Legendary"
                  onChange={(event) =>
                    setCardEntry((current) => ({ ...current, season: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Rarity</span>
                <select
                  value={cardEntry.rarityLabel}
                  onChange={(event) =>
                    setCardEntry((current) => ({ ...current, rarityLabel: event.target.value }))
                  }
                >
                  <option value="">Unknown (no OTD multiplier)</option>
                  {CARD_RARITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Pass type</span>
                <select
                  value={cardEntry.passKind}
                  onChange={(event) =>
                    setCardEntry((current) => ({
                      ...current,
                      passKind: event.target.value as 'player' | 'team',
                    }))
                  }
                >
                  <option value="player">Player</option>
                  <option value="team">Team</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>Notes</span>
              <input
                value={cardEntry.notes}
                placeholder="Optional"
                onChange={(event) =>
                  setCardEntry((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </label>
          </>
        ) : (
          <div className="card-picker">
            <label className="field">
              <span>Search cards</span>
              <input
                type="search"
                value={existingCardQuery}
                placeholder="Player name, sport, season, rarity…"
                disabled={data.cards.length === 0}
                onChange={(event) => setExistingCardQuery(event.target.value)}
              />
            </label>
            <p className="import-hint">{existingCardSearchHint}</p>
            {data.cards.length === 0 ? (
              <p className="card-picker-empty">No cards in your collection yet.</p>
            ) : filteredExistingCards.length === 0 ? (
              <p className="card-picker-empty">No cards match that search.</p>
            ) : (
              <div className="card-picker-list" role="listbox" aria-label="Existing cards">
                {filteredExistingCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    role="option"
                    aria-selected={selectedExistingCardId === card.id}
                    className={`card-picker-item${selectedExistingCardId === card.id ? ' selected' : ''}`}
                    onClick={() =>
                      setCardEntry((current) => ({ ...current, existingCardId: card.id }))
                    }
                  >
                    <strong>{card.name || 'Unnamed pass'}</strong>
                    <small>
                      {card.sport} · {card.season || 'No season'}
                      {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="form-subsection">
          <div className="section-heading">
            <div>
              <h3>Daily RAX earnings</h3>
              <p className="subsection-note">
                Paste JSON from realapp.com, load cached player earnings, or enter a single day
                manually.
              </p>
            </div>
          </div>

          <section className="panel import-hint">
            <p>
              <strong>Manual earnings after import shutdown</strong> — use realapp.com on a{' '}
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
                In Network, filter for the request whose URL
                includes <code>playerBoxScoreId</code> (for example{' '}
                <code>
                  userpassearnings/nba/season/2023/entity/player/…?playerBoxScoreId=…
                </code>
                ).
              </li>
              <li>
                Copy the full <strong>Response</strong> JSON — an <code>earnings</code> array with{' '}
                <code>day</code> and <code>earnings</code> fields.
              </li>
              <li>Paste below and save. OTD rarity is applied from the card when set.</li>
            </ol>
          </section>

          <div className="entry-mode-toggle" role="group" aria-label="Earnings input mode">
            <button
              className={`button${cardEntry.earningsInput === 'paste' ? ' active' : ''}`}
              type="button"
              onClick={() => setCardEntry((current) => ({ ...current, earningsInput: 'paste' }))}
            >
              Paste JSON
            </button>
            <button
              className={`button${cardEntry.earningsInput === 'single' ? ' active' : ''}`}
              type="button"
              onClick={() => setCardEntry((current) => ({ ...current, earningsInput: 'single' }))}
            >
              Single day
            </button>
          </div>

          {cardEntry.earningsInput === 'paste' ? (
            <label className="field">
              <span>Earnings JSON</span>
              <textarea
                className="bulk-import-textarea"
                value={cardEntry.rawJson}
                placeholder='{"earnings":[{"day":"2024-01-21","earnings":42,"playerBoxScoreIds":[776499385]}]}'
                onChange={(event) =>
                  setCardEntry((current) => ({ ...current, rawJson: event.target.value }))
                }
              />
            </label>
          ) : (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>Claim day</span>
                  <input
                    type="date"
                    value={cardEntry.claimDay}
                    onChange={(event) =>
                      setCardEntry((current) => ({ ...current, claimDay: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>RAX earned</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={cardEntry.raxEarned}
                    placeholder="29"
                    onChange={(event) =>
                      setCardEntry((current) => ({ ...current, raxEarned: event.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>Note</span>
                <input
                  value={cardEntry.singleNote}
                  placeholder="Optional performance note"
                  onChange={(event) =>
                    setCardEntry((current) => ({ ...current, singleNote: event.target.value }))
                  }
                />
              </label>
            </>
          )}
        </div>

        <div className="button-row">
          <button className="button primary" type="submit">
            {cardEntrySubmitLabel}
          </button>
          {cardEntryStatus ? <p className="import-status">{cardEntryStatus}</p> : null}
        </div>
      </form>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Saved earnings profiles</h2>
            <p>
              Cards you add manually are saved here automatically. After re-import wipes pasted
              earnings, click <strong>Restore</strong> to add them back onto the matching pass.
            </p>
          </div>
          <span>{data.savedCardProfiles.length} saved</span>
        </div>
        {data.savedCardProfiles.length === 0 ? (
          <p className="empty">
            No saved profiles yet. Import or paste earnings above — each save updates the profile
            for that player.
          </p>
        ) : (
          <div className="list">
            {data.savedCardProfiles.map((profile) => (
              <div className="list-row" key={profile.id}>
                <span>
                  <strong>{profile.name}</strong>
                  <small>
                    {profile.sport} · {profile.season || 'No season'}
                    {profile.rarityLabel ? ` · ${profile.rarityLabel}` : ''} · {profile.rows.length}{' '}
                    row{profile.rows.length === 1 ? '' : 's'}
                    {profile.externalKey ? ' · linked to username import' : ''}
                  </small>
                </span>
                <span className="button-row compact-actions">
                  <button className="button primary" type="button" onClick={() => handleRestoreProfile(profile.id)}>
                    Restore
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setCardEntry((current) => ({
                        ...current,
                        mode: 'existing',
                        existingCardId:
                          data.cards.find(
                            (card) =>
                              (profile.externalKey && card.externalKey === profile.externalKey) ||
                              (card.name === profile.name &&
                                card.sport === profile.sport &&
                                card.season === profile.season),
                          )?.id ??
                          current.existingCardId,
                        earningsInput: 'paste',
                        rawJson: profile.rawJson,
                      }))
                      setProfileStatus(`Loaded JSON for ${profile.name}.`)
                      cardEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                  >
                    Load JSON
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    onClick={() => {
                      deleteCardProfile(profile.id)
                      setProfileStatus(`Removed saved profile for ${profile.name}.`)
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="button-row">
          <button className="button" type="button" onClick={saveSelectedCardProfile}>
            Save selected card to profile
          </button>
          {profileStatus ? <p className="import-status">{profileStatus}</p> : null}
        </div>
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
                    Import while available above or use Add card & earnings below.
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
                    Import while available or add earnings in Add card & earnings above.
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
