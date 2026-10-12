import { useEffect, useRef, useState } from 'react'
import {
  MARKETPLACE_RARITIES,
  marketplaceListingUrl,
  type MarketplaceAlertNotification,
  type MarketplaceAlertPlayer,
  type MarketplaceAlertRule,
  type MarketplaceRarity,
} from '../../lib/marketplaceAlerts'
import type { MarketplaceScanLogEntry, MarketplaceScanStatus } from '../../lib/marketplaceAlertStore'
import { ThemedSelect } from '../components/ThemedSelect'
import { useAccountAuth } from '../context/AccountAuthContext'
import { useRaxData } from '../context/RaxDataContext'
import {
  ignoreMarketplaceAlertListing,
  loadMarketplaceAlerts,
  MarketplaceScanRequestError,
  saveMarketplaceAlerts,
  scanMarketplaceAlertsNow,
} from '../lib/marketplaceAlertsApi'
import { realOwnedMarketplacePlayers } from '../lib/marketplaceOwnedPlayers'
import { getCachedMarketplacePlayers, saveCachedMarketplacePlayers } from '../lib/marketplacePlayerCache'
import { marketplacePageScanKey, startMarketplacePageScanner } from '../lib/marketplacePageScanner'
import {
  applyMarketplacePlayerSelection,
  filterMarketplacePlayers,
  initialMarketplacePlayerSelection,
} from '../lib/marketplacePlayerSelection'
import { fetchRealUserPasses } from '../lib/realPassImport'
import { SPORTS } from '../types/rax'

type Draft = Omit<MarketplaceAlertRule, 'id' | 'createdAt' | 'updatedAt' | 'enabled' | 'players' | 'pricePerRatingMax'> & {
  players: MarketplaceAlertPlayer[]
  pricePerRatingMax: number | null
}

const currentSeason = new Date().getUTCFullYear()
const PLAYER_PAGE_SIZE = 12
const PLAYER_PICKER_PAGE_SIZE = 16
const initialDraft: Draft = {
  name: '',
  sport: 'nfl',
  season: currentSeason,
  entityScope: 'ownedPlayers',
  entityId: null,
  entityName: '',
  players: [],
  ratingMin: null,
  ratingMax: null,
  rarities: [],
  listingMode: 'all',
  prestigeMode: 'all',
  itemType: 'bulk',
  priceMin: null,
  priceMax: null,
  pricePerRatingMax: null,
  atTargetPrice: true,
  noBids: false,
  maxSerial: null,
}

