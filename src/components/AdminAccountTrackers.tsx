import { useCallback, useEffect, useState } from 'react'
import CollapsiblePanel from './CollapsiblePanel'
import {
  formatProjectedFinishDate,
  ICONIC_RATING_TARGET,
  normalizePackUsername,
  summarizeAccountAcrossPacks,
  type AccountPackTrackerRow,
} from '../lib/packTracker'
import type { PackAccountTemplate, PackTracker, PlannedPass } from '../types/rax'

export type AdminAccountSummary = {
  username: string
  updatedAt: string
  cardCount: number
  performanceCount: number
}

type PackSnapshotResponse = {
  profile: AdminAccountSummary | null
  packs: {
    plannedPasses: PlannedPass[]
    packTrackers: PackTracker[]
    packAccountTemplates: PackAccountTemplate[]
  } | null
  storageConfigured: boolean
  error?: string
}

type AccountPackDetail = {
  rows: AccountPackTrackerRow[]
  templates: PackAccountTemplate[]
  trackedPassCount: number
  atTargetCount: number
  status: string
  loading: boolean
}

function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'Done'
  if (days === 1) return '1 day'
  return `${days} days`
}

function AccountTrackerRow({
  account,
  detail,
  onOpen,
}: {
  account: AdminAccountSummary
  detail: AccountPackDetail | undefined
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const username = normalizePackUsername(account.username)
  const summary = [
    `${account.cardCount} card${account.cardCount === 1 ? '' : 's'}`,
    `${account.performanceCount} earnings row${account.performanceCount === 1 ? '' : 's'}`,
    `updated ${new Date(account.updatedAt).toLocaleString()}`,
  ].join(' · ')

  return (
    <CollapsiblePanel
      className="nested-panel admin-account-tracker-row"
      title={`@${username}`}
      description={summary}
      defaultOpen={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) onOpen()
      }}
      badge={
        detail && !detail.loading && detail.trackedPassCount > 0
          ? `${detail.atTargetCount}/${detail.trackedPassCount} Iconic`
          : undefined
      }
    >
      {detail?.loading ? <p className="import-status">Loading pack tracker…</p> : null}
      {detail && !detail.loading && detail.status ? (
        <p className="import-status">{detail.status}</p>
      ) : null}

      {detail && !detail.loading && detail.templates.length > 0 ? (
        <div className="admin-account-tracker-templates">
          <p className="subsection-note">
            Shared pack accounts ({detail.templates.length}):{' '}
            {detail.templates
              .map((template) => {
                const name = template.name.trim() || normalizePackUsername(template.username)
                const handle = normalizePackUsername(template.username)
                return handle ? `${name} (@${handle})` : name
              })
              .filter(Boolean)
              .join(', ')}
          </p>
        </div>
      ) : null}

      {detail && !detail.loading && detail.rows.length === 0 ? (
        <p className="import-hint">
          No pack trackers yet for @{username}. After they track player packs on Packs, ratings for
          this account appear here.
        </p>
      ) : null}

      {detail && !detail.loading && detail.rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pass</th>
                <th>Account rating</th>
                <th>Tracker total</th>
                <th>Days left</th>
                <th>Finish</th>
                <th>Opens</th>
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row) => (
                <tr key={`${row.plannedPassId}:${username}`}>
                  <td>
                    {row.passName}
                    <br />
                    <small className="table-sub">
                      {row.sport} · {row.season}
                      {row.rarityLabel ? ` · ${row.rarityLabel}` : ''}
                      {row.ownershipStatus === 'missing' && !row.ignoredMissing
                        ? ' · missing ownership'
                        : ''}
                    </small>
                  </td>
                  <td>{row.accountRating.toLocaleString()}</td>
                  <td>
                    {row.trackerTotal.toLocaleString()} / {ICONIC_RATING_TARGET.toLocaleString()}
                    {row.atTarget ? (
                      <>
                        <br />
                        <small className="table-sub">Iconic</small>
                      </>
                    ) : null}
                  </td>
                  <td>{formatDays(row.daysRemaining)}</td>
                  <td>
                    <strong>{formatProjectedFinishDate(row.daysRemaining)}</strong>
                  </td>
                  <td>{row.opensPacks ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </CollapsiblePanel>
  )
}

export default function AdminAccountTrackers({
  refreshKey = 0,
}: {
  /** Bump after delete/reset so the list reloads. */
  refreshKey?: number
}) {
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailsByUsername, setDetailsByUsername] = useState<Record<string, AccountPackDetail>>({})

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/tracker-profile?list=1', {
        credentials: 'include',
      })
      const body = (await response.json()) as {
        profiles?: AdminAccountSummary[]
        storageConfigured?: boolean
        error?: string
      }
      if (!response.ok) {
        throw new Error(body.error || `Could not list accounts (${response.status}).`)
      }
      setAccounts(body.profiles ?? [])
      setDetailsByUsername({})
    } catch (loadError) {
      setAccounts([])
      setDetailsByUsername({})
      setError(loadError instanceof Error ? loadError.message : 'Could not list accounts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts, refreshKey])

  const loadPackDetail = async (username: string) => {
    const key = username.toLowerCase()
    setDetailsByUsername((current) => ({
      ...current,
      [key]: {
        rows: current[key]?.rows ?? [],
        templates: current[key]?.templates ?? [],
        trackedPassCount: current[key]?.trackedPassCount ?? 0,
        atTargetCount: current[key]?.atTargetCount ?? 0,
        status: '',
        loading: true,
      },
    }))

    try {
      const response = await fetch(
        `/api/admin/tracker-profile?username=${encodeURIComponent(username)}&packs=1`,
        { credentials: 'include' },
      )
      const body = (await response.json()) as PackSnapshotResponse
      if (!response.ok) {
        throw new Error(body.error || `Pack lookup failed (${response.status}).`)
      }
      if (!body.profile || !body.packs) {
        setDetailsByUsername((current) => ({
          ...current,
          [key]: {
            rows: [],
            templates: [],
            trackedPassCount: 0,
            atTargetCount: 0,
            status: `No account data found for @${username}.`,
            loading: false,
          },
        }))
        return
      }

      const rows = summarizeAccountAcrossPacks(
        body.profile.username,
        body.packs.plannedPasses ?? [],
        body.packs.packTrackers ?? [],
      )
      const atTargetCount = rows.filter((row) => row.atTarget).length

      setDetailsByUsername((current) => ({
        ...current,
        [key]: {
          rows,
          templates: body.packs?.packAccountTemplates ?? [],
          trackedPassCount: rows.length,
          atTargetCount,
          status:
            rows.length > 0
              ? `${rows.length} tracked pass${rows.length === 1 ? '' : 'es'} for @${body.profile?.username}.`
              : '',
          loading: false,
        },
      }))
    } catch (loadError) {
      setDetailsByUsername((current) => ({
        ...current,
        [key]: {
          rows: [],
          templates: [],
          trackedPassCount: 0,
          atTargetCount: 0,
          status: loadError instanceof Error ? loadError.message : 'Could not load pack tracker.',
          loading: false,
        },
      }))
    }
  }

  return (
    <CollapsiblePanel
      title="Account trackers"
      description={`${accounts.length} registered account${accounts.length === 1 ? '' : 's'} · pack rating progress per account`}
      defaultOpen={false}
      badge={accounts.length > 0 ? String(accounts.length) : undefined}
      actions={
        <button
          className="button compact"
          type="button"
          disabled={loading}
          onClick={() => void loadAccounts()}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      <p className="import-hint">
        Every created tracker account appears here. Expand a row to see that account&apos;s pack
        ratings across tracked passes (same Iconic target as Packs:{' '}
        {ICONIC_RATING_TARGET.toLocaleString()}). New accounts are seeded with a shared pack-account
        template matching their @username.
      </p>

      {error ? <p className="import-status import-status-error">{error}</p> : null}

      {!loading && accounts.length === 0 && !error ? (
        <p className="empty">No accounts created yet.</p>
      ) : null}

      <div className="admin-account-tracker-list">
        {accounts.map((account) => (
          <AccountTrackerRow
            key={account.username}
            account={account}
            detail={detailsByUsername[account.username.toLowerCase()]}
            onOpen={() => {
              const key = account.username.toLowerCase()
              if (detailsByUsername[key]) return
              void loadPackDetail(account.username)
            }}
          />
        ))}
      </div>
    </CollapsiblePanel>
  )
}
