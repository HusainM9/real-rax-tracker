import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { useAdminAuth } from '../context/AdminAuthContext'
import { ADMIN_EVENT_TYPES, type AdminEvent, type AdminUserSummary } from '../../lib/adminEventTypes'

type EventsResponse = {
  events: AdminEvent[]
  total: number
  storageConfigured: boolean
}

type UsersResponse = {
  users: AdminUserSummary[]
  storageConfigured: boolean
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

  const summary = useMemo(() => {
    const noEarnings = users.reduce((sum, user) => sum + user.passNoEarningsCount, 0)
    return {
      userCount: users.length,
      noEarnings,
    }
  }, [users])

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
