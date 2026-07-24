import { Link } from 'react-router-dom'
import { realProviderImportEnabled } from '../lib/importShutdown'

export default function HelpPage() {
  const realImportActive = realProviderImportEnabled()

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Guide</p>
          <h2>How this tracker works</h2>
          <p>Plan OTD claims before overlaps waste RAX. Data stays in this browser unless you export or sync.</p>
        </div>
        <Link className="button primary" to="/entry">
          Import or add cards
        </Link>
      </section>

      <section className="panel help-section">
        <h2>What is RAX On This Day?</h2>
        <p>
          Each calendar day you can claim player cards for RAX based on historical performances on
          that same month/day.
        </p>
        <ul className="help-list">
          <li>
            <strong>Guaranteed</strong> — top two player cards per sport per day.
          </li>
          <li>
            <strong>Overlap</strong> — third-or-later same sport/day; not claimable.
          </li>
          <li>
            <strong>Pro bonus</strong> — optional third claim across sports (Dashboard toggle).
          </li>
        </ul>
      </section>

      <section className="panel help-section">
        <h2>Getting your data in</h2>
        <ol className="help-list ordered">
          {realImportActive ? (
            <li>
              <strong>Username import</strong> (Entry, primary) — Real @username recovers Legendary+
              passes; daily RAX may load in stages.
            </li>
          ) : (
            <li>
              <strong>Username import</strong> — closed. Use Quick add, Manual add, or a backup.
            </li>
          )}
          <li>
            <strong>Quick add</strong> — catalog search on Entry for one-off passes.
          </li>
          <li>
            <strong>Manual add</strong> — paste daily RAX JSON or enter a single day.
          </li>
        </ol>
      </section>

      <section className="panel help-section">
        <h2>Manual earnings JSON</h2>
        <p>
          When daily rows are missing, paste JSON from{' '}
          <a href="https://www.realapp.com" target="_blank" rel="noreferrer">
            realapp.com
          </a>{' '}
          (desktop, Real Pro).
        </p>
        <details className="help-details">
          <summary>How to copy earnings JSON</summary>
          <ol className="help-list ordered">
            <li>
              Open{' '}
              <a href="https://www.realapp.com" target="_blank" rel="noreferrer">
                realapp.com
              </a>{' '}
              and log in.
            </li>
            <li>
              DevTools (<kbd>F12</kbd>) → <strong>Network</strong> before loading earnings.
            </li>
            <li>
              Open the player season and click the <strong>RAX icon</strong> on a performance.
            </li>
            <li>
              Filter for <code>userpassearnings</code>, copy the Response JSON.
            </li>
            <li>
              On <Link to="/entry">Entry</Link> → <strong>Manual add</strong>, paste and save.
            </li>
          </ol>
          <p className="import-hint">
            Older <code>rows</code> JSON still works. Pastes also save under Saved earnings profiles.
          </p>
        </details>
      </section>

      <section className="panel help-section">
        <h2>Saved earnings profiles</h2>
        <p>
          Pasted or imported earnings auto-save per player. Re-import replaces earnings on imported
          passes but keeps saved profiles.
        </p>
        <ul className="help-list">
          <li>
            <strong>Restore</strong> — re-applies saved RAX onto the matching pass.
          </li>
          <li>
            <strong>JSON</strong> — fills the paste box without importing yet.
          </li>
        </ul>
      </section>

      <section className="panel help-section">
        <h2>Pages at a glance</h2>
        <dl className="help-dl">
          <div>
            <dt>Dashboard</dt>
            <dd>Totals, best days, JSON backup; optional cloud sync for devices.</dd>
          </div>
          <div>
            <dt>Entry</dt>
            <dd>Username import (primary), Quick add, Manual add, edit RAX.</dd>
          </div>
          <div>
            <dt>Calendar</dt>
            <dd>Month/day OTD view.</dd>
          </div>
          <div>
            <dt>Overlaps</dt>
            <dd>Days and cards wasting RAX.</dd>
          </div>
          <div>
            <dt>Potential</dt>
            <dd>Rank catalog, Check one pass, collection what-ifs.</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>Catalog passes you are considering before buying.</dd>
          </div>
          <div>
            <dt>Cards</dt>
            <dd>Per-card totals, sorting, rarity edits.</dd>
          </div>
          <div>
            <dt>If sold</dt>
            <dd>Lost vs freed claimable RAX if you sell a pass.</dd>
          </div>
        </dl>
      </section>

      <section className="panel help-section">
        <h2>OTD dates &amp; rarity</h2>
        <p>
          Rules apply per month/day across years. Each card uses its best performance that day.
          Change rarity on Cards or Entry after a merge — earnings recalculate and save with your
          collection.
        </p>
      </section>

      <section className="panel help-section">
        <h2>Backup and privacy</h2>
        <p>
          Data lives in browser localStorage. Export JSON on Dashboard, or use optional cloud sync
          there. Collection recovery is username import on Entry. Clearing site data removes the
          tracker.
        </p>
        <details className="help-details">
          <summary>Privacy notes</summary>
          <ul className="help-list">
            <li>
              <strong>Exports</strong> — plain JSON with username, cards, and RAX. Do not share
              publicly.
            </li>
            <li>
              <strong>Device access</strong> — anyone with this browser or an unlocked export can
              read your data.
            </li>
            <li>
              <strong>Site password</strong> — gates the app URL only; each browser keeps its own
              collection.
            </li>
            <li>
              <strong>Operator cache</strong> — imports may report a minimal username/pass snapshot.
              Notes and full backups are not uploaded.
            </li>
          </ul>
        </details>
      </section>
    </div>
  )
}
