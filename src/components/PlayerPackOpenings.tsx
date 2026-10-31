import type { PackTrackerAccount } from '../types/rax'
import { openingStatus } from '../lib/dailyPacks'

export function PackOpeningBadge({ account, now }: { account: PackTrackerAccount; now: Date }) {
  const username = (account.username || '').replace(/^@/, '').trim().toLowerCase()
  const status = !account.opensPacks || account.ownershipStatus === 'missing' || !username ? 'excluded' : openingStatus(account.packObservation, username, now)
  const label = !account.opensPacks ? 'Not opening' : account.ownershipStatus === 'missing' ? 'Missing pass' : !username ? 'No username' : status === 'likely-opened' ? 'Likely opened' : status === 'not-detected' ? 'No opening detected' : 'Unknown'
  return <span className={`daily-badge ${status}`} data-status={status} title={account.packObservation ? `Last reading: ${new Date(account.packObservation.lastCheckedAt).toLocaleString()}. Rating transfers can also suggest an opening.` : 'Sync account ratings to establish a baseline.'}>{label}</span>
}

export function PlayerPackOpenings({ player, accounts, now, expanded = false }: {
  player: string; accounts: PackTrackerAccount[]; now: Date; expanded?: boolean
}) {
  const rows = accounts.filter(account => account.opensPacks)
  if (!rows.length) return null
  const username = (account: PackTrackerAccount) => (account.username || '').replace(/^@/, '').trim().toLowerCase()
  const eligible = rows.filter(account => username(account) && account.ownershipStatus !== 'missing')
  const opened = eligible.filter(account => openingStatus(account.packObservation, username(account), now) === 'likely-opened').length
  const visible = expanded ? rows : rows.slice(0, 3)
  return <div className="pack-player-openings" aria-label={`Today’s openings for ${player}`}>
    <div className="pack-player-openings-heading"><strong>Today’s openings</strong><span>{opened} / {eligible.length} likely opened</span></div>
    <div className="pack-player-opening-accounts">{visible.map(account => {
      const user = username(account)
      return <div className="pack-player-opening-account" key={account.id}>
        <span className="pack-opening-account-name" title={`@${user}`}>{account.name || user}</span>
        <PackOpeningBadge account={account} now={now} />
      </div>
    })}{rows.length > visible.length ? <span className="pack-opening-more">+{rows.length - visible.length} more accounts · expand player</span> : null}</div>
  </div>
}
