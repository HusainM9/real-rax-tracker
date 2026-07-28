import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { CatalogSearchPanel } from '../components/CatalogSearchPanel'
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

function parseAdminUsernames(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((value) => value.replace(/^@/, '').trim().toLowerCase()).filter(Boolean))]
}

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
  mode: 'saved-usernames' | 'usernames' | 'pass' | 'otd-table' | 'manual-upsert'
  totals?: {
    usernames: number
    passesScanned: number
    passesUpserted: number
    rowsUpserted: number
    passesWithNoEarnings: number
    failures: number
  }
  usernamesImported?: Array<{
    username: string
    passesScanned: number
    passesUpserted: number
    rowsUpserted: number
    passesWithNoEarnings: number
    failures: string[]
  }>
  passesScanned?: number
  passesUpserted?: number
  rowsUpserted?: number
  passesWithNoEarnings?: number
  failures?: string[]
  skippedRows?: number
  error?: string
}

type UsernameOwnershipResponse = {
  ok: boolean
  usernamesSaved?: Array<{
    username: string
    passesSaved: number
    rowsSaved: number
    passesWithNoEarnings: number
    failures: string[]
    error?: string
  }>
  totals?: {
    usernames: number
    passesSaved: number
    rowsSaved: number
    passesWithNoEarnings: number
    failures: number
  }
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
  const [catalogUsernames, setCatalogUsernames] = useState('')
  const [ownershipSaveUsernames, setOwnershipSaveUsernames] = useState('')
  const [ownershipSaveStatus, setOwnershipSaveStatus] = useState('')
  const [ownershipSaving, setOwnershipSaving] = useState(false)
  const [ownershipSnapshots, setOwnershipSnapshots] = useState<OwnershipSnapshotSummary[]>([])
  const [ownershipSnapshotsLoading, setOwnershipSnapshotsLoading] = useState(false)
  const [ownershipSnapshotsError, setOwnershipSnapshotsError] = useState('')
  const [catalogSavedLimit, setCatalogSavedLimit] = useState('25')
  const [catalogStatus, setCatalogStatus] = useState('')
  const [catalogImporting, setCatalogImporting] = useState(false)
  const [otdImport, setOtdImport] = useState({
    seasons: '2026,2025',
    sport: '',
    includePlayers: true,
    includeTeams: true,
    maxPasses: '250',
  })
  const [passImport, setPassImport] = useState({
    entityId: '',
    seasonYear: '',
    sport: 'NBA',
    passKind: 'player' as 'player' | 'team',
    name: '',
    rarityLabel: '',
    seasonLabel: '',
  })
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
          `No cached snapshot found for @${username}. Import this username before shutdown to seed fallback.`,
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
        `Reset the password for @${username}? Their saved account data stays intact. Share the new password with them privately.`,
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
        `Password reset for @${username}. Share the new password with the user privately — they can change it on their Account page after signing in.`,
      )
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
    } catch (error) {
      setCloudProfileStatus(error instanceof Error ? error.message : 'Could not delete account.')
    } finally {
      setCloudProfileBusy(false)
    }
  }

  const postCatalogImport = async (body: Record<string, unknown>): Promise<CatalogImportResponse> => {
    const response = await fetch('/api/admin/catalog-import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return parseFetchJson<CatalogImportResponse>(response, 'Catalog import failed')
  }

  const summarizeCatalogImport = (data: CatalogImportResponse): string => {
    if (data.totals) {
      return `Imported ${data.totals.usernames} username${data.totals.usernames === 1 ? '' : 's'}: ${data.totals.passesUpserted} pass${data.totals.passesUpserted === 1 ? '' : 'es'}, ${data.totals.rowsUpserted} RAX row${data.totals.rowsUpserted === 1 ? '' : 's'} saved to Supabase (${data.totals.passesWithNoEarnings} with no earnings, ${data.totals.failures} failure${data.totals.failures === 1 ? '' : 's'}).`
    }
    return `Imported pass: ${data.passesUpserted ?? 0} pass${data.passesUpserted === 1 ? '' : 'es'}, ${data.rowsUpserted ?? 0} RAX row${data.rowsUpserted === 1 ? '' : 's'} saved to Supabase (${data.passesWithNoEarnings ?? 0} with no earnings, ${(data.failures ?? []).length} failure${(data.failures ?? []).length === 1 ? '' : 's'}).`
  }

  const importSavedUsernames = async () => {
    setCatalogImporting(true)
    setCatalogStatus('Importing saved usernames into Supabase catalog…')
    try {
      const data = await postCatalogImport({
        mode: 'saved-usernames',
        limit: Number(catalogSavedLimit) || 25,
      })
      setCatalogStatus(summarizeCatalogImport(data))
    } catch (error) {
      setCatalogStatus(error instanceof Error ? error.message : 'Catalog import failed.')
    } finally {
      setCatalogImporting(false)
    }
  }

  const importManualUsernames = async () => {
    const usernames = parseAdminUsernames(catalogUsernames)
    if (usernames.length === 0) {
      setCatalogStatus('Enter at least one username.')
      return
    }

    setCatalogImporting(true)
    const aggregated: CatalogImportResponse = {
      ok: true,
      mode: 'usernames',
      totals: {
        usernames: 0,
        passesScanned: 0,
        passesUpserted: 0,
        rowsUpserted: 0,
        passesWithNoEarnings: 0,
        failures: 0,
      },
      usernamesImported: [],
    }

    try {
      for (let index = 0; index < usernames.length; index += 1) {
        const username = usernames[index] ?? ''
        setCatalogStatus(
          `Importing @${username} into Supabase catalog (${index + 1}/${usernames.length})…`,
        )
        const data = await postCatalogImport({ mode: 'usernames', usernames: username })
        const entry = data.usernamesImported?.[0]
        if (entry) {
          aggregated.usernamesImported?.push(entry)
        }
        const totals = data.totals
        if (totals && aggregated.totals) {
          aggregated.totals.usernames += totals.usernames
          aggregated.totals.passesScanned += totals.passesScanned
          aggregated.totals.passesUpserted += totals.passesUpserted
          aggregated.totals.rowsUpserted += totals.rowsUpserted
          aggregated.totals.passesWithNoEarnings += totals.passesWithNoEarnings
          aggregated.totals.failures += totals.failures
        }
      }
      setCatalogStatus(summarizeCatalogImport(aggregated))
    } catch (error) {
      const partial = aggregated.totals
      const partialNote =
        partial && partial.usernames > 0
          ? ` Partial progress saved for ${partial.usernames} username${partial.usernames === 1 ? '' : 's'} before the failure.`
          : ''
      setCatalogStatus(
        (error instanceof Error ? error.message : 'Catalog import failed.') + partialNote,
      )
    } finally {
      setCatalogImporting(false)
    }
  }

  const saveUsernameOwnership = async () => {
    const usernames = parseAdminUsernames(ownershipSaveUsernames)
    if (usernames.length === 0) {
      setOwnershipSaveStatus('Enter at least one username.')
      return
    }

    setOwnershipSaving(true)
    const aggregated: UsernameOwnershipResponse = {
      ok: true,
      usernamesSaved: [],
      totals: {
        usernames: 0,
        passesSaved: 0,
        rowsSaved: 0,
        passesWithNoEarnings: 0,
        failures: 0,
      },
    }

    try {
      for (let index = 0; index < usernames.length; index += 1) {
        const username = usernames[index] ?? ''
        setOwnershipSaveStatus(
          `Fetching passes and daily RAX from Meowbot for @${username} (${index + 1}/${usernames.length})…`,
        )
        const response = await fetch('/api/admin/username-ownership', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: username }),
        })
        const data = await parseFetchJson<UsernameOwnershipResponse>(response, 'Ownership save failed')
        const entry = data.usernamesSaved?.[0]
        if (entry) {
          aggregated.usernamesSaved?.push(entry)
        }
        const totals = data.totals
        if (totals && aggregated.totals) {
          aggregated.totals.usernames += totals.usernames
          aggregated.totals.passesSaved += totals.passesSaved
          aggregated.totals.rowsSaved += totals.rowsSaved
          aggregated.totals.passesWithNoEarnings += totals.passesWithNoEarnings
          aggregated.totals.failures += totals.failures
        }
        if (!data.ok && !entry?.error) {
          throw new Error(`Ownership save failed for @${username}.`)
        }
      }

      const totals = aggregated.totals
      if (!totals) {
        setOwnershipSaveStatus('Ownership save completed.')
        return
      }
      const failed = (aggregated.usernamesSaved ?? []).filter((entry) => entry.error)
      setOwnershipSaveStatus(
        `Saved full Meowbot import for ${totals.usernames} username${totals.usernames === 1 ? '' : 's'} (${totals.passesSaved} pass${totals.passesSaved === 1 ? '' : 'es'}, ${totals.rowsSaved} RAX row${totals.rowsSaved === 1 ? '' : 's'}${totals.passesWithNoEarnings > 0 ? `, ${totals.passesWithNoEarnings} with no earnings` : ''}${totals.failures > 0 ? `, ${totals.failures} pass failure${totals.failures === 1 ? '' : 's'}` : ''}).` +
          (failed.length > 0
            ? ` Errors: ${failed.map((entry) => `@${entry.username}: ${entry.error}`).join('; ')}`
            : ' Users can recover passes and RAX from Entry → Import from admin cached passes.'),
      )
    } catch (error) {
      const partial = aggregated.totals
      const partialNote =
        partial && partial.usernames > 0
          ? ` Partial progress saved for ${partial.usernames} username${partial.usernames === 1 ? '' : 's'} before the failure.`
          : ''
      setOwnershipSaveStatus(
        (error instanceof Error ? error.message : 'Ownership save failed.') + partialNote,
      )
    } finally {
      setOwnershipSaving(false)
      void loadOwnershipSnapshots()
    }
  }

  const importSpecificPass = async () => {
    setCatalogImporting(true)
    setCatalogStatus('Importing specific pass into Supabase catalog…')
    try {
      const data = await postCatalogImport({
        mode: 'pass',
        ...passImport,
        entityId: Number(passImport.entityId),
        seasonYear: Number(passImport.seasonYear),
      })
      setCatalogStatus(summarizeCatalogImport(data))
    } catch (error) {
      setCatalogStatus(error instanceof Error ? error.message : 'Catalog import failed.')
    } finally {
      setCatalogImporting(false)
    }
  }

  const importOtdTable = async () => {
    setCatalogImporting(true)
    setCatalogStatus('Discovering passes from OTD tables and importing daily RAX into Supabase…')
    try {
      const data = await postCatalogImport({
        mode: 'otd-table',
        seasons: otdImport.seasons,
        sport: otdImport.sport || undefined,
        includePlayers: otdImport.includePlayers,
        includeTeams: otdImport.includeTeams,
        maxPasses: Number(otdImport.maxPasses) || 250,
      })
      setCatalogStatus(summarizeCatalogImport(data))
    } catch (error) {
      setCatalogStatus(error instanceof Error ? error.message : 'Catalog import failed.')
    } finally {
      setCatalogImporting(false)
    }
  }

  const loadManualUpsertPass = async (result: CatalogSearchResult, _rarityLabel = '') => {
    setManualUpsertLoadingKey(result.externalKey)
    setManualUpsertStatus('Loading pass from shared catalog…')
    try {
      const { profile, storageConfigured } = await fetchCatalogImportProfile(result.externalKey)
      if (!storageConfigured) {
        setManualUpsertStatus('Shared catalog search is not configured yet.')
        return
      }
      if (!profile) {
        setManualUpsertStatus('That pass was not found in the shared catalog. Try searching again.')
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
        `Loaded ${profile.name} (${profile.rowCount} existing RAX row${profile.rowCount === 1 ? '' : 's'}). Edit the JSON below, then upsert to Supabase without calling Meowbot.`,
      )
    } catch (error) {
      setManualUpsertStatus(error instanceof Error ? error.message : 'Could not load catalog pass.')
    } finally {
      setManualUpsertLoadingKey('')
    }
  }

  const submitManualUpsert = async () => {
    setManualUpsertBusy(true)
    setManualUpsertStatus('Saving manual catalog override to Supabase…')
    try {
      const data = await postCatalogImport({
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
      })
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

  return (
    <div className="page-stack admin-page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Operator</p>
          <h2>Admin</h2>
          <p>
            Import activity reported from authenticated browsers. Use this to diagnose
            realapp.tools passes that return no daily earnings.
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
        title="Shared Meowbot catalog imports"
        description="Seed Supabase, save username ownership failsafes, or override bad RAX"
        defaultOpen
      >
        <section className="import-hint">
          <p>
            No known Meowbot action in this codebase enumerates every pass globally. These tools use
            the reliable user/pass-specific Meowbot requests and save the results to Supabase for
            future Entry search.
          </p>
        </section>
        <div className="form-grid">
          <label className="field">
            <span>Saved usernames limit</span>
            <input
              type="number"
              min="1"
              max="50"
              value={catalogSavedLimit}
              disabled={catalogImporting}
              onChange={(event) => setCatalogSavedLimit(event.target.value)}
            />
          </label>
          <div className="field">
            <span>Saved usernames</span>
            <button
              className="button primary"
              type="button"
              disabled={catalogImporting}
              onClick={() => void importSavedUsernames()}
            >
              Import saved usernames
            </button>
          </div>
        </div>
        <label className="field">
          <span>Manual usernames</span>
          <textarea
            className="bulk-import-textarea"
            value={catalogUsernames}
            placeholder="@user1, @user2, @user3"
            disabled={catalogImporting}
            onChange={(event) => setCatalogUsernames(event.target.value)}
          />
        </label>
        <div className="button-row">
          <button
            className="button"
            type="button"
            disabled={catalogImporting || catalogUsernames.trim().length === 0}
            onClick={() => void importManualUsernames()}
          >
            Import manual usernames
          </button>
        </div>

        <div className="form-subsection">
          <div className="section-heading">
            <div>
              <h3>Username import failsafe</h3>
              <p className="subsection-note">
                Full Meowbot import for @username: resolves passes, fetches daily RAX, and saves
                everything to the ownership cache. Large collections import one username at a time
                and may take several minutes each. Users recover passes and earnings from Entry →
                Import from admin cached passes after Meowbot shuts down.
              </p>
            </div>
          </div>
          <label className="field">
            <span>Usernames to save</span>
            <textarea
              className="bulk-import-textarea"
              value={ownershipSaveUsernames}
              placeholder="@friend, @anotheruser"
              disabled={ownershipSaving || catalogImporting}
              onChange={(event) => setOwnershipSaveUsernames(event.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              className="button primary"
              type="button"
              disabled={
                ownershipSaving ||
                catalogImporting ||
                ownershipSaveUsernames.trim().length === 0
              }
              onClick={() => void saveUsernameOwnership()}
            >
              {ownershipSaving ? 'Importing from Meowbot…' : 'Import username from Meowbot'}
            </button>
          </div>
          {ownershipSaveStatus ? <p className="import-status">{ownershipSaveStatus}</p> : null}
        </div>

        <div className="form-subsection">
          <div className="section-heading">
            <div>
              <h3>Cached ownership snapshots</h3>
              <p className="subsection-note">
                All usernames currently saved in the ownership KV cache. Re-import a username after
                code fixes to refresh its snapshot.
              </p>
            </div>
            <button
              className="button"
              type="button"
              disabled={ownershipSnapshotsLoading || ownershipSaving}
              onClick={() => void loadOwnershipSnapshots()}
            >
              {ownershipSnapshotsLoading ? 'Refreshing…' : 'Refresh list'}
            </button>
          </div>
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
        </div>

        <div className="form-subsection">
          <div className="section-heading">
            <div>
              <h3>OTD table discovery import</h3>
              <p className="subsection-note">
                Uses realapp.tools OTD table endpoints to discover many player/team passes by
                season, then fetches daily earnings for each discovered pass.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Seasons</span>
              <input
                value={otdImport.seasons}
                placeholder="2026,2025,2024"
                disabled={catalogImporting}
                onChange={(event) =>
                  setOtdImport((current) => ({ ...current, seasons: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Sport filter</span>
              <input
                value={otdImport.sport}
                placeholder="Optional, e.g. NBA or mlb"
                disabled={catalogImporting}
                onChange={(event) =>
                  setOtdImport((current) => ({ ...current, sport: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Max passes this run</span>
              <input
                type="number"
                min="1"
                max="1000"
                value={otdImport.maxPasses}
                disabled={catalogImporting}
                onChange={(event) =>
                  setOtdImport((current) => ({ ...current, maxPasses: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="button-row">
            <label className="inline-toggle">
              <input
                type="checkbox"
                checked={otdImport.includePlayers}
                disabled={catalogImporting}
                onChange={(event) =>
                  setOtdImport((current) => ({
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
                checked={otdImport.includeTeams}
                disabled={catalogImporting}
                onChange={(event) =>
                  setOtdImport((current) => ({
                    ...current,
                    includeTeams: event.target.checked,
                  }))
                }
              />
              Teams
            </label>
            <button
              className="button"
              type="button"
              disabled={
                catalogImporting ||
                (!otdImport.includePlayers && !otdImport.includeTeams) ||
                otdImport.seasons.trim().length === 0
              }
              onClick={() => void importOtdTable()}
            >
              Import from OTD tables
            </button>
          </div>
        </div>

        <div className="form-subsection">
          <div className="section-heading">
            <div>
              <h3>Specific pass import</h3>
              <p className="subsection-note">
                Use this when you know the player/team entity ID, season year, and sport.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Entity ID</span>
              <input
                value={passImport.entityId}
                placeholder="100"
                disabled={catalogImporting}
                onChange={(event) =>
                  setPassImport((current) => ({ ...current, entityId: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Season year</span>
              <input
                value={passImport.seasonYear}
                placeholder="2026"
                disabled={catalogImporting}
                onChange={(event) =>
                  setPassImport((current) => ({ ...current, seasonYear: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Sport</span>
              <input
                value={passImport.sport}
                placeholder="NBA"
                disabled={catalogImporting}
                onChange={(event) =>
                  setPassImport((current) => ({ ...current, sport: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Pass type</span>
              <select
                value={passImport.passKind}
                disabled={catalogImporting}
                onChange={(event) =>
                  setPassImport((current) => ({
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
          <div className="form-grid">
            <label className="field">
              <span>Name override</span>
              <input
                value={passImport.name}
                placeholder="Optional"
                disabled={catalogImporting}
                onChange={(event) =>
                  setPassImport((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Rarity</span>
              <input
                value={passImport.rarityLabel}
                placeholder="Optional"
                disabled={catalogImporting}
                onChange={(event) =>
                  setPassImport((current) => ({ ...current, rarityLabel: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Season label</span>
              <input
                value={passImport.seasonLabel}
                placeholder="Optional, e.g. 2025-26"
                disabled={catalogImporting}
                onChange={(event) =>
                  setPassImport((current) => ({ ...current, seasonLabel: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="button"
              type="button"
              disabled={
                catalogImporting ||
                !passImport.entityId.trim() ||
                !passImport.seasonYear.trim() ||
                !passImport.sport.trim()
              }
              onClick={() => void importSpecificPass()}
            >
              Import specific pass
            </button>
          </div>
        </div>

        <div className="form-subsection">
          <div className="section-heading">
            <div>
              <h3>Manual catalog override</h3>
              <p className="subsection-note">
                Fix incorrect Meowbot earnings by loading an existing pass from the shared catalog,
                editing its JSON (paste from realapp.com if needed), and upserting directly to
                Supabase without calling Meowbot.
              </p>
            </div>
          </div>

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
            <label className="field">
              <span>Pass type</span>
              <select
                value={manualUpsert.passKind}
                disabled={manualUpsertBusy}
                onChange={(event) =>
                  setManualUpsert((current) => ({
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
        </div>
        {catalogStatus ? <p className="import-status">{catalogStatus}</p> : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Account management"
        description="Reset a forgotten password or delete a user's account backup"
        defaultOpen
      >
        <p className="import-hint">
          Accounts are keyed by Real @username. Passwords are stored as hashes — admins cannot read
          the old password. Reset keeps their account data and sets a new password you share
          privately. Delete removes the account copy so they can register fresh with a new password.
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
              placeholder="Temporary password for the user"
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
        </div>
        {cloudProfileStatus ? <p className="import-status">{cloudProfileStatus}</p> : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Ownership snapshot lookup"
        description="Verify fallback import availability for a username"
        defaultOpen
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
        </div>
        {ownershipLookupStatus ? <p className="import-status">{ownershipLookupStatus}</p> : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Real usernames seen"
        description={`${summary.userCount} username${summary.userCount === 1 ? '' : 's'} · ${summary.noEarnings} no-earnings event${summary.noEarnings === 1 ? '' : 's'}`}
        defaultOpen
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
        defaultOpen
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
          <label className="field inline-field">
            <span>Type</span>
            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as 'all' | AdminEvent['type'])
              }
            >
              <option value="all">All types</option>
              {ADMIN_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
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
