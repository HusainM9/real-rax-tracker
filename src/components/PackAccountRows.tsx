import type { PackTrackerAccount } from '../types/rax'
import { normalizePackUsername } from '../lib/packTracker'
import { openingStatus } from '../lib/dailyPacks'
import { PackOpeningBadge } from './PlayerPackOpenings'

type Props = {
  player: string
  accounts: PackTrackerAccount[]
  now: Date
  weeklyOnly: boolean
  showOpenings: boolean
  busy: boolean
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<Pick<PackTrackerAccount, 'name' | 'username' | 'rating' | 'opensPacks'>>) => void
  onImport: (account: PackTrackerAccount) => void
  onRemove: (id: string) => void
  onIgnoreMissing: (id: string) => void
}

export function PackAccountRows({ player, accounts, now, weeklyOnly, showOpenings, busy, onAdd, onUpdate, onImport, onRemove, onIgnoreMissing }: Props) {
  const eligible = accounts.filter(account => account.opensPacks && normalizePackUsername(account.username) && account.ownershipStatus !== 'missing')
  const opened = eligible.filter(account => openingStatus(account.packObservation, account.username!, now) === 'likely-opened').length
  return <section className="pack-compact-accounts" aria-label={`Accounts for ${player}`}>
    <div className="pack-accounts-header"><h4>Accounts {showOpenings ? <small>{opened} / {eligible.length} likely opened today</small> : null}</h4><button type="button" className="button compact" disabled={busy} onClick={onAdd}>Add account</button></div>
    {!accounts.length ? <p className="import-hint">No accounts yet. Add one to start tracking.</p> : accounts.map(account => {
      const username = normalizePackUsername(account.username)
      const label = account.name || username || 'Account'
      const missing = account.ownershipStatus === 'missing' && !account.ignoredMissing
      return <div className={`pack-compact-account${missing ? ' is-missing' : ''}`} key={account.id}>
        <div className="pack-compact-account-identity">
          <strong title={username ? `@${username}` : 'Add a Real username in Edit'}>{username ? `@${username}` : label}</strong>
          {account.name && username && account.name.toLowerCase() !== username.toLowerCase() ? <small>{account.name}</small> : null}
          {account.rarityLabel || account.lastImportedAt ? <small title={account.lastImportedAt ? new Date(account.lastImportedAt).toLocaleString() : undefined}>{account.rarityLabel}{account.rarityLabel && account.lastImportedAt ? ' · ' : ''}{account.lastImportedAt ? <>Read <time dateTime={account.lastImportedAt}>{new Date(account.lastImportedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></> : null}</small> : <small>No reading yet</small>}
          {missing ? <button className="link-button" type="button" disabled={busy} onClick={() => onIgnoreMissing(account.id)}>Ignore missing</button> : null}
        </div>
        <label className="pack-compact-account-rating"><span>Rating</span><input type="number" min={0} step={1} value={account.rating} disabled={busy} aria-label={`Rating for ${label} on ${player}`} onChange={event => onUpdate(account.id, { rating: Number(event.target.value) })} /></label>
        <div className="pack-compact-account-status">{showOpenings ? <PackOpeningBadge account={account} now={now} /> : <small>{weeklyOnly ? 'Weekly pack' : 'Target reached'}</small>}</div>
        <label className="pack-opens-toggle"><input type="checkbox" checked={account.opensPacks} disabled={busy} aria-label={`${weeklyOnly ? 'Opens weekly pack' : 'Opens packs'} for ${label} on ${player}`} onChange={event => onUpdate(account.id, { opensPacks: event.target.checked })} /><span>Opens</span></label>
        <button className="button compact" type="button" disabled={busy || !username} aria-label={`Import ${label} for ${player}`} onClick={() => onImport(account)}>Import</button>
        <details className="pack-account-edit">
          <summary>Edit<span className="sr-only"> {label} on {player}</span></summary>
          <div className="pack-account-edit-fields">
            <label><span>Name</span><input value={account.name} disabled={busy} aria-label={`Account name for ${label} on ${player}`} onChange={event => onUpdate(account.id, { name: event.target.value })} /></label>
            <label><span>Real username</span><input value={account.username || ''} disabled={busy} placeholder="@username" aria-label={`Real username for ${label} on ${player}`} onChange={event => onUpdate(account.id, { username: event.target.value })} /></label>
            <button className="button danger compact" type="button" disabled={busy || accounts.length <= 1} aria-label={`Remove ${label} from ${player}`} onClick={() => onRemove(account.id)}>Remove account</button>
          </div>
        </details>
      </div>
    })}
  </section>
}
