import type { PackTrackerAccount } from '../types/rax'
import { openingStatus } from '../lib/dailyPacks'
import { AccountAvatar } from './AccountAvatar'

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
      const status = account.ownershipStatus === 'missing' || !user ? 'excluded' : openingStatus(account.packObservation, user, now)
      const label = account.ownershipStatus === 'missing' ? 'Missing pass' : !user ? 'No username' : status === 'likely-opened' ? 'Likely opened' : status === 'not-detected' ? 'No opening detected' : 'Unknown'
      return <div className="pack-player-opening-account" key={account.id}>
        <AccountAvatar username={user} profile={account.realProfile} />
        <span className="pack-opening-account-name" title={`@${user}`}>{account.name || user}</span>
        <span className={`daily-badge ${status}`} data-status={status} title={account.packObservation ? `Last reading: ${new Date(account.packObservation.lastCheckedAt).toLocaleString()}. Rating transfers can also suggest an opening.` : 'Sync account ratings to establish a baseline.'}>{label}</span>
      </div>
    })}{rows.length > visible.length ? <span className="pack-opening-more">+{rows.length - visible.length} more accounts · expand player</span> : null}</div>
  </div>
}
