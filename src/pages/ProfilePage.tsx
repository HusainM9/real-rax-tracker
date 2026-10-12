import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PassIdentity } from '../components/PassIdentity'
import { useAccountAuth } from '../context/AccountAuthContext'
import { useRaxData } from '../context/RaxDataContext'
import { displayRaxValue } from '../lib/displayRax'
import { formatRax } from '../lib/format'
import { buildProfileSnapshot } from '../lib/profileStats'

function initials(username: string): string {
  const clean = username.replace(/[^a-z0-9]/gi, '')
  return (clean.slice(0, 2) || '??').toUpperCase()
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-stat-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default function ProfilePage() {
  const { username } = useAccountAuth()
  const { data } = useRaxData()
  const snapshot = useMemo(
    () => buildProfileSnapshot(data, username || data.settings.savedUsername || 'collector'),
    [data, username],
  )

  return (
    <div className="page-stack profile-page">
      <section className="profile-hero">
        <div className="profile-hero-glow" aria-hidden="true" />
        <div className="profile-hero-inner">
          <div className="profile-avatar" aria-hidden="true">
            {initials(snapshot.username)}
          </div>
          <div className="profile-hero-copy">
            <p className="eyebrow">Collector profile</p>
            <h1>@{snapshot.username}</h1>
            <p className="profile-title">{snapshot.title}</p>
            <p className="profile-blurb">{snapshot.blurb}</p>
          </div>
          <div className="profile-hero-actions">
            <Link className="profile-earnings-cta" to="/marketplace">
              <span>Marketplace</span>
              <strong>Listing alerts →</strong>
            </Link>
            <Link className="profile-earnings-cta" to="/earnings">
              <span>Daily RAX</span>
              <strong>View earnings →</strong>
            </Link>
          </div>
        </div>
        <div className="profile-hero-stats">
          <StatPill label="Passes" value={String(snapshot.cardCount)} />
          <StatPill
            label="Claimable"
            value={formatRax(displayRaxValue(snapshot.claimableRax))}
          />
          <StatPill label="Claim days" value={String(snapshot.claimDays)} />
          <StatPill label="Efficiency" value={`${snapshot.efficiencyPct}%`} />
        </div>
      </section>

      <section className="profile-grid">
        <div className="panel profile-panel profile-efficiency">
          <div className="section-heading">
            <div>
              <h2>Claim efficiency</h2>
              <p>How much of your entered RAX still lands as claimable.</p>
            </div>
          </div>
          <div
            className="profile-meter"
            role="img"
            aria-label={`Claim efficiency ${snapshot.efficiencyPct} percent`}
          >
            <div
              className="profile-meter-fill"
              style={{ width: `${Math.min(100, Math.max(0, snapshot.efficiencyPct))}%` }}
            />
          </div>
          <div className="profile-meter-legend">
            <span>
              Claimable <strong>{formatRax(displayRaxValue(snapshot.claimableRax))}</strong>
            </span>
            <span>
              Overlapped <strong>{formatRax(displayRaxValue(snapshot.overlapRax))}</strong>
            </span>
          </div>
          <p className="import-hint">
            Best day so far: <strong>{snapshot.bestDayLabel}</strong>
            {snapshot.bestDayRax > 0
              ? ` · ${formatRax(displayRaxValue(snapshot.bestDayRax))} RAX`
              : ''}
          </p>
        </div>

        <div className="panel profile-panel">
          <div className="section-heading">
            <div>
              <h2>Collection mix</h2>
              <p>Players, teams, and what’s on deck.</p>
            </div>
          </div>
          <ul className="profile-mix-list">
            <li>
              <span>Player passes</span>
              <strong>{snapshot.playerPassCount}</strong>
            </li>
            <li>
              <span>Team passes</span>
              <strong>{snapshot.teamPassCount}</strong>
            </li>
            <li>
              <span>Earnings rows</span>
              <strong>{snapshot.earningsRows}</strong>
            </li>
            <li>
              <span>Planned buys</span>
              <strong>{snapshot.plannedPasses}</strong>
            </li>
            <li>
              <span>Pack trackers</span>
              <strong>{snapshot.packTrackers}</strong>
            </li>
          </ul>
        </div>
      </section>

      <section className="profile-grid">
        <div className="panel profile-panel">
          <div className="section-heading">
            <div>
              <h2>Sports</h2>
              <p>Where your claimable RAX concentrates.</p>
            </div>
            <Link to="/cards">Cards</Link>
          </div>
          {snapshot.sports.length === 0 ? (
            <p className="empty">
              No sports yet. <Link to="/entry">Import a collection</Link>.
            </p>
          ) : (
            <div className="profile-bars">
              {snapshot.sports.map((row, index) => (
                <div className="profile-bar-row" key={row.sport} style={{ ['--i' as string]: index }}>
                  <div className="profile-bar-label">
                    <span>{row.sport}</span>
                    <small>
                      {row.cardCount} pass{row.cardCount === 1 ? '' : 'es'} ·{' '}
                      {formatRax(displayRaxValue(row.claimableRax))} RAX
                    </small>
                  </div>
                  <div className="profile-bar-track">
                    <div
                      className="profile-bar-fill"
                      style={{
                        width: `${Math.max(6, Math.round(row.share * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel profile-panel">
          <div className="section-heading">
            <div>
              <h2>Rarity spread</h2>
              <p>What tiers you’re actually holding.</p>
            </div>
          </div>
          {snapshot.rarities.length === 0 ? (
            <p className="empty">Rarity shows up after you import or set pass rarities.</p>
          ) : (
            <div className="profile-rarity-cloud">
              {snapshot.rarities.map((row, index) => (
                <span
                  key={row.label}
                  className="profile-rarity-chip"
                  style={{ ['--i' as string]: index }}
                >
                  {row.label} <strong>{row.count}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel profile-panel">
        <div className="section-heading">
          <div>
            <h2>Top claim engines</h2>
            <p>Passes carrying the most claimable RAX.</p>
          </div>
          <Link to="/calendar">Calendar</Link>
        </div>
        {snapshot.topCards.length === 0 ? (
          <p className="empty">Add earnings and your MVPs will show here.</p>
        ) : (
          <div className="list">
            {snapshot.topCards.map((card, index) => (
              <div className="list-row profile-top-row" key={card.id} style={{ ['--i' as string]: index }}>
                <PassIdentity
                  name={card.name}
                  passKind={card.passKind === 'team' ? 'team' : 'player'}
                  sport={card.sport}
                  avatar={card.avatar}
                  meta={
                    <>
                      {card.sport}
                      {card.rarityLabel ? ` · ${card.rarityLabel}` : ''}
                    </>
                  }
                />
                <b>{formatRax(displayRaxValue(card.claimableRax))} RAX</b>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="profile-actions button-row">
        <Link className="button primary" to="/entry">
          Refresh collection
        </Link>
        <Link className="button" to="/overlaps">
          Hunt overlaps
        </Link>
        <Link className="button" to="/plan">
          Open plan
        </Link>
      </section>
    </div>
  )
}
