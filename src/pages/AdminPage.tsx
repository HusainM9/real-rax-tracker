import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminAccountTrackers from '../components/AdminAccountTrackers'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
import { ThemedSelect } from '../components/ThemedSelect'
import { useAdminAuth } from '../context/AdminAuthContext'
import { ADMIN_EVENT_TYPES, type AdminEvent, type AdminUserSummary } from '../../lib/adminEventTypes'
import {
  fetchCatalogImportProfile,
  type CatalogSearchResult,
} from '../lib/catalogApi'
import { catalogProfileToFilteredJson } from '../lib/catalogProfileJson'
import {
  ACCOUNT_PASSWORD_HELP,
  ACCOUNT_PASSWORD_MAX_LENGTH,
  validateAccountPassword,
} from '../../lib/accountPasswordRules'
import { parseFetchJson } from '../lib/readResponseJson'
import {
  AVATAR_BACKFILL_TOP_N,
  AVATAR_BACKFILL_UI_MAX_PAGES,
  DEFAULT_SHOP_CRAWL_UI_MAX_PAGES,
  SHOP_CRAWL_UI_MAX_PAGES_CAP,
  SHOP_CRAWL_WAIT_LOG_INTERVAL_MS,
  SHOP_CRAWL_WAIT_STATUS_INTERVAL_MS,
  advanceShopCrawlBeforeByChunks,
  advanceShopCrawlBeforeByPages,
  avatarBackfillMaxBefore,
  clearShopCrawlResumeCursor,
  estimateShopCrawlChunkTimeoutMs,
  formatShopCrawlHttpFailure,
  formatShopCrawlResumeCursor,
  linkAbortTimeout,
  loadShopCrawlResumeCursor,
  saveShopCrawlResumeCursor,
  shopCrawlChunkTimeoutMessage,
  shopCrawlConfigsMatch,
  shopCrawlWaitingMessage,
  type ShopCrawlEntityType,
  type ShopCrawlResumeConfig,
  type ShopCrawlResumeCursor,
} from '../lib/shopCrawlClient'

type EventsResponse = {
  events: AdminEvent[]
  total: number
  storageConfigured: boolean
}

type UsersResponse = {
  users: AdminUserSummary[]
  storageConfigured: boolean
}

type OwnershipSnapshotSummary = {
  realUsername: string
  importedAt: string
  updatedAt: string
  passCount: number
  legendaryPlusCount: number
  raxRowCount: number
}

type OwnershipSnapshotsResponse = {
  snapshots: OwnershipSnapshotSummary[]
  storageConfigured: boolean
}

type OwnershipLookupResponse = {
  ownership: {
    realUsername: string
    importedAt: string
    updatedAt: string
    passes: Array<{ rarityLabel?: string; earnings?: Array<{ claimDay: string; baseRaxEarned: number }> }>
  } | null
  storageConfigured: boolean
}

type CatalogImportResponse = {
  ok: boolean
  mode: 'manual-upsert'
  passesUpserted?: number
  rowsUpserted?: number
  skippedRows?: number
  error?: string
}

type TrackerProfileLookupResponse = {
  profile: {
    username: string
    updatedAt: string
    cardCount: number
    performanceCount: number
  } | null
  storageConfigured: boolean
  error?: string
}

type ShopCrawlLogEvent = {
  type: string
  message: string
}

type ShopCrawlLogLine = {
  id: number
  type: string
  message: string
}

type ShopEarningsCrawlResponse = {
  ok: boolean
  upserted: number
  pagesFetched: number
  earningsFetched: number
  earningsFailed: number
  dailyRowsUpserted: number
  nextBefore: number
  done: boolean
  jobsTotal: number
  maxPages?: number
  delayMs?: number
  earningsConcurrency?: number
  cursor: {
    jobIndex: number
    before: number
    sport: string
    season: number
    entityType: 'player' | 'team'
  }
  skipped?: Array<{ sport: string; season: number; entityType: string; reason: string }>
  failures?: string[]
  log?: ShopCrawlLogEvent[]
  error?: string
}

const LIVE_SHOP_CRAWL_SPORTS = [
  { label: 'NBA', value: 'nba' },
  { label: 'WNBA', value: 'wnba' },
  { label: 'NFL', value: 'nfl' },
  { label: 'CFB', value: 'ncaaf' },
  { label: 'MLB', value: 'mlb' },
  { label: 'NHL', value: 'nhl' },
  { label: 'CBB', value: 'ncaam' },
  { label: 'Golf', value: 'golf' },
  { label: 'FC', value: 'soccer' },
] as const

const EVENT_TYPE_LABELS: Record<AdminEvent['type'], string> = {
  import_complete: 'Import complete',
  pass_no_earnings: 'No earnings',
  pass_fetch_error: 'Fetch error',
}