const sportOptions = SPORTS.filter((sport) => sport !== 'Other').map((sport) => ({
  value: sport.toLowerCase(),
  label: sport,
}))

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `market-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function ruleSummary(rule: MarketplaceAlertRule): string {
  const playerCount = rule.players?.length ?? 0
  const parts = [
    playerCount > 0 ? `${playerCount} owned player${playerCount === 1 ? '' : 's'}` : 'Owned players',
    'bulk rating',
    rule.rarities.length > 0 ? rule.rarities.join(', ') : 'all rarities',
  ]
  if (rule.pricePerRatingMax != null) parts.push(`≤ ${rule.pricePerRatingMax.toLocaleString()} RAX/rating`)
  const customPlayers = rule.players?.filter((player) =>
    player.pricePerRatingMax !== undefined || Array.isArray(player.rarities),
  ).length ?? 0
  if (customPlayers > 0) parts.push(`${customPlayers} custom`)
  if (rule.noBids) parts.push('no bids')
  return parts.join(' · ')
}

function formatAge(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function scanStatusSummary(scanStatus: MarketplaceScanStatus | null): string {
  if (!scanStatus) return 'The hosted five-minute monitor has not run yet.'
  if (scanStatus.error) return `Last scan failed ${formatAge(scanStatus.finishedAt)}: ${scanStatus.error}`
  const delivery = scanStatus.deliveryChannel
    ? ` · ${scanStatus.delivered} sent by ${scanStatus.deliveryChannel}`
    : ''
  return `Last scan ${formatAge(scanStatus.finishedAt)} · ${scanStatus.checkedListings} listings · ${scanStatus.newMatches} new${delivery}`
}

function formatScanTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  })
}

export default function MarketplaceAlertsPage() {
  const { data } = useRaxData()
  const { username: accountUsername } = useAccountAuth()
  const scanInFlightRef = useRef(false)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [rules, setRules] = useState<MarketplaceAlertRule[]>([])
  const [notifications, setNotifications] = useState<MarketplaceAlertNotification[]>([])
  const [scanStatus, setScanStatus] = useState<MarketplaceScanStatus | null>(null)
  const [scanLog, setScanLog] = useState<MarketplaceScanLogEntry[]>([])
  const [status, setStatus] = useState('Loading alerts…')
  const [busy, setBusy] = useState(false)
  const [playersBusy, setPlayersBusy] = useState(false)
  const [ignoringListingId, setIgnoringListingId] = useState<string | null>(null)
  const [availablePlayers, setAvailablePlayers] = useState<MarketplaceAlertPlayer[]>([])
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false)
  const [pickerSelectedIds, setPickerSelectedIds] = useState<number[]>([])
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerPage, setPickerPage] = useState(1)
  const [playerPage, setPlayerPage] = useState(1)
  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [playersLoadedAt, setPlayersLoadedAt] = useState<string | null>(null)
  const activeScanKey = marketplacePageScanKey(rules)
  const [realUsername, setRealUsername] = useState(
    () => (data.settings.savedUsername || accountUsername || '').replace(/^@/, '').trim(),
  )

  useEffect(() => {
    const fallback = (data.settings.savedUsername || accountUsername || '').replace(/^@/, '').trim()
    if (fallback) setRealUsername((current) => current || fallback)
  }, [accountUsername, data.settings.savedUsername])

  useEffect(() => {
    const cached = getCachedMarketplacePlayers(realUsername, draft.sport, draft.season)
    if (!cached) {
      setAvailablePlayers([])
      setPlayersLoadedAt(null)
      return
    }
    setAvailablePlayers(cached.players)
    setDraft((current) => current.players.length > 0
      ? current
      : { ...current, players: cached.players })
    setPlayersLoadedAt(cached.loadedAt)
    setPlayerPage(1)
    setEditingPlayerId(null)
  }, [realUsername, draft.sport, draft.season])

  useEffect(() => {
    if (!playerPickerOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlayerPickerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [playerPickerOpen])

  useEffect(() => {
    let active = true
    void loadMarketplaceAlerts()
      .then((payload) => {
        if (!active) return
        setRules(payload.rules)
        setNotifications(payload.notifications)
        setScanStatus(payload.scanStatus)
        setScanLog(payload.scanLog)
        setStatus(payload.rules.length ? 'Monitoring rules loaded.' : 'Create your first alert rule.')
      })
      .catch((error) => active && setStatus(error instanceof Error ? error.message : 'Could not load alerts.'))
    return () => { active = false }
  }, [])

  const persist = async (next: MarketplaceAlertRule[], message: string) => {
    setRules(next)
    try {
      const saved = await saveMarketplaceAlerts(next)
      setRules(saved)
      setStatus(message)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save alert rules.')
    }
  }

  const loadOwnedPlayers = async () => {
    const username = realUsername.replace(/^@/, '').trim()
    if (!username) {
      setStatus('Enter the Real @username whose owned players you want to monitor.')
      return
    }
    setPlayersBusy(true)
    try {
      const result = await fetchRealUserPasses(username)
      const players = realOwnedMarketplacePlayers(result, draft.sport, draft.season)
      const loadedAt = new Date().toISOString()
      const cached = saveCachedMarketplacePlayers(username, draft.sport, draft.season, players, loadedAt)
      setAvailablePlayers(players)
      setPickerSelectedIds(initialMarketplacePlayerSelection(players, draft.players))
      setPickerQuery('')
      setPickerPage(1)
      setPlayerPickerOpen(players.length > 0)
      setPlayersLoadedAt(loadedAt)
      setStatus(players.length > 0
        ? `Loaded ${players.length} owned ${draft.sport.toUpperCase()} player${players.length === 1 ? '' : 's'} from @${username}${cached ? ' and saved them on this device' : ''}. Choose the players to monitor.`
        : `No owned ${draft.sport.toUpperCase()} players were found for @${username} in ${draft.season}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load owned players.')
    } finally {
      setPlayersBusy(false)
    }
  }

  const saveRule = async () => {
    if (draft.players.length === 0) {
      setStatus('Load your owned players and keep at least one player before saving.')
      return
    }
    const now = new Date().toISOString()
    const existingRule = editingRuleId
      ? rules.find((rule) => rule.id === editingRuleId)
      : undefined
    const rule: MarketplaceAlertRule = {
      ...draft,
      entityName: `${draft.players.length} owned players`,
      id: existingRule?.id ?? createId(),
      name: draft.name.trim() || `${draft.sport.toUpperCase()} owned players`,
      enabled: existingRule?.enabled ?? true,
      createdAt: existingRule?.createdAt ?? now,
      updatedAt: now,
    }
    const nextRules = existingRule
      ? rules.map((entry) => entry.id === existingRule.id ? rule : entry)
      : [rule, ...rules]
    await persist(nextRules, existingRule
      ? `Alert “${rule.name}” updated.`
      : `Alert “${rule.name}” is active.`)
    setDraft({ ...initialDraft, sport: draft.sport, season: draft.season })
    setEditingRuleId(null)
    setPlayersLoadedAt(null)
    setPlayerPage(1)
    setEditingPlayerId(null)
  }

  const editRule = (rule: MarketplaceAlertRule) => {
    setAvailablePlayers(rule.players ?? [])
    setDraft({
      name: rule.name,
      sport: rule.sport,
      season: rule.season,
      entityScope: 'ownedPlayers',
      entityId: null,
      entityName: rule.entityName,
      players: rule.players ?? [],
      ratingMin: rule.ratingMin,
      ratingMax: rule.ratingMax,
      rarities: rule.rarities,
      listingMode: 'all',
      prestigeMode: 'all',
      itemType: 'bulk',
      priceMin: rule.priceMin,
      priceMax: null,
      pricePerRatingMax: rule.pricePerRatingMax ?? null,
      atTargetPrice: true,
      noBids: rule.noBids,
      maxSerial: null,
    })
    setEditingRuleId(rule.id)
    setPlayersLoadedAt(null)
    setPlayerPage(1)
    setEditingPlayerId(null)
    setStatus(`Editing “${rule.name}”.`)
  }

  const cancelRuleEdit = () => {
    setDraft({ ...initialDraft, sport: draft.sport, season: draft.season })
    setEditingRuleId(null)
    setPlayersLoadedAt(null)
    setPlayerPage(1)
    setEditingPlayerId(null)
    setStatus('Edit cancelled.')
  }

  const scan = async (source: 'manual' | 'page' = 'manual') => {
    if (scanInFlightRef.current || rules.every((rule) => !rule.enabled)) return
    scanInFlightRef.current = true
    setBusy(true)
    setStatus('Checking the newest marketplace listings…')
    try {
      const result = await scanMarketplaceAlertsNow(rules, source)
      setNotifications(result.notifications)
      setScanStatus(result.scanStatus)
      const logEntry: MarketplaceScanLogEntry = {
        ...result.scanStatus,
        id: `${result.scanStatus.startedAt}:${source}`,
        source,
      }
      setScanLog((current) => [
        logEntry,
        ...current.filter((entry) => entry.id !== logEntry.id),
      ].slice(0, 40))
      setStatus(`Checked ${result.checkedListings} listings across ${result.requests} feed${result.requests === 1 ? '' : 's'} · ${result.newNotifications.length} new match${result.newNotifications.length === 1 ? '' : 'es'}.${result.scanStatus.warning ? ` ${result.scanStatus.warning}` : ''}`)
      if ('Notification' in window && Notification.permission === 'granted') {
        for (const item of result.newNotifications.slice(0, 3)) {
          new Notification(`${item.playerName} · ${item.price.toLocaleString()} RAX`, {
            body: `${item.ruleName} · ${item.numBids} bid${item.numBids === 1 ? '' : 's'}`,
          })
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Marketplace scan failed.')
      if (error instanceof MarketplaceScanRequestError && error.scanStatus) {
        const logEntry: MarketplaceScanLogEntry = {
          ...error.scanStatus,
          id: `${error.scanStatus.startedAt}:${source}`,
          source,
        }
        setScanStatus(error.scanStatus)
        setScanLog((current) => [
          logEntry,
          ...current.filter((entry) => entry.id !== logEntry.id),
        ].slice(0, 40))
      }
    } finally {
      scanInFlightRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (import.meta.env.DEV) return
    const timer = window.setInterval(() => {
      void loadMarketplaceAlerts().then((payload) => {
        setNotifications(payload.notifications)
        setScanStatus(payload.scanStatus)
        setScanLog(payload.scanLog)
      }).catch(() => undefined)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV || !activeScanKey) return
    return startMarketplacePageScanner(() => void scan('page'))
  }, [activeScanKey])

  const enableBrowserNotifications = async () => {
    if (!('Notification' in window)) {
      setStatus('This browser does not support desktop notifications.')
      return
    }
    const permission = await Notification.requestPermission()
    setStatus(permission === 'granted' ? 'Browser notifications enabled.' : 'Browser notifications were not enabled.')
  }

  const ignoreListing = async (item: MarketplaceAlertNotification) => {
    if (ignoringListingId) return
    setIgnoringListingId(item.listingId)
    try {
      const remaining = await ignoreMarketplaceAlertListing(item.listingId)
      setNotifications(remaining)
      setStatus(`${item.playerName} listing ignored. It will not trigger another alert.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not ignore this listing.')
    } finally {
      setIgnoringListingId(null)
    }
  }

  const advancedFilterCount = [
    draft.name.trim() || null,
    draft.priceMin,
    draft.ratingMin,
    draft.ratingMax,
  ].filter((value) => value !== null).length
  const activeRuleCount = rules.filter((rule) => rule.enabled).length
  const playerPageCount = Math.max(1, Math.ceil(draft.players.length / PLAYER_PAGE_SIZE))
  const resolvedPlayerPage = Math.min(playerPage, playerPageCount)
  const paginatedPlayers = draft.players.slice(
    (resolvedPlayerPage - 1) * PLAYER_PAGE_SIZE,
    resolvedPlayerPage * PLAYER_PAGE_SIZE,
  )
  const editingPlayer = draft.players.find((player) => player.entityId === editingPlayerId)
  const filteredPickerPlayers = filterMarketplacePlayers(availablePlayers, pickerQuery)
  const pickerPageCount = Math.max(1, Math.ceil(filteredPickerPlayers.length / PLAYER_PICKER_PAGE_SIZE))
  const resolvedPickerPage = Math.min(pickerPage, pickerPageCount)
  const paginatedPickerPlayers = filteredPickerPlayers.slice(
    (resolvedPickerPage - 1) * PLAYER_PICKER_PAGE_SIZE,
    resolvedPickerPage * PLAYER_PICKER_PAGE_SIZE,
  )

  const openPlayerPicker = () => {
    setPickerSelectedIds(initialMarketplacePlayerSelection(availablePlayers, draft.players))
    setPickerQuery('')
    setPickerPage(1)
    setPlayerPickerOpen(true)
  }

  const savePlayerSelection = () => {
    const players = applyMarketplacePlayerSelection(availablePlayers, draft.players, pickerSelectedIds)
    setDraft((current) => ({ ...current, players }))
    setPlayerPickerOpen(false)
    setPlayerPage(1)
    setEditingPlayerId(null)
    setStatus(`Saved ${players.length} player${players.length === 1 ? '' : 's'} to this alert.`)
  }

  const updatePlayer = (
    entityId: number,
    update: (player: MarketplaceAlertPlayer) => MarketplaceAlertPlayer,
  ) => {
    setDraft((current) => ({
      ...current,
      players: current.players.map((player) => player.entityId === entityId ? update(player) : player),
    }))
  }

  return (
    <div className="page-stack marketplace-alerts-page">
      <section className="marketplace-hero">
        <div>
          <p className="eyebrow">Marketplace</p>
          <h1>Alerts</h1>
          <p>Watch bulk-rating listings for players you already own.</p>
        </div>
        <div className="marketplace-hero-actions">
          <button className="button secondary" type="button" disabled={busy || rules.length === 0} onClick={() => void scan()}>
            {busy ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </section>

      <section className="marketplace-health" role="status">
        <span className="marketplace-health-dot" aria-hidden="true" />
        <div><strong>{status}</strong><span>{scanStatusSummary(scanStatus)}</span></div>
        <button className="marketplace-health-action" type="button" onClick={() => void enableBrowserNotifications()}>
          Enable desktop notifications
        </button>
      </section>

      <dl className="marketplace-overview" aria-label="Marketplace alert overview">
        <div><dt>Active alerts</dt><dd>{activeRuleCount}</dd></div>
        <div><dt>Matches</dt><dd>{notifications.length}</dd></div>
        <div><dt>Automatic checks</dt><dd>Every 5 min</dd></div>
      </dl>

      <section className="marketplace-layout">
        <div className="panel marketplace-rule-builder">
          <div className="section-heading">
            <span className="marketplace-section-number">01</span>
            <div><h2>New alert</h2><p>Load your owned players, remove any you do not want, then set the price.</p></div>
            <span className="marketplace-fixed-mode">Bulk rating</span>
          </div>

          <div className="marketplace-form-grid marketplace-essentials">
            <ThemedSelect label="Sport" value={draft.sport} options={sportOptions} onChange={(sport) => { setDraft({ ...draft, sport, players: [] }); setAvailablePlayers([]); setPlayerPickerOpen(false); setPlayersLoadedAt(null); setPlayerPage(1); setEditingPlayerId(null) }} />
            <label className="field"><span>Season</span><input type="number" min="2000" max="2200" value={draft.season} onChange={(event) => { setDraft({ ...draft, season: Number(event.target.value) || currentSeason, players: [] }); setAvailablePlayers([]); setPlayerPickerOpen(false); setPlayersLoadedAt(null); setPlayerPage(1); setEditingPlayerId(null) }} /></label>

            <section className="marketplace-owned-picker marketplace-span-2">
              <div className="marketplace-owned-picker-heading">
                <div><h3>Owned players</h3><p>Loaded live from a Real username for this sport and season.</p></div>
              </div>
              <div className="marketplace-real-user-loader">
                <label className="field"><span>Real @username</span><div className="marketplace-username-input"><span>@</span><input value={realUsername} placeholder="username" onChange={(event) => { setRealUsername(event.target.value.replace(/^@/, '')); setDraft({ ...draft, players: [] }); setAvailablePlayers([]); setPlayerPickerOpen(false); setPlayersLoadedAt(null); setPlayerPage(1); setEditingPlayerId(null) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void loadOwnedPlayers() } }} /></div></label>
                <button className="button secondary" type="button" disabled={playersBusy} onClick={() => void loadOwnedPlayers()}>{playersBusy ? 'Loading from Real…' : draft.players.length > 0 ? 'Reload from Real' : 'Load from Real'}</button>
              </div>
              {draft.players.length > 0 ? (
                <div className="marketplace-owned-selection">
                  <div className="marketplace-player-list-heading">
                    <div><strong>{draft.players.length} selected</strong><span>Page {resolvedPlayerPage} of {playerPageCount}{playersLoadedAt ? ` · saved ${formatAge(playersLoadedAt)}` : ''}</span></div>
                    {availablePlayers.length > 0 ? <button className="button secondary" type="button" onClick={openPlayerPicker}>Edit players</button> : null}
                  </div>
                  <div className="marketplace-player-chips">
                    {paginatedPlayers.map((player) => (
                      <span key={player.entityId} className="marketplace-player-chip">
                        <span>{player.name}</span>
                        {player.rarityLabel ? <b>{player.rarityLabel}</b> : null}
                        {(player.pricePerRatingMax !== undefined || Array.isArray(player.rarities)) ? <i title="Custom filters">Custom</i> : null}
                        <button className="edit" type="button" aria-label={`Edit filters for ${player.name}`} onClick={() => setEditingPlayerId(editingPlayerId === player.entityId ? null : player.entityId)}>✎</button>
                        <button type="button" aria-label={`Remove ${player.name}`} onClick={() => { setDraft({ ...draft, players: draft.players.filter((entry) => entry.entityId !== player.entityId) }); if (editingPlayerId === player.entityId) setEditingPlayerId(null) }}>×</button>
                      </span>
                    ))}
                  </div>
                  {playerPageCount > 1 ? <div className="marketplace-player-pagination"><button type="button" disabled={resolvedPlayerPage === 1} onClick={() => setPlayerPage(Math.max(1, resolvedPlayerPage - 1))}>Previous</button><button type="button" disabled={resolvedPlayerPage === playerPageCount} onClick={() => setPlayerPage(Math.min(playerPageCount, resolvedPlayerPage + 1))}>Next</button></div> : null}
                  {editingPlayer ? (
                    <div className="marketplace-player-editor">
                      <div className="marketplace-player-editor-heading"><div><span>Player filters</span><strong>{editingPlayer.name}</strong></div><button type="button" onClick={() => updatePlayer(editingPlayer.entityId, (player) => ({ entityId: player.entityId, name: player.name, ...(player.rarityLabel ? { rarityLabel: player.rarityLabel } : {}) }))}>Use alert defaults</button></div>
                      <label className="field"><span>Maximum RAX per rating <small>Overrides the alert default</small></span><div className="marketplace-price-input"><input type="number" min="0" step="0.01" placeholder={draft.pricePerRatingMax == null ? 'No default' : String(draft.pricePerRatingMax)} value={editingPlayer.pricePerRatingMax ?? ''} onChange={(event) => { const value = numberOrNull(event.target.value); updatePlayer(editingPlayer.entityId, (player) => ({ ...player, pricePerRatingMax: value ?? undefined })) }} /><span>RAX</span></div></label>
                      <fieldset className="marketplace-filter-group marketplace-rarity-picker"><legend>Player rarity <small>{Array.isArray(editingPlayer.rarities) ? 'Custom selection; empty means all.' : 'Using alert defaults.'}</small></legend><div className="marketplace-chip-grid">{MARKETPLACE_RARITIES.map((rarity) => { const selected = (editingPlayer.rarities ?? draft.rarities).includes(rarity); return <label key={rarity} className={`marketplace-filter-chip${selected ? ' selected' : ''}`}><input type="checkbox" checked={selected} onChange={() => { const current = editingPlayer.rarities ?? draft.rarities; const next = current.includes(rarity) ? current.filter((entry) => entry !== rarity) : [...current, rarity] as MarketplaceRarity[]; updatePlayer(editingPlayer.entityId, (player) => ({ ...player, rarities: next })) }} /><span>{rarity}</span></label> })}</div></fieldset>
                    </div>
                  ) : null}
                </div>
              ) : availablePlayers.length > 0 ? (
                <div className="marketplace-owned-empty marketplace-owned-empty-action"><span>No players selected.</span><button className="button secondary" type="button" onClick={openPlayerPicker}>Choose players</button></div>
              ) : <p className="marketplace-owned-empty">No players loaded yet.</p>}
            </section>

            <label className="field marketplace-price-field"><span>Default maximum RAX per rating</span><div className="marketplace-price-input"><input type="number" min="0" step="0.01" placeholder="Any ratio" value={draft.pricePerRatingMax ?? ''} onChange={(event) => setDraft({ ...draft, pricePerRatingMax: numberOrNull(event.target.value), priceMax: null })} /><span>RAX</span></div><small className="marketplace-field-help">Listing price ÷ bulk rating</small></label>
            <label className="marketplace-simple-check marketplace-no-bids"><input type="checkbox" checked={draft.noBids} onChange={(event) => setDraft({ ...draft, noBids: event.target.checked })} /><span>Only listings with no bids</span></label>

            <fieldset className="marketplace-filter-group marketplace-rarity-picker marketplace-span-2">
              <legend>Default bulk rarity <small>Leave all unselected to watch every rarity.</small></legend>
              <div className="marketplace-chip-grid">{MARKETPLACE_RARITIES.map((rarity) => <label key={rarity} className={`marketplace-filter-chip${draft.rarities.includes(rarity) ? ' selected' : ''}`}><input type="checkbox" checked={draft.rarities.includes(rarity)} onChange={() => setDraft({ ...draft, rarities: draft.rarities.includes(rarity) ? draft.rarities.filter((entry) => entry !== rarity) : [...draft.rarities, rarity] as MarketplaceRarity[] })} /><span>{rarity}</span></label>)}</div>
            </fieldset>
          </div>

          <details className="marketplace-advanced">
            <summary><span>More options</span><small>{advancedFilterCount ? `${advancedFilterCount} changed` : 'Optional'}</small></summary>
            <div className="marketplace-form-grid marketplace-advanced-grid">
              <label className="field marketplace-span-2"><span>Alert name</span><input value={draft.name} placeholder="Optional custom name" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label className="field"><span>Minimum bulk rating</span><input type="number" min="0" step="0.1" placeholder="Any" value={draft.ratingMin ?? ''} onChange={(event) => setDraft({ ...draft, ratingMin: numberOrNull(event.target.value) })} /></label>
              <label className="field"><span>Maximum bulk rating</span><input type="number" min="0" step="0.1" placeholder="Any" value={draft.ratingMax ?? ''} onChange={(event) => setDraft({ ...draft, ratingMax: numberOrNull(event.target.value) })} /></label>
              <label className="field"><span>Minimum price</span><input type="number" min="0" placeholder="Any" value={draft.priceMin ?? ''} onChange={(event) => setDraft({ ...draft, priceMin: numberOrNull(event.target.value) })} /></label>
            </div>
          </details>

          <div className="marketplace-create-bar">{editingRuleId ? <button className="button secondary" type="button" onClick={cancelRuleEdit}>Cancel</button> : null}<button className="button primary" type="button" onClick={() => void saveRule()}>{editingRuleId ? 'Update alert' : 'Save alert'}</button></div>
        </div>

        <aside className="marketplace-side-stack">
          <section className="panel marketplace-rules-panel">
            <div className="section-heading"><span className="marketplace-section-number">02</span><div><h2>Saved alerts</h2><p>Checked every five minutes</p></div><span className="marketplace-count">{rules.length}</span></div>
            {rules.length === 0 ? <div className="marketplace-empty"><strong>No alerts yet</strong><span>Saved alerts will appear here.</span></div> : <div className="marketplace-rule-list">{rules.map((rule) => <article key={rule.id} className={`marketplace-rule-card${rule.enabled ? '' : ' disabled'}`}><div><span className="marketplace-rule-sport">{rule.enabled ? 'ACTIVE' : 'PAUSED'} · {rule.sport.toUpperCase()} {rule.season}</span><h3>{rule.name}</h3><p>{ruleSummary(rule)}</p></div><details className="marketplace-rule-menu"><summary aria-label={`Options for ${rule.name}`}>•••</summary><div><button type="button" onClick={() => editRule(rule)}>Edit alert</button><button type="button" onClick={() => void persist(rules.map((entry) => entry.id === rule.id ? { ...entry, enabled: !entry.enabled, updatedAt: new Date().toISOString() } : entry), `${rule.name} ${rule.enabled ? 'paused' : 'enabled'}.`)}>{rule.enabled ? 'Pause alert' : 'Enable alert'}</button><button type="button" className="danger" onClick={() => void persist(rules.filter((entry) => entry.id !== rule.id), `${rule.name} removed.`)}>Remove</button></div></details></article>)}</div>}
          </section>
          <section className="panel marketplace-scan-log-panel">
            <div className="marketplace-scan-log-heading"><div><h2>Scan log</h2><p>Page-open fallback checks the Real marketplace every five minutes.</p></div><span className={busy ? 'scanning' : ''}>{busy ? 'Scanning' : 'Page open · 5 min'}</span></div>
            {busy ? <div className="marketplace-scan-live"><i aria-hidden="true" /><span>Requesting the latest bulk-rating feeds…</span></div> : null}
            {scanLog.length === 0 ? (
              <div className="marketplace-empty"><strong>No scans recorded yet</strong><span>The first page check starts as soon as your active alerts load.</span></div>
            ) : (
              <ol className="marketplace-scan-log">
                {scanLog.slice(0, 8).map((entry) => (
                  <li key={entry.id} className={entry.error ? 'failed' : ''}>
                    <span className="marketplace-scan-log-dot" aria-hidden="true" />
                    <div><strong>{entry.error ? 'Scan failed' : `${entry.checkedListings} listings checked`}</strong><span>{entry.error || `${entry.requests} feed${entry.requests === 1 ? '' : 's'} · ${entry.newMatches} new match${entry.newMatches === 1 ? '' : 'es'}${entry.delivered ? ` · ${entry.delivered} sent` : ''}${entry.warning ? ` · ${entry.warning}` : ''}`}</span></div>
                    <time dateTime={entry.finishedAt}><b>{entry.source === 'automatic' ? 'Auto' : entry.source === 'page' ? 'Page' : 'Manual'}</b>{formatScanTime(entry.finishedAt)}</time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </section>

      <section className="panel marketplace-feed-panel">
        <div className="section-heading"><span className="marketplace-section-number">03</span><div><h2>Matches</h2><p>New bulk-rating listings that met one of your alerts.</p></div></div>
        {notifications.length === 0 ? <div className="marketplace-empty"><strong>No matches yet</strong><span>We’ll add listings here when they meet an active alert.</span></div> : (
          <div className="marketplace-notification-grid">
            {notifications.map((item) => {
              const auctionUrl = marketplaceListingUrl(item.listingId)
              return (
                <article key={item.id} className="marketplace-notification">
                  <div className="marketplace-notification-copy">
                    <span>{item.ruleName}</span>
                    <h3>{item.playerName}</h3>
                    <p>Bulk rating auction · {item.sport.toUpperCase()} {item.season} · {item.rarity || 'Any rarity'} · {item.rating != null ? `${item.rating} bulk rating · ` : ''}{item.pricePerRating != null ? `${item.pricePerRating.toLocaleString(undefined, { maximumFractionDigits: 2 })} RAX/rating · ` : ''}{item.numBids} bid{item.numBids === 1 ? '' : 's'}</p>
                  </div>
                  <div className="marketplace-notification-price">
                    <strong>{item.price.toLocaleString()}</strong>
                    <span>RAX</span>
                    <small>{formatAge(item.foundAt)}</small>
                    {auctionUrl ? (
                      <a
                        className="marketplace-auction-link"
                        href={auctionUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${item.playerName} auction on Real`}
                      >
                        View auction <span aria-hidden="true">↗</span>
                      </a>
                    ) : <span className="marketplace-auction-link unavailable">Demo listing</span>}
                    <button className="marketplace-ignore-listing" type="button" disabled={ignoringListingId !== null} onClick={() => void ignoreListing(item)}>{ignoringListingId === item.listingId ? 'Ignoring…' : 'Ignore listing'}</button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {playerPickerOpen ? (
        <div className="app-modal-backdrop marketplace-player-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlayerPickerOpen(false) }}>
          <section className="marketplace-player-picker-modal" role="dialog" aria-modal="true" aria-labelledby="marketplace-player-picker-title">
            <header className="marketplace-player-picker-header">
              <div><span>Owned players</span><h2 id="marketplace-player-picker-title">Choose who to monitor</h2><p>Uncheck players you do not want in this alert. Your changes apply when you save.</p></div>
              <button type="button" aria-label="Close player picker" onClick={() => setPlayerPickerOpen(false)}>×</button>
            </header>
            <div className="marketplace-player-picker-tools">
              <label><span className="sr-only">Search players</span><input type="search" value={pickerQuery} placeholder="Search players or rarity" autoFocus onChange={(event) => { setPickerQuery(event.target.value); setPickerPage(1) }} /></label>
              <strong>{pickerSelectedIds.length} of {availablePlayers.length} selected</strong>
              <div><button type="button" onClick={() => setPickerSelectedIds(availablePlayers.map((player) => player.entityId))}>Select all</button><button type="button" onClick={() => setPickerSelectedIds([])}>Clear</button></div>
            </div>
            <div className="marketplace-player-picker-list">
              {paginatedPickerPlayers.length > 0 ? paginatedPickerPlayers.map((player) => {
                const selected = pickerSelectedIds.includes(player.entityId)
                return (
                  <label key={player.entityId} className={selected ? 'selected' : ''}>
                    <input type="checkbox" checked={selected} onChange={() => setPickerSelectedIds((current) => current.includes(player.entityId) ? current.filter((entityId) => entityId !== player.entityId) : [...current, player.entityId])} />
                    <span><strong>{player.name}</strong>{player.rarityLabel ? <small>{player.rarityLabel}</small> : null}</span>
                    <i aria-hidden="true">✓</i>
                  </label>
                )
              }) : <div className="marketplace-player-picker-empty">No players match “{pickerQuery}”.</div>}
            </div>
            <footer className="marketplace-player-picker-footer">
              <div>{pickerPageCount > 1 ? <div className="marketplace-player-pagination"><button type="button" disabled={resolvedPickerPage === 1} onClick={() => setPickerPage(resolvedPickerPage - 1)}>Previous</button><span>Page {resolvedPickerPage} of {pickerPageCount}</span><button type="button" disabled={resolvedPickerPage === pickerPageCount} onClick={() => setPickerPage(resolvedPickerPage + 1)}>Next</button></div> : null}</div>
              <div><button className="button secondary" type="button" onClick={() => setPlayerPickerOpen(false)}>Cancel</button><button className="button primary" type="button" onClick={savePlayerSelection}>Save {pickerSelectedIds.length} player{pickerSelectedIds.length === 1 ? '' : 's'}</button></div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