export default function AdminPage() {
  const { logout, devBypass } = useAdminAuth()
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [eventsTotal, setEventsTotal] = useState(0)
  const [storageConfigured, setStorageConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | AdminEvent['type']>('all')
  const [usernameFilter, setUsernameFilter] = useState('')
  const [ownershipLookupUsername, setOwnershipLookupUsername] = useState('')
  const [ownershipLookupStatus, setOwnershipLookupStatus] = useState('')
  const [cloudProfileUsername, setCloudProfileUsername] = useState('')
  const [cloudProfileNewPin, setCloudProfileNewPin] = useState('')
  const [cloudProfileStatus, setCloudProfileStatus] = useState('')
  const [cloudProfileBusy, setCloudProfileBusy] = useState(false)
  const [cloudProfileSummary, setCloudProfileSummary] = useState<
    TrackerProfileLookupResponse['profile']
  >(null)
  const [accountTrackersRefreshKey, setAccountTrackersRefreshKey] = useState(0)
  const [ownershipSnapshots, setOwnershipSnapshots] = useState<OwnershipSnapshotSummary[]>([])
  const [ownershipSnapshotsLoading, setOwnershipSnapshotsLoading] = useState(false)
  const [ownershipSnapshotsError, setOwnershipSnapshotsError] = useState('')
  const [manualUpsert, setManualUpsert] = useState({
    externalKey: '',
    entityId: '',
    seasonYear: '',
    sport: 'NBA',
    passKind: 'player' as 'player' | 'team',
    name: '',
    rarityLabel: '',
    seasonLabel: '',
    rawJson: '',
  })
  const [manualUpsertLoadingKey, setManualUpsertLoadingKey] = useState('')
  const [manualUpsertBusy, setManualUpsertBusy] = useState(false)
  const [manualUpsertStatus, setManualUpsertStatus] = useState('')
  const [shopCrawl, setShopCrawl] = useState({
    seasons: '',
    sports: LIVE_SHOP_CRAWL_SPORTS.map((sport) => sport.value),
    includeUfc: false,
    includePlayers: true,
    includeTeams: true,
    avatarsOnly: false,
    maxPages: String(DEFAULT_SHOP_CRAWL_UI_MAX_PAGES),
    delayMs: '300',
  })
  const [shopCrawlBusy, setShopCrawlBusy] = useState(false)
  const [shopCrawlStatus, setShopCrawlStatus] = useState('')
  const [shopCrawlAbort, setShopCrawlAbort] = useState<AbortController | null>(null)
  const [shopCrawlLog, setShopCrawlLog] = useState<ShopCrawlLogLine[]>([])
  const [shopCrawlResume, setShopCrawlResume] = useState<ShopCrawlResumeCursor | null>(() =>
    loadShopCrawlResumeCursor(),
  )
  const [shopCrawlSkipChunks, setShopCrawlSkipChunks] = useState('1')
  const [shopCrawlSkipPages, setShopCrawlSkipPages] = useState('1')
  const [shopCrawlCursorJobIndex, setShopCrawlCursorJobIndex] = useState(() =>
    String(loadShopCrawlResumeCursor()?.jobIndex ?? 0),
  )
  const [shopCrawlCursorBefore, setShopCrawlCursorBefore] = useState(() =>
    String(loadShopCrawlResumeCursor()?.before ?? 0),
  )
  const shopCrawlLogIdRef = useRef(0)
  const shopCrawlLogPanelRef = useRef<HTMLDivElement | null>(null)
  const shopCrawlResumeRef = useRef<ShopCrawlResumeCursor | null>(shopCrawlResume)

  const syncShopCrawlResume = useCallback((cursor: ShopCrawlResumeCursor | null) => {
    shopCrawlResumeRef.current = cursor
    setShopCrawlResume(cursor)
    if (cursor) {
      setShopCrawlCursorJobIndex(String(cursor.jobIndex))
      setShopCrawlCursorBefore(String(cursor.before))
      saveShopCrawlResumeCursor(cursor)
    } else {
      clearShopCrawlResumeCursor()
    }
  }, [])

  const appendShopCrawlLog = useCallback((type: string, message: string) => {
    shopCrawlLogIdRef.current += 1
    const id = shopCrawlLogIdRef.current
    setShopCrawlLog((current) => [...current, { id, type, message }])
  }, [])

  const appendShopCrawlLogEvents = useCallback((events: ShopCrawlLogEvent[] | undefined) => {
    if (!events || events.length === 0) return
    setShopCrawlLog((current) => {
      let nextId = shopCrawlLogIdRef.current
      const appended = events.map((event) => {
        nextId += 1
        return {
          id: nextId,
          type: event.type || 'info',
          message: event.message,
        }
      })
      shopCrawlLogIdRef.current = nextId
      return [...current, ...appended]
    })
  }, [])

  useEffect(() => {
    const panel = shopCrawlLogPanelRef.current
    if (!panel) return
    panel.scrollTop = panel.scrollHeight
  }, [shopCrawlLog])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (typeFilter !== 'all') params.set('type', typeFilter)
      if (usernameFilter.trim()) params.set('username', usernameFilter.trim())
      params.set('limit', '200')

      const [usersResponse, eventsResponse] = await Promise.all([
        fetch('/api/admin/users', { credentials: 'include' }),
        fetch(`/api/admin/events?${params.toString()}`, { credentials: 'include' }),
      ])

      if (!usersResponse.ok || !eventsResponse.ok) {
        throw new Error('Could not load admin data')
      }

      const usersData = (await usersResponse.json()) as UsersResponse
      const eventsData = (await eventsResponse.json()) as EventsResponse
      setUsers(usersData.users)
      setEvents(eventsData.events)
      setEventsTotal(eventsData.total)
      setStorageConfigured(usersData.storageConfigured && eventsData.storageConfigured)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load admin data')
    } finally {
      setLoading(false)
    }
  }, [typeFilter, usernameFilter])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const loadOwnershipSnapshots = useCallback(async () => {
    setOwnershipSnapshotsLoading(true)
    setOwnershipSnapshotsError('')
    try {
      const response = await fetch('/api/admin/ownership?list=1', { credentials: 'include' })
      if (!response.ok) {
        throw new Error('Could not load ownership snapshots.')
      }
      const body = (await response.json()) as OwnershipSnapshotsResponse
      setOwnershipSnapshots(body.snapshots ?? [])
    } catch (loadError) {
      setOwnershipSnapshotsError(
        loadError instanceof Error ? loadError.message : 'Could not load ownership snapshots.',
      )
    } finally {
      setOwnershipSnapshotsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOwnershipSnapshots()
  }, [loadOwnershipSnapshots])

  const summary = useMemo(() => {
    const noEarnings = users.reduce((sum, user) => sum + user.passNoEarningsCount, 0)
    return {
      userCount: users.length,
      noEarnings,
    }
  }, [users])

  const lookupOwnership = async () => {
    const username = ownershipLookupUsername.replace(/^@/, '').trim().toLowerCase()
    if (!username) {
      setOwnershipLookupStatus('Enter a username to check.')
      return
    }
    setOwnershipLookupStatus('Checking snapshot…')
    try {
      const response = await fetch(
        `/api/admin/ownership?username=${encodeURIComponent(username)}`,
        { credentials: 'include' },
      )
      if (!response.ok) {
        throw new Error('Could not check ownership snapshot.')
      }
      const body = (await response.json()) as OwnershipLookupResponse
      if (!body.ownership) {
        setOwnershipLookupStatus(
          `No cached snapshot found for @${username}. Snapshots appear after a successful username import reports ownership.`,
        )
        return
      }
      const legendaryPlusCount = body.ownership.passes.filter((pass) => {
        const rarity = pass.rarityLabel?.toLowerCase() ?? ''
        return (
          rarity.startsWith('legendary') ||
          rarity.startsWith('mystic') ||
          rarity.startsWith('iconic')
        )
      }).length
      const raxRows = body.ownership.passes.reduce(
        (sum, pass) => sum + (pass.earnings?.length ?? 0),
        0,
      )
      setOwnershipLookupStatus(
        `Snapshot found for @${body.ownership.realUsername}: ${body.ownership.passes.length} total passes (${legendaryPlusCount} Legendary+, ${raxRows} saved RAX row${raxRows === 1 ? '' : 's'}). Users can recover via Entry → Import from admin cached passes.`,
      )
    } catch (error) {
      setOwnershipLookupStatus(
        error instanceof Error ? error.message : 'Could not check ownership snapshot.',
      )
    }
  }

  const lookupCloudProfile = async () => {
    const username = cloudProfileUsername.replace(/^@/, '').trim().toLowerCase()
    if (!username) {
      setCloudProfileStatus('Enter a username to check.')
      setCloudProfileSummary(null)
      return
    }
    setCloudProfileBusy(true)
    setCloudProfileStatus('Checking account…')
    try {
      const response = await fetch(
        `/api/admin/tracker-profile?username=${encodeURIComponent(username)}`,
        { credentials: 'include' },
      )
      const body = (await response.json()) as TrackerProfileLookupResponse
      if (!response.ok) {
        throw new Error(body.error || `Account lookup failed (${response.status}).`)
      }
      if (!body.profile) {
        setCloudProfileSummary(null)
        setCloudProfileStatus(`No account found for @${username}.`)
        return
      }
      setCloudProfileSummary(body.profile)
      setCloudProfileStatus(
        `Account for @${body.profile.username}: ${body.profile.cardCount} card${body.profile.cardCount === 1 ? '' : 's'}, ${body.profile.performanceCount} earnings row${body.profile.performanceCount === 1 ? '' : 's'}, last saved ${new Date(body.profile.updatedAt).toLocaleString()}.`,
      )
    } catch (error) {
      setCloudProfileSummary(null)
      setCloudProfileStatus(
        error instanceof Error ? error.message : 'Could not check account.',
      )
    } finally {
      setCloudProfileBusy(false)
    }
  }

  const resetCloudProfilePin = async () => {
    const username = cloudProfileUsername.replace(/^@/, '').trim().toLowerCase()
    if (!username) {
      setCloudProfileStatus('Enter a username first.')
      return
    }
    const passwordResult = validateAccountPassword(cloudProfileNewPin)
    if (!passwordResult.ok) {
      setCloudProfileStatus(passwordResult.error)
      return
    }
    if (
      !window.confirm(
        `Permanently reset the password for @${username}? Their saved account data stays intact. They will be signed out everywhere and must use this new password.`,
      )
    ) {
      return
    }

    setCloudProfileBusy(true)
    setCloudProfileStatus('Resetting password…')
    try {
      const response = await fetch('/api/admin/tracker-profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, newPassword: passwordResult.password }),
      })
      const body = (await response.json()) as TrackerProfileLookupResponse & { ok?: boolean; error?: string }
      if (!response.ok) {
        throw new Error(body.error || `Password reset failed (${response.status}).`)
      }
      setCloudProfileSummary(body.profile ?? null)
      setCloudProfileStatus(
        `Password permanently reset for @${username}. Existing sessions were signed out. Share the new password with the user privately.`,
      )
      setAccountTrackersRefreshKey((current) => current + 1)
    } catch (error) {
      setCloudProfileStatus(error instanceof Error ? error.message : 'Could not reset password.')
    } finally {
      setCloudProfileBusy(false)
    }
  }

  const deleteCloudProfile = async () => {
    const username = cloudProfileUsername.replace(/^@/, '').trim().toLowerCase()
    if (!username) {
      setCloudProfileStatus('Enter a username first.')
      return
    }
    if (
      !window.confirm(
        `Delete the account for @${username}? This removes their saved collection. They can register again with a new password.`,
      )
    ) {
      return
    }

    setCloudProfileBusy(true)
    setCloudProfileStatus('Deleting account…')
    try {
      const response = await fetch(
        `/api/admin/tracker-profile?username=${encodeURIComponent(username)}`,
        { method: 'DELETE', credentials: 'include' },
      )
      const body = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok) {
        throw new Error(body.error || `Delete failed (${response.status}).`)
      }
      setCloudProfileSummary(null)
      setCloudProfileStatus(`Deleted account for @${username}. They can register again with a new password.`)
      setAccountTrackersRefreshKey((current) => current + 1)
    } catch (error) {
      setCloudProfileStatus(error instanceof Error ? error.message : 'Could not delete account.')
    } finally {
      setCloudProfileBusy(false)
    }
  }

  const deleteAllAccounts = async () => {
    if (
      !window.confirm(
        'Delete ALL accounts and legacy cloud-sync profiles? Everyone will need to create a new account. This cannot be undone.',
      )
    ) {
      return
    }
    if (!window.confirm('Final confirm: wipe every stored account profile now?')) {
      return
    }

    setCloudProfileBusy(true)
    setCloudProfileStatus('Deleting all accounts…')
    try {
      const response = await fetch('/api/admin/tracker-profile?all=1', {
        method: 'DELETE',
        credentials: 'include',
      })
      const body = (await response.json()) as {
        ok?: boolean
        deleted?: number
        usernames?: string[]
        error?: string
      }
      if (!response.ok) {
        throw new Error(body.error || `Delete all failed (${response.status}).`)
      }
      setCloudProfileSummary(null)
      const deleted = Number(body.deleted) || 0
      setCloudProfileStatus(
        deleted === 0
          ? 'No accounts found to delete.'
          : `Deleted ${deleted} account${deleted === 1 ? '' : 's'}${
              body.usernames?.length
                ? ` (${body.usernames.map((name) => `@${name}`).join(', ')})`
                : ''
            }. Users can create fresh accounts now.`,
      )
      setAccountTrackersRefreshKey((current) => current + 1)
    } catch (error) {
      setCloudProfileStatus(error instanceof Error ? error.message : 'Could not delete all accounts.')
    } finally {
      setCloudProfileBusy(false)
    }
  }

  const loadManualUpsertPass = async (result: CatalogSearchResult, _rarityLabel = '') => {
    setManualUpsertLoadingKey(result.externalKey)
    setManualUpsertStatus('Loading pass from catalog…')
    try {
      const { profile, storageConfigured } = await fetchCatalogImportProfile(result.externalKey)
      if (!storageConfigured) {
        setManualUpsertStatus('Catalog search is not configured yet.')
        return
      }
      if (!profile) {
        setManualUpsertStatus('That pass was not found in the catalog. Try searching again.')
        return
      }

      setManualUpsert({
        externalKey: profile.externalKey,
        entityId: String(profile.entityId),
        seasonYear: String(profile.seasonYear),
        sport: profile.sport,
        passKind: profile.passKind,
        name: profile.name,
        rarityLabel: profile.rarityLabel ?? '',
        seasonLabel: profile.seasonLabel,
        rawJson:
          profile.rows.length > 0
            ? catalogProfileToFilteredJson(profile)
            : '{\n  "earnings": []\n}',
      })
      setManualUpsertStatus(
        `Loaded ${profile.name} (${profile.rowCount} existing RAX row${profile.rowCount === 1 ? '' : 's'}). Edit the JSON below, then upsert to Supabase.`,
      )
    } catch (error) {
      setManualUpsertStatus(error instanceof Error ? error.message : 'Could not load catalog pass.')
    } finally {
      setManualUpsertLoadingKey('')
    }
  }

  const submitManualUpsert = async () => {
    setManualUpsertBusy(true)
    setManualUpsertStatus('Saving catalog override to Supabase…')
    try {
      const response = await fetch('/api/admin/catalog-import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'manual-upsert',
          externalKey: manualUpsert.externalKey || undefined,
          entityId: Number(manualUpsert.entityId),
          seasonYear: Number(manualUpsert.seasonYear),
          sport: manualUpsert.sport,
          passKind: manualUpsert.passKind,
          name: manualUpsert.name,
          rarityLabel: manualUpsert.rarityLabel || undefined,
          seasonLabel: manualUpsert.seasonLabel || undefined,
          rawJson: manualUpsert.rawJson,
        }),
      })
      const data = await parseFetchJson<CatalogImportResponse>(response, 'Catalog upsert failed')
      const skipped = data.skippedRows ?? 0
      setManualUpsertStatus(
        `Saved ${data.passesUpserted ?? 0} pass with ${data.rowsUpserted ?? 0} RAX row${(data.rowsUpserted ?? 0) === 1 ? '' : 's'} to Supabase${skipped > 0 ? ` (${skipped} row${skipped === 1 ? '' : 's'} skipped in JSON)` : ''}.`,
      )
    } catch (error) {
      setManualUpsertStatus(error instanceof Error ? error.message : 'Manual catalog upsert failed.')
    } finally {
      setManualUpsertBusy(false)
    }
  }

  const stopShopCrawl = () => {
    shopCrawlAbort?.abort()
  }

  const parseShopCrawlSeasons = () =>
    shopCrawl.seasons
      .split(/[\s,]+/)
      .map((value) => Number(value))
      .filter((season) => Number.isInteger(season) && season > 0)

  const buildShopCrawlEntityTypes = (): ShopCrawlEntityType[] => {
    const entityTypes: ShopCrawlEntityType[] = []
    if (shopCrawl.includePlayers) entityTypes.push('player')
    if (shopCrawl.includeTeams) entityTypes.push('team')
    // UFC-only (or UFC with no live entity toggles): Real uses entity/team for fighters.
    if (entityTypes.length === 0 && shopCrawl.includeUfc) {
      entityTypes.push('team')
    }
    return entityTypes
  }

  const buildShopCrawlSportsForRequest = (): string[] =>
    shopCrawl.sports.length > 0
      ? shopCrawl.sports
      : shopCrawl.includeUfc
        ? ['ufc']
        : shopCrawl.sports

  const buildShopCrawlResumeConfig = (
    seasons: number[],
    sportsForCrawl: string[],
    entityTypes: ShopCrawlEntityType[],
  ): ShopCrawlResumeConfig => ({
    seasons,
    sports: sportsForCrawl,
    entityTypes,
    includeUfc: shopCrawl.includeUfc || sportsForCrawl.includes('ufc'),
  })

  const persistShopCrawlCursor = (
    config: ShopCrawlResumeConfig,
    jobIndex: number,
    before: number,
    meta?: {
      sport?: string
      season?: number
      entityType?: ShopCrawlEntityType
      jobsTotal?: number
    },
  ) => {
    const next: ShopCrawlResumeCursor = {
      ...config,
      jobIndex,
      before,
      savedAt: new Date().toISOString(),
    }
    if (meta?.sport) next.sport = meta.sport
    if (typeof meta?.season === 'number') next.season = meta.season
    if (meta?.entityType) next.entityType = meta.entityType
    if (typeof meta?.jobsTotal === 'number') next.jobsTotal = meta.jobsTotal
    else if (shopCrawlResumeRef.current?.jobsTotal) {
      next.jobsTotal = shopCrawlResumeRef.current.jobsTotal
    }
    // Keep last known job label when the server omits it (e.g. mid-abort).
    if (!next.sport && shopCrawlResumeRef.current?.sport) {
      next.sport = shopCrawlResumeRef.current.sport
      next.season = shopCrawlResumeRef.current.season
      next.entityType = shopCrawlResumeRef.current.entityType
    }
    syncShopCrawlResume(next)
  }

  const applyManualShopCrawlCursor = () => {
    const seasons = parseShopCrawlSeasons()
    if (seasons.length === 0) {
      setShopCrawlStatus('Enter at least one season year before setting a cursor.')
      return
    }
    const entityTypes = buildShopCrawlEntityTypes()
    const sportsForCrawl = buildShopCrawlSportsForRequest()
    if (sportsForCrawl.length === 0 && !shopCrawl.includeUfc) {
      setShopCrawlStatus('Select at least one sport, or enable UFC, before setting a cursor.')
      return
    }
    if (shopCrawl.sports.length > 0 && entityTypes.length === 0) {
      setShopCrawlStatus('Select players and/or teams before setting a cursor.')
      return
    }
    const jobIndex = Math.max(0, Math.floor(Number(shopCrawlCursorJobIndex)) || 0)
    const before = Math.max(0, Math.floor(Number(shopCrawlCursorBefore)) || 0)
    persistShopCrawlCursor(
      buildShopCrawlResumeConfig(seasons, sportsForCrawl, entityTypes),
      jobIndex,
      before,
    )
    setShopCrawlStatus(
      `Cursor set to ${formatShopCrawlResumeCursor({ jobIndex, before })}. Use Continue from saved to resume there.`,
    )
  }

  const skipShopCrawlCursorByChunks = () => {
    const base = shopCrawlResumeRef.current
    const jobIndex = Math.max(
      0,
      Math.floor(Number(shopCrawlCursorJobIndex)) || base?.jobIndex || 0,
    )
    const before = Math.max(0, Math.floor(Number(shopCrawlCursorBefore)) || base?.before || 0)
    const chunks = Math.max(0, Math.floor(Number(shopCrawlSkipChunks)) || 0)
    const maxPages = Math.min(
      SHOP_CRAWL_UI_MAX_PAGES_CAP,
      Math.max(1, Number(shopCrawl.maxPages) || DEFAULT_SHOP_CRAWL_UI_MAX_PAGES),
    )
    const nextBefore = advanceShopCrawlBeforeByChunks(before, chunks, maxPages)
    setShopCrawlCursorJobIndex(String(jobIndex))
    setShopCrawlCursorBefore(String(nextBefore))
    const seasons = parseShopCrawlSeasons()
    const entityTypes = buildShopCrawlEntityTypes()
    const sportsForCrawl = buildShopCrawlSportsForRequest()
    if (seasons.length > 0 && (sportsForCrawl.length > 0 || shopCrawl.includeUfc)) {
      persistShopCrawlCursor(
        buildShopCrawlResumeConfig(seasons, sportsForCrawl, entityTypes),
        jobIndex,
        nextBefore,
      )
    }
    setShopCrawlStatus(
      `Skipped ${chunks} chunk${chunks === 1 ? '' : 's'} (maxPages=${maxPages}): now ${formatShopCrawlResumeCursor({ jobIndex, before: nextBefore })}.`,
    )
  }

  const skipShopCrawlCursorByPages = () => {
    const base = shopCrawlResumeRef.current
    const jobIndex = Math.max(
      0,
      Math.floor(Number(shopCrawlCursorJobIndex)) || base?.jobIndex || 0,
    )
    const before = Math.max(0, Math.floor(Number(shopCrawlCursorBefore)) || base?.before || 0)
    const pages = Math.max(0, Math.floor(Number(shopCrawlSkipPages)) || 0)
    const nextBefore = advanceShopCrawlBeforeByPages(before, pages)
    setShopCrawlCursorJobIndex(String(jobIndex))
    setShopCrawlCursorBefore(String(nextBefore))
    const seasons = parseShopCrawlSeasons()
    const entityTypes = buildShopCrawlEntityTypes()
    const sportsForCrawl = buildShopCrawlSportsForRequest()
    if (seasons.length > 0 && (sportsForCrawl.length > 0 || shopCrawl.includeUfc)) {
      persistShopCrawlCursor(
        buildShopCrawlResumeConfig(seasons, sportsForCrawl, entityTypes),
        jobIndex,
        nextBefore,
      )
    }
    setShopCrawlStatus(
      `Skipped ahead ${pages} page${pages === 1 ? '' : 's'}: now ${formatShopCrawlResumeCursor({ jobIndex, before: nextBefore })}.`,
    )
  }

  const clearSavedShopCrawlCursor = () => {
    syncShopCrawlResume(null)
    setShopCrawlCursorJobIndex('0')
    setShopCrawlCursorBefore('0')
    setShopCrawlStatus('Cleared saved crawl cursor.')
  }

  const ufcOnlySelected =
    shopCrawl.includeUfc && shopCrawl.sports.length === 0
  const liveSportsSelected = shopCrawl.sports.length > 0
  const hasEntityTypeSelection = shopCrawl.includePlayers || shopCrawl.includeTeams
  // UFC fighters use Real's entity/team path; player/team toggles only apply to live sports.
  const canStartShopCrawl =
    !shopCrawlBusy &&
    (liveSportsSelected || shopCrawl.includeUfc) &&
    (ufcOnlySelected || hasEntityTypeSelection)

  let currentShopCrawlConfigPreview: ShopCrawlResumeConfig | null = null
  {
    const seasons = parseShopCrawlSeasons()
    const entityTypes = buildShopCrawlEntityTypes()
    const sportsForCrawl = buildShopCrawlSportsForRequest()
    if (
      seasons.length > 0 &&
      (sportsForCrawl.length > 0 || shopCrawl.includeUfc) &&
      (!liveSportsSelected || entityTypes.length > 0)
    ) {
      currentShopCrawlConfigPreview = buildShopCrawlResumeConfig(
        seasons,
        sportsForCrawl,
        entityTypes,
      )
    }
  }

  const savedCursorMatchesConfig =
    Boolean(shopCrawlResume) &&
    Boolean(currentShopCrawlConfigPreview) &&
    shopCrawlConfigsMatch(shopCrawlResume!, currentShopCrawlConfigPreview!)

  const canContinueShopCrawl = canStartShopCrawl && savedCursorMatchesConfig
  const savedCursorMismatch =
    Boolean(shopCrawlResume) &&
    Boolean(currentShopCrawlConfigPreview) &&
    !savedCursorMatchesConfig

  const runShopEarningsCrawl = async (
    mode: 'resume' | 'fresh' = 'fresh',
    runOptions?: {
      avatarsOnly?: boolean
      maxBefore?: number
      maxPages?: number
      /** Force all live sports + UFC + players + teams (one-button face backfill). */
      backfillAllSports?: boolean
    },
  ) => {
    const seasons = parseShopCrawlSeasons()
    const avatarsOnly = runOptions?.avatarsOnly ?? shopCrawl.avatarsOnly
    const backfillAllSports = runOptions?.backfillAllSports === true
    const sportsForCrawl = backfillAllSports
      ? LIVE_SHOP_CRAWL_SPORTS.map((sport) => sport.value)
      : buildShopCrawlSportsForRequest()
    const includeUfc = backfillAllSports
      ? true
      : shopCrawl.includeUfc || sportsForCrawl.includes('ufc')
    const entityTypes: ShopCrawlEntityType[] = backfillAllSports
      ? ['player', 'team']
      : buildShopCrawlEntityTypes()
    const maxBefore =
      typeof runOptions?.maxBefore === 'number' && Number.isFinite(runOptions.maxBefore)
        ? Math.max(0, Math.floor(runOptions.maxBefore))
        : null
    const maxPagesCap = avatarsOnly ? AVATAR_BACKFILL_UI_MAX_PAGES : SHOP_CRAWL_UI_MAX_PAGES_CAP
    const maxPages = Math.min(
      maxPagesCap,
      Math.max(
        1,
        Number(runOptions?.maxPages) ||
          Number(shopCrawl.maxPages) ||
          (avatarsOnly ? AVATAR_BACKFILL_UI_MAX_PAGES : DEFAULT_SHOP_CRAWL_UI_MAX_PAGES),
      ),
    )

    if (seasons.length === 0) {
      const msg = 'Enter at least one season year (e.g. 2025,2026). UFC shop is season 2023 only.'
      setShopCrawlStatus(msg)
      setShopCrawlLog([{ id: 1, type: 'client_error', message: msg }])
      shopCrawlLogIdRef.current = 1
      return
    }
    if (sportsForCrawl.length === 0 && !includeUfc) {
      const msg = 'Select at least one sport, or enable UFC.'
      setShopCrawlStatus(msg)
      setShopCrawlLog([{ id: 1, type: 'client_error', message: msg }])
      shopCrawlLogIdRef.current = 1
      return
    }
    if (sportsForCrawl.length > 0 && entityTypes.length === 0) {
      const msg = 'Select players and/or teams for live sports (UFC does not use these toggles).'
      setShopCrawlStatus(msg)
      setShopCrawlLog([{ id: 1, type: 'client_error', message: msg }])
      shopCrawlLogIdRef.current = 1
      return
    }

    if (backfillAllSports) {
      setShopCrawl((current) => ({
        ...current,
        sports: LIVE_SHOP_CRAWL_SPORTS.map((sport) => sport.value),
        includeUfc: true,
        includePlayers: true,
        includeTeams: true,
        avatarsOnly: true,
        maxPages: String(AVATAR_BACKFILL_UI_MAX_PAGES),
      }))
    } else if (runOptions?.avatarsOnly != null) {
      setShopCrawl((current) => ({ ...current, avatarsOnly: runOptions.avatarsOnly === true }))
    }

    const controller = new AbortController()
    setShopCrawlAbort(controller)
    setShopCrawlBusy(true)

    const resumeConfig = buildShopCrawlResumeConfig(seasons, sportsForCrawl, entityTypes)
    const delayMs = Number(shopCrawl.delayMs)
    const resolvedDelayMs = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 300
    const chunkTimeoutMs = estimateShopCrawlChunkTimeoutMs(maxPages, resolvedDelayMs, {
      avatarsOnly,
    })

    let jobIndex = 0
    let before = 0
    let resumed = false
    if (mode === 'resume') {
      const saved = shopCrawlResumeRef.current
      if (!saved || !shopCrawlConfigsMatch(saved, resumeConfig)) {
        const msg =
          !saved
            ? 'No saved crawl cursor to continue from. Use Start over, or set a cursor manually.'
            : 'Saved crawl cursor is for a different season/sport/entity config. Match that config, or Start over / clear cursor.'
        setShopCrawlBusy(false)
        setShopCrawlAbort(null)
        setShopCrawlStatus(msg)
        setShopCrawlLog([{ id: 1, type: 'client_error', message: msg }])
        shopCrawlLogIdRef.current = 1
        return
      }
      jobIndex = Math.max(0, Math.floor(Number(shopCrawlCursorJobIndex)) || saved.jobIndex)
      before = Math.max(0, Math.floor(Number(shopCrawlCursorBefore)) || saved.before)
      resumed = true
    } else {
      syncShopCrawlResume(null)
      setShopCrawlCursorJobIndex('0')
      setShopCrawlCursorBefore('0')
    }

    const topNLabel =
      maxBefore != null ? `, top≈${maxBefore + 20} per sport/season/type` : ''
    const modeLabel = avatarsOnly ? 'avatars-only' : 'full earnings'
    const startMsg = resumed
      ? `Resuming ${modeLabel} crawl from ${formatShopCrawlResumeCursor({
          jobIndex,
          before,
          sport: shopCrawlResumeRef.current?.sport,
          season: shopCrawlResumeRef.current?.season,
          entityType: shopCrawlResumeRef.current?.entityType,
          jobsTotal: shopCrawlResumeRef.current?.jobsTotal,
        })}: seasons=[${seasons.join(',')}], sports=[${sportsForCrawl.join(',')}${
          includeUfc && !sportsForCrawl.includes('ufc') ? ',ufc' : ''
        }], entityTypes=[${entityTypes.join(',')}]${
          includeUfc ? ' (UFC uses team path; shop season 2023 All-time)' : ''
        }, maxPages/chunk=${maxPages}, delayMs=${resolvedDelayMs}${topNLabel}, chunkTimeout≈${Math.round(chunkTimeoutMs / 1000)}s`
      : `Starting ${modeLabel} crawl: seasons=[${seasons.join(',')}], sports=[${sportsForCrawl.join(',')}${
          includeUfc && !sportsForCrawl.includes('ufc') ? ',ufc' : ''
        }], entityTypes=[${entityTypes.join(',')}]${
          includeUfc ? ' (UFC uses team path; shop season 2023 All-time)' : ''
        }, maxPages/chunk=${maxPages}, delayMs=${resolvedDelayMs}${topNLabel}, chunkTimeout≈${Math.round(chunkTimeoutMs / 1000)}s`

    shopCrawlLogIdRef.current = 1
    setShopCrawlLog([{ id: 1, type: 'client_start', message: startMsg }])
    setShopCrawlStatus(
      resumed
        ? `Resuming ${modeLabel} crawl from jobIndex=${jobIndex}, before=${before}…`
        : `Starting ${modeLabel} crawl…`,
    )
    // Yield so React paints the first log line before the first network request.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0)
    })
    if (controller.signal.aborted) {
      setShopCrawlBusy(false)
      setShopCrawlAbort(null)
      return
    }

    let totalUpserted = 0
    let totalPages = 0
    let totalEarningsFetched = 0
    let totalEarningsFailed = 0
    let totalDailyRows = 0
    let chunks = 0
    const skippedNotes: string[] = []
    const failureNotes: string[] = []

    try {
      while (!controller.signal.aborted) {
        chunks += 1
        appendShopCrawlLog(
          'client_chunk',
          `Requesting chunk ${chunks} (jobIndex=${jobIndex}, before=${before})…`,
        )
        setShopCrawlStatus(
          avatarsOnly
            ? `Chunk ${chunks}: avatars (job ${jobIndex + 1}, before=${before})… ${totalUpserted} passes so far.`
            : `Chunk ${chunks}: shop + dailies (job ${jobIndex + 1}, before=${before})… ${totalUpserted} passes / ${totalEarningsFetched} earnings / ${totalDailyRows} daily rows so far.`,
        )

        const linked = linkAbortTimeout(chunkTimeoutMs, controller.signal)
        const waitStarted = Date.now()
        let lastWaitLogAt = 0
        const waitTimer = window.setInterval(() => {
          const elapsed = Date.now() - waitStarted
          const waitMsg = shopCrawlWaitingMessage(chunks, elapsed, { avatarsOnly })
          setShopCrawlStatus(waitMsg)
          if (elapsed - lastWaitLogAt >= SHOP_CRAWL_WAIT_LOG_INTERVAL_MS) {
            lastWaitLogAt = elapsed
            appendShopCrawlLog('client_wait', waitMsg)
          }
        }, SHOP_CRAWL_WAIT_STATUS_INTERVAL_MS)

        let response: Response
        try {
          response = await fetch('/api/admin/shop-earnings-crawl', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            signal: linked.signal,
            body: JSON.stringify({
              seasons,
              sports: sportsForCrawl,
              includeUfc,
              entityTypes,
              jobIndex,
              before,
              maxPages,
              delayMs: resolvedDelayMs,
              avatarsOnly,
              ...(maxBefore != null ? { maxBefore } : {}),
            }),
          })
        } catch (error) {
          if (linked.timedOut()) {
            throw new Error(shopCrawlChunkTimeoutMessage(chunks, chunkTimeoutMs, jobIndex, before))
          }
          throw error
        } finally {
          window.clearInterval(waitTimer)
          linked.dispose()
        }

        const rawText = await response.text()
        let data: ShopEarningsCrawlResponse
        try {
          data = rawText.trim()
            ? (JSON.parse(rawText) as ShopEarningsCrawlResponse)
            : ({} as ShopEarningsCrawlResponse)
        } catch {
          const snippet = rawText.trim().replace(/\s+/g, ' ').slice(0, 200)
          throw new Error(formatShopCrawlHttpFailure(response.status, snippet))
        }

        // Always surface server log lines, including first-chunk validation errors.
        appendShopCrawlLogEvents(data.log)

        if (!response.ok) {
          throw new Error(
            typeof data.error === 'string' && data.error.trim()
              ? data.error.trim()
              : formatShopCrawlHttpFailure(response.status, ''),
          )
        }
        if (!data.cursor || typeof data.cursor.jobIndex !== 'number') {
          throw new Error(
            data.error ||
              'Shop earnings crawl returned an incomplete response (missing cursor). Check the activity log / server logs.',
          )
        }
        totalUpserted += data.upserted ?? 0
        totalPages += data.pagesFetched ?? 0
        totalEarningsFetched += data.earningsFetched ?? 0
        totalEarningsFailed += data.earningsFailed ?? 0
        totalDailyRows += data.dailyRowsUpserted ?? 0
        for (const skip of data.skipped ?? []) {
          skippedNotes.push(`${skip.sport}/${skip.season}/${skip.entityType}`)
        }
        for (const failure of data.failures ?? []) {
          failureNotes.push(failure)
        }
        jobIndex = data.cursor.jobIndex
        before = data.nextBefore ?? 0
        if (data.done) {
          syncShopCrawlResume(null)
          setShopCrawlCursorJobIndex('0')
          setShopCrawlCursorBefore('0')
        } else {
          persistShopCrawlCursor(resumeConfig, jobIndex, before, {
            sport: data.cursor.sport,
            season: data.cursor.season,
            entityType: data.cursor.entityType,
            jobsTotal: data.jobsTotal,
          })
        }
        setShopCrawlStatus(
          `Chunk ${chunks}: ${data.cursor.sport} ${data.cursor.season} ${data.cursor.entityType} @${data.cursor.before} — ${totalUpserted} passes / ${totalPages} pages / ${totalEarningsFetched} earnings fetched` +
            (totalEarningsFailed > 0 ? ` (${totalEarningsFailed} failed)` : '') +
            ` / ${totalDailyRows} daily rows` +
            (data.done ? ' (complete).' : '…'),
        )
        if (data.done) break
      }

      if (controller.signal.aborted) {
        persistShopCrawlCursor(resumeConfig, jobIndex, before)
        const stoppedMsg = `Crawl stopped by user. Partial: ${totalUpserted} passes, ${totalEarningsFetched} earnings, ${totalDailyRows} daily rows across ${totalPages} page${totalPages === 1 ? '' : 's'} (${chunks} chunk${chunks === 1 ? '' : 's'}). Resume ${formatShopCrawlResumeCursor({ jobIndex, before })}.`
        setShopCrawlStatus(stoppedMsg)
        appendShopCrawlLog('client_stopped', stoppedMsg)
      } else {
        const doneMsg =
          `Crawl complete: ${totalUpserted} pass${totalUpserted === 1 ? '' : 'es'}, ${totalEarningsFetched} earnings fetched, ${totalDailyRows} daily row${totalDailyRows === 1 ? '' : 's'} from ${totalPages} page${totalPages === 1 ? '' : 's'} (${chunks} chunk${chunks === 1 ? '' : 's'}).` +
          (totalEarningsFailed > 0 ? ` Earnings failures: ${totalEarningsFailed}.` : '') +
          (skippedNotes.length > 0
            ? ` Skipped empty/missing: ${[...new Set(skippedNotes)].join(', ')}.`
            : '') +
          (failureNotes.length > 0 ? ` Failures: ${failureNotes.slice(0, 5).join('; ')}.` : '')
        setShopCrawlStatus(doneMsg)
        appendShopCrawlLog('client_done', doneMsg)
      }
    } catch (error) {
      persistShopCrawlCursor(resumeConfig, jobIndex, before)
      if (controller.signal.aborted) {
        const stoppedMsg = `Crawl stopped by user. Partial: ${totalUpserted} passes / ${totalPages} pages / ${totalEarningsFetched} earnings / ${totalDailyRows} daily rows. Resume ${formatShopCrawlResumeCursor({ jobIndex, before })}.`
        setShopCrawlStatus(stoppedMsg)
        appendShopCrawlLog('client_stopped', stoppedMsg)
      } else {
        const errMsg =
          (error instanceof Error ? error.message : 'Shop earnings crawl failed.') +
          ` Partial progress saved (${totalUpserted} upserted, ${totalEarningsFetched} earnings). Resume ${formatShopCrawlResumeCursor({ jobIndex, before })}.`
        setShopCrawlStatus(errMsg)
        appendShopCrawlLog('client_error', errMsg)
      }
    } finally {
      setShopCrawlBusy(false)
      setShopCrawlAbort(null)
    }
  }

  return (
    <div className="page-stack admin-page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Operator</p>
          <h2>Admin</h2>
          <p>
            Crawl Real shop earnings into the shared catalog, fix catalog rows, and manage cloud
            profiles and import logs.
          </p>
        </div>
        <div className="button-row">
          <button className="button" type="button" onClick={() => void loadData()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="button" type="button" onClick={() => void logout()}>
            Admin logout
          </button>
          <Link className="button" to="/">
            Tracker
          </Link>
        </div>
      </section>

      {devBypass ? (
        <section className="panel import-hint">
          <p>
            <strong>Dev bypass active.</strong> Admin APIs are not enforced locally. Deploy to
            Vercel with KV and admin env vars to test end-to-end logging.
          </p>
        </section>
      ) : null}

      {!storageConfigured ? (
        <section className="panel import-hint">
          <p>
            <strong>KV storage is not configured.</strong> Link a Redis/KV store in Vercel and set
            `KV_REST_API_URL` / `KV_REST_API_TOKEN` to persist import logs.
          </p>
        </section>
      ) : null}

      {error ? (
        <section className="panel">
          <p className="empty">{error}</p>
        </section>
      ) : null}

      <CollapsiblePanel
        title="Catalog / Real shop crawl"
        description="Primary: crawl Real shop earningstotal into Supabase. Optional: override a catalog pass by hand."
        defaultOpen
      >
        <div className="form-subsection admin-primary-tools">
          <div className="section-heading">
            <div>
              <h3>Shop earningstotal crawl</h3>
              <p className="subsection-note">
                Crawl Real shop leaderboard → daily earnings into the catalog. Stop saves a cursor;
                Continue resumes without redoing finished pages. Use{' '}
                <strong>Backfill faces · top {AVATAR_BACKFILL_TOP_N}</strong> for a fast avatars-only
                pass (college players, teams, UFC) — enter seasons first.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Seasons (required)</span>
              <input
                value={shopCrawl.seasons}
                placeholder="2026,2025,2024"
                disabled={shopCrawlBusy}
                onChange={(event) =>
                  setShopCrawl((current) => ({ ...current, seasons: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="button-row admin-sport-toggles">
            {LIVE_SHOP_CRAWL_SPORTS.map((sport) => {
              const checked = shopCrawl.sports.includes(sport.value)
              return (
                <label className="inline-toggle" key={sport.value}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={shopCrawlBusy}
                    onChange={(event) =>
                      setShopCrawl((current) => ({
                        ...current,
                        sports: event.target.checked
                          ? [...current.sports, sport.value]
                          : current.sports.filter((value) => value !== sport.value),
                      }))
                    }
                  />
                  {sport.label}
                </label>
              )
            })}
            <button
              className="button"
              type="button"
              disabled={shopCrawlBusy}
              onClick={() =>
                setShopCrawl((current) => ({
                  ...current,
                  sports: LIVE_SHOP_CRAWL_SPORTS.map((sport) => sport.value),
                }))
              }
            >
              All live sports
            </button>
          </div>
          <div className="button-row">
            <label className="inline-toggle">
              <input
                type="checkbox"
                checked={shopCrawl.includeUfc}
                disabled={shopCrawlBusy}
                onChange={(event) =>
                  setShopCrawl((current) => ({ ...current, includeUfc: event.target.checked }))
                }
              />
              UFC
            </label>
            <label className="inline-toggle">
              <input
                type="checkbox"
                checked={shopCrawl.includePlayers}
                disabled={shopCrawlBusy || ufcOnlySelected}
                onChange={(event) =>
                  setShopCrawl((current) => ({
                    ...current,
                    includePlayers: event.target.checked,
                  }))
                }
              />
              Players
            </label>
            <label className="inline-toggle">
              <input
                type="checkbox"
                checked={shopCrawl.includeTeams}
                disabled={shopCrawlBusy || ufcOnlySelected}
                onChange={(event) =>
                  setShopCrawl((current) => ({
                    ...current,
                    includeTeams: event.target.checked,
                  }))
                }
              />
              Teams
            </label>
            <label className="inline-toggle" title="Skip daily earnings — only upsert shop metadata and faces/badges. Fast backfill for college players (Real omits their avatar on /userpasses).">
              <input
                type="checkbox"
                checked={shopCrawl.avatarsOnly}
                disabled={shopCrawlBusy}
                onChange={(event) =>
                  setShopCrawl((current) => ({
                    ...current,
                    avatarsOnly: event.target.checked,
                  }))
                }
              />
              Avatars only
            </label>
            <button
              className="button primary"
              type="button"
              disabled={!canContinueShopCrawl}
              onClick={() => void runShopEarningsCrawl('resume')}
            >
              {shopCrawlBusy ? 'Crawling…' : 'Continue from saved'}
            </button>
            <button
              className="button"
              type="button"
              disabled={!canStartShopCrawl}
              onClick={() => void runShopEarningsCrawl('fresh')}
            >
              Start over
            </button>
            <button
              className="button primary"
              type="button"
              disabled={shopCrawlBusy || parseShopCrawlSeasons().length === 0}
              title={`Avatars-only shop crawl: all live sports + UFC, players + teams, top ${AVATAR_BACKFILL_TOP_N} per sport/season. Enter seasons above first.`}
              onClick={() =>
                void runShopEarningsCrawl('fresh', {
                  avatarsOnly: true,
                  backfillAllSports: true,
                  maxBefore: avatarBackfillMaxBefore(AVATAR_BACKFILL_TOP_N),
                  maxPages: AVATAR_BACKFILL_UI_MAX_PAGES,
                })
              }
            >
              {shopCrawlBusy ? 'Crawling…' : `Backfill faces · top ${AVATAR_BACKFILL_TOP_N}`}
            </button>
            <button
              className="button"
              type="button"
              disabled={!shopCrawlBusy}
              onClick={stopShopCrawl}
            >
              Stop
            </button>
          </div>
          <div className="shop-crawl-resume">
            <p className="subsection-note">
              {shopCrawlResume ? (
                <>
                  Saved cursor:{' '}
                  <code>{formatShopCrawlResumeCursor(shopCrawlResume)}</code>
                  {shopCrawlResume.savedAt
                    ? ` · saved ${new Date(shopCrawlResume.savedAt).toLocaleString()}`
                    : ''}
                  {savedCursorMismatch
                    ? ' · config mismatch (change seasons/sports/entity types to match, or Start over).'
                    : savedCursorMatchesConfig
                      ? ' · matches current config — Continue resumes without re-fetching completed pages.'
                      : ''}
                </>
              ) : (
                <>No saved cursor yet. Stop mid-crawl or finish a chunk to persist one.</>
              )}
            </p>
            <div className="form-grid shop-crawl-cursor-grid">
              <label className="field">
                <span>jobIndex</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={shopCrawlCursorJobIndex}
                  disabled={shopCrawlBusy}
                  onChange={(event) => setShopCrawlCursorJobIndex(event.target.value)}
                />
              </label>
              <label className="field">
                <span>before offset</span>
                <input
                  type="number"
                  min="0"
                  step="20"
                  value={shopCrawlCursorBefore}
                  disabled={shopCrawlBusy}
                  onChange={(event) => setShopCrawlCursorBefore(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Skip N chunks</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={shopCrawlSkipChunks}
                  disabled={shopCrawlBusy}
                  onChange={(event) => setShopCrawlSkipChunks(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Skip ahead N pages</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={shopCrawlSkipPages}
                  disabled={shopCrawlBusy}
                  onChange={(event) => setShopCrawlSkipPages(event.target.value)}
                />
              </label>
            </div>
            <div className="button-row">
              <button
                className="button"
                type="button"
                disabled={shopCrawlBusy}
                onClick={applyManualShopCrawlCursor}
              >
                Set cursor
              </button>
              <button
                className="button"
                type="button"
                disabled={shopCrawlBusy}
                onClick={skipShopCrawlCursorByChunks}
              >
                Skip chunks
              </button>
              <button
                className="button"
                type="button"
                disabled={shopCrawlBusy}
                onClick={skipShopCrawlCursorByPages}
              >
                Skip pages
              </button>
              <button
                className="button"
                type="button"
                disabled={shopCrawlBusy || !shopCrawlResume}
                onClick={clearSavedShopCrawlCursor}
              >
                Clear saved
              </button>
            </div>
          </div>
          {ufcOnlySelected ? (
            <p className="subsection-note">
              UFC shop data is All-time under season <code>2023</code> only (other years return empty).
              Fighters are crawled via Real&apos;s <code>entity/team</code> path automatically — enter{' '}
              <code>2023</code> in Seasons above.
            </p>
          ) : shopCrawl.includeUfc ? (
            <p className="subsection-note">
              UFC is included alongside live sports. Use season <code>2023</code> for UFC (All-time
              sentinel; other years are empty). Fighter jobs always use the team shop path;
              player/team toggles apply only to the live sports above.
            </p>
          ) : null}
          <details className="admin-advanced">
            <summary>Advanced crawl settings</summary>
            <p className="subsection-note">
              Default is 1 page per chunk. Each page is 1 shop request + up to 20 earnings calls ×
              delay (≈5–15s at 300ms with concurrency). Log lines arrive only when the chunk HTTP
              response returns — keep max pages at 1 on Vercel so the platform does not kill the
              function (cap {SHOP_CRAWL_UI_MAX_PAGES_CAP}).
            </p>
            <div className="form-grid">
              <label className="field">
                <span>Max pages per chunk (1–{SHOP_CRAWL_UI_MAX_PAGES_CAP})</span>
                <input
                  type="number"
                  min="1"
                  max={SHOP_CRAWL_UI_MAX_PAGES_CAP}
                  value={shopCrawl.maxPages}
                  disabled={shopCrawlBusy}
                  onChange={(event) =>
                    setShopCrawl((current) => ({ ...current, maxPages: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Delay between Real calls (ms)</span>
                <input
                  type="number"
                  min="0"
                  max="60000"
                  value={shopCrawl.delayMs}
                  disabled={shopCrawlBusy}
                  onChange={(event) =>
                    setShopCrawl((current) => ({ ...current, delayMs: event.target.value }))
                  }
                />
              </label>
            </div>
          </details>
          {shopCrawlStatus ? <p className="import-status">{shopCrawlStatus}</p> : null}
          <div className="shop-crawl-log">
            <div className="shop-crawl-log-header">
              <span>Activity log</span>
              <button
                className="button"
                type="button"
                disabled={shopCrawlBusy || shopCrawlLog.length === 0}
                onClick={() => {
                  setShopCrawlLog([])
                  shopCrawlLogIdRef.current = 0
                }}
              >
                Clear
              </button>
            </div>
            <div
              className="shop-crawl-log-panel"
              ref={shopCrawlLogPanelRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
            >
              {shopCrawlLog.length === 0 ? (
                <p className="shop-crawl-log-empty">Crawl events appear here when you start.</p>
              ) : (
                shopCrawlLog.map((line) => (
                  <div
                    key={line.id}
                    className={`shop-crawl-log-line${
                      line.type === 'earnings_failure' ||
                      line.type === 'page_failed' ||
                      line.type === 'client_error'
                        ? ' is-error'
                        : line.type === 'job_skipped' || line.type === 'client_stopped'
                          ? ' is-warn'
                          : line.type === 'client_done' || line.type === 'chunk_complete'
                            ? ' is-ok'
                            : ''
                    }`}
                  >
                    {line.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <CollapsiblePanel
          className="nested-panel"
          title="Manual catalog override"
          description="Load a Supabase catalog pass, edit RAX JSON, upsert without upstream imports"
          defaultOpen={false}
        >
          <CatalogSearchPanel
            sectionId="admin-manual-upsert-search"
            title="Load existing pass"
            description="Search the shared catalog and load pass metadata plus current RAX rows into the editor below."
            badge="Admin override"
            actionLabel="Load pass"
            loadingLabel="Loading pass…"
            loadingKey={manualUpsertLoadingKey}
            disabled={manualUpsertBusy || Boolean(manualUpsertLoadingKey)}
            emptyHint="Search for a player or team pass to pre-fill entity ID, season, sport, name, and current RAX JSON."
            onSelect={loadManualUpsertPass}
          />

          <div className="form-grid">
            <label className="field">
              <span>Entity ID</span>
              <input
                value={manualUpsert.entityId}
                disabled={manualUpsertBusy}
                onChange={(event) =>
                  setManualUpsert((current) => ({ ...current, entityId: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Season year</span>
              <input
                value={manualUpsert.seasonYear}
                disabled={manualUpsertBusy}
                onChange={(event) =>
                  setManualUpsert((current) => ({ ...current, seasonYear: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Sport</span>
              <input
                value={manualUpsert.sport}
                disabled={manualUpsertBusy}
                onChange={(event) =>
                  setManualUpsert((current) => ({ ...current, sport: event.target.value }))
                }
              />
            </label>
            <ThemedSelect
              label="Pass type"
              value={manualUpsert.passKind}
              disabled={manualUpsertBusy}
              onChange={(value) =>
                setManualUpsert((current) => ({
                  ...current,
                  passKind: value as 'player' | 'team',
                }))
              }
              options={[
                { value: 'player', label: 'Player' },
                { value: 'team', label: 'Team' },
              ]}
            />
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Name</span>
              <input
                value={manualUpsert.name}
                disabled={manualUpsertBusy}
                onChange={(event) =>
                  setManualUpsert((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Rarity</span>
              <input
                value={manualUpsert.rarityLabel}
                disabled={manualUpsertBusy}
                onChange={(event) =>
                  setManualUpsert((current) => ({ ...current, rarityLabel: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Season label</span>
              <input
                value={manualUpsert.seasonLabel}
                disabled={manualUpsertBusy}
                onChange={(event) =>
                  setManualUpsert((current) => ({ ...current, seasonLabel: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>External key</span>
              <input
                value={manualUpsert.externalKey}
                placeholder="Auto from entity · season · sport"
                disabled={manualUpsertBusy}
                onChange={(event) =>
                  setManualUpsert((current) => ({ ...current, externalKey: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Daily RAX JSON</span>
            <textarea
              className="bulk-import-textarea"
              value={manualUpsert.rawJson}
              placeholder='Paste realapp.com JSON with an "earnings" array, or edit the loaded "rows" JSON.'
              disabled={manualUpsertBusy}
              onChange={(event) =>
                setManualUpsert((current) => ({ ...current, rawJson: event.target.value }))
              }
            />
          </label>
          <div className="button-row">
            <button
              className="button primary"
              type="button"
              disabled={
                manualUpsertBusy ||
                !manualUpsert.entityId.trim() ||
                !manualUpsert.seasonYear.trim() ||
                !manualUpsert.sport.trim() ||
                !manualUpsert.name.trim() ||
                !manualUpsert.rawJson.trim()
              }
              onClick={() => void submitManualUpsert()}
            >
              Upsert to Supabase
            </button>
          </div>
          {manualUpsertStatus ? <p className="import-status">{manualUpsertStatus}</p> : null}
        </CollapsiblePanel>
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Account management"
        description="Reset a forgotten password or delete user accounts / legacy cloud-sync profiles"
        defaultOpen={false}
      >
        <p className="import-hint">
          Accounts are keyed by Real @username. Passwords are stored as hashes — admins cannot read
          the old password. Reset permanently replaces their password, signs out existing sessions,
          and keeps their account data. Share the new password privately. Delete removes one
          account so they can register fresh. Use{' '}
          <strong>Delete all accounts</strong> to wipe legacy cloud-sync profiles.
        </p>
        <div className="button-row">
          <label className="field inline-field rank-search-field">
            <span>Username</span>
            <input
              type="search"
              value={cloudProfileUsername}
              disabled={cloudProfileBusy}
              placeholder="@username"
              onChange={(event) => setCloudProfileUsername(event.target.value.replace(/^@/, ''))}
            />
          </label>
          <button
            className="button"
            type="button"
            disabled={cloudProfileBusy}
            onClick={() => void lookupCloudProfile()}
          >
            Look up
          </button>
        </div>
        {cloudProfileSummary ? (
          <p className="import-hint">
            @{cloudProfileSummary.username} · {cloudProfileSummary.cardCount} cards ·{' '}
            {cloudProfileSummary.performanceCount} earnings rows · updated{' '}
            {new Date(cloudProfileSummary.updatedAt).toLocaleString()}
          </p>
        ) : null}
        <div className="sort-controls">
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              value={cloudProfileNewPin}
              disabled={cloudProfileBusy}
              placeholder="New password for the user"
              autoComplete="off"
              spellCheck={false}
              maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
              onChange={(event) => setCloudProfileNewPin(event.target.value)}
            />
            <small className="field-hint">{ACCOUNT_PASSWORD_HELP}</small>
          </label>
        </div>
        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={cloudProfileBusy}
            onClick={() => void resetCloudProfilePin()}
          >
            Reset password
          </button>
          <button
            className="button danger"
            type="button"
            disabled={cloudProfileBusy}
            onClick={() => void deleteCloudProfile()}
          >
            Delete account
          </button>
          <button
            className="button danger"
            type="button"
            disabled={cloudProfileBusy}
            onClick={() => void deleteAllAccounts()}
          >
            Delete all accounts
          </button>
        </div>
        {cloudProfileStatus ? <p className="import-status">{cloudProfileStatus}</p> : null}
      </CollapsiblePanel>

      <AdminAccountTrackers refreshKey={accountTrackersRefreshKey} />

      <CollapsiblePanel
        title="Ownership cache"
        description="Lookup and list snapshots reported by username imports"
        defaultOpen={false}
      >
        <div className="button-row">
          <label className="field inline-field rank-search-field">
            <span>Username</span>
            <input
              type="search"
              value={ownershipLookupUsername}
              placeholder="@username"
              onChange={(event) => setOwnershipLookupUsername(event.target.value)}
            />
          </label>
          <button className="button" type="button" onClick={() => void lookupOwnership()}>
            Check snapshot
          </button>
          <button
            className="button"
            type="button"
            disabled={ownershipSnapshotsLoading}
            onClick={() => void loadOwnershipSnapshots()}
          >
            {ownershipSnapshotsLoading ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>
        {ownershipLookupStatus ? <p className="import-status">{ownershipLookupStatus}</p> : null}
        {ownershipSnapshotsError ? (
          <p className="import-status import-status-error">{ownershipSnapshotsError}</p>
        ) : null}
        {ownershipSnapshots.length === 0 && !ownershipSnapshotsLoading ? (
          <p className="empty">No ownership snapshots saved yet.</p>
        ) : null}
        {ownershipSnapshots.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Passes</th>
                  <th>Legendary+</th>
                  <th>RAX rows</th>
                  <th>Imported</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {ownershipSnapshots.map((snapshot) => (
                  <tr key={snapshot.realUsername}>
                    <td>@{snapshot.realUsername}</td>
                    <td>{snapshot.passCount}</td>
                    <td>{snapshot.legendaryPlusCount}</td>
                    <td>{snapshot.raxRowCount.toLocaleString()}</td>
                    <td>{new Date(snapshot.importedAt).toLocaleString()}</td>
                    <td>{new Date(snapshot.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Real usernames seen"
        description={`${summary.userCount} username${summary.userCount === 1 ? '' : 's'} · ${summary.noEarnings} no-earnings event${summary.noEarnings === 1 ? '' : 's'}`}
        defaultOpen={false}
      >
        {users.length === 0 ? (
          <p className="empty">No import activity logged yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Last activity</th>
                  <th>Imports</th>
                  <th>No earnings</th>
                  <th>Fetch errors</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.realUsername}>
                    <td>@{user.realUsername}</td>
                    <td>{user.lastAt ? new Date(user.lastAt).toLocaleString() : '—'}</td>
                    <td>{user.importCompleteCount}</td>
                    <td>{user.passNoEarningsCount}</td>
                    <td>{user.passFetchErrorCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Event log"
        description={`${eventsTotal} matching event${eventsTotal === 1 ? '' : 's'}`}
        defaultOpen={false}
      >
        <div className="sort-controls">
          <label className="field inline-field rank-search-field">
            <span>Username</span>
            <input
              type="search"
              value={usernameFilter}
              placeholder="Filter by @username"
              onChange={(event) => setUsernameFilter(event.target.value)}
            />
          </label>
          <ThemedSelect
            label="Type"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as 'all' | AdminEvent['type'])}
            options={[
              { value: 'all', label: 'All types' },
              ...ADMIN_EVENT_TYPES.map((type) => ({
                value: type,
                label: EVENT_TYPE_LABELS[type],
              })),
            ]}
          />
        </div>

        {events.length === 0 ? (
          <p className="empty">No events match the current filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Username</th>
                  <th>Pass</th>
                  <th>Sport</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.at).toLocaleString()}</td>
                    <td>{EVENT_TYPE_LABELS[event.type]}</td>
                    <td>@{event.realUsername}</td>
                    <td>
                      {event.passName || '—'}
                      {event.season ? (
                        <>
                          <br />
                          <small className="table-sub">{event.season}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{event.sport || '—'}</td>
                    <td>
                      {event.message || '—'}
                      {event.rarityLabel ? (
                        <>
                          <br />
                          <small className="table-sub">{event.rarityLabel}</small>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsiblePanel>
    </div>
  )
}
