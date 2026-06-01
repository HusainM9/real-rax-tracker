import { Link } from 'react-router-dom'

export default function HelpPage() {
  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Guide</p>
          <h2>How this tracker works</h2>
          <p>
            Plan Real Sports RAX On This Day claims before overlaps waste earnings. Everything
            stays in your browser unless you export a backup.
          </p>
        </div>
        <Link className="button primary" to="/entry">
          Import or add cards
        </Link>
      </section>

      <section className="panel help-section">
        <h2>What is RAX On This Day?</h2>
        <p>
          Each calendar day you can claim player cards for RAX based on historical performances
          on that same month/day. This tracker helps you see which cards are worth claiming
          before you spend RAX in the app.
        </p>
        <ul className="help-list">
          <li>
            <strong>Guaranteed</strong> — up to two player cards per sport per day (highest RAX
            wins; ties break by player name).
          </li>
          <li>
            <strong>Overlap</strong> — a third-or-later card in the same sport on the same day.
            You entered the RAX, but only the top two count as claimable.
          </li>
          <li>
            <strong>Pro bonus</strong> — optional third claim across all sports: the best
            remaining overlapped card that day (toggle on Dashboard).
          </li>
        </ul>
      </section>

      <section className="panel help-section">
        <h2>Getting your data in</h2>
        <ol className="help-list ordered">
          <li>
            <strong>Username import (recommended)</strong> — on Entry, enter your Real @username.
            Legendary, Mystic, and Iconic player and team passes are fetched automatically via{' '}
            <a href="https://realapp.tools" target="_blank" rel="noreferrer">
              realapp.tools
            </a>{' '}
            / Meowbot. No Real API key needed.
          </li>
          <li>
            <strong>Add card &amp; earnings</strong> — on Entry, set up the pass and paste daily
            RAX JSON (realapp.tools or realapp.com) in one form.
          </li>
          <li>
            <strong>Manual entry</strong> — use single-day mode in the same form for one-off rows.
          </li>
        </ol>
      </section>

      <section className="panel help-section">
        <h2>When username import misses daily RAX</h2>
        <p>
          Some passes return no daily earnings from realapp.tools. You can fill them in from{' '}
          <a href="https://www.realapp.com" target="_blank" rel="noreferrer">
            realapp.com
          </a>{' '}
          on a <strong>desktop</strong> browser with Real Pro — the mobile site redirects to the app
          store.
        </p>
        <ol className="help-list ordered">
          <li>
            Open{' '}
            <a href="https://www.realapp.com" target="_blank" rel="noreferrer">
              realapp.com
            </a>{' '}
            and log in (Real Pro, <strong>desktop</strong> browser — mobile redirects to the app
            store).
          </li>
          <li>
            Open DevTools (<kbd>F12</kbd>) and the <strong>Network</strong> tab before loading
            earnings.
          </li>
          <li>
            Go to the player&apos;s season and click the <strong>RAX icon</strong> on a performance
            to open the card earnings screen.
          </li>
          <li>
            In Network, filter for <code>userpassearnings</code> and click the request whose URL
            includes <code>playerBoxScoreId</code> (for example{' '}
            <code>userpassearnings/nba/season/2023/entity/player/…?playerBoxScoreId=…</code>).
          </li>
          <li>
            Copy the full Response JSON (an object with an <code>earnings</code> array).
          </li>
          <li>
            On <Link to="/entry">Entry</Link>, use <strong>Add card &amp; earnings</strong> — select
            the player card (or add a new one), paste the JSON, and save.
          </li>
        </ol>
        <p className="import-hint">
          realapp.tools JSON uses a <code>rows</code> array; realapp.com uses <code>earnings</code>.
          Both formats are accepted.
        </p>
      </section>

      <section className="panel help-section">
        <h2>Pages at a glance</h2>
        <dl className="help-dl">
          <div>
            <dt>Dashboard</dt>
            <dd>Totals, best claim days, export/import backup JSON.</dd>
          </div>
          <div>
            <dt>Entry</dt>
            <dd>Import collection, add cards with earnings, edit RAX rows.</dd>
          </div>
          <div>
            <dt>Calendar</dt>
            <dd>Month/day OTD view — click a day to see all player passes for that date.</dd>
          </div>
          <div>
            <dt>Overlaps</dt>
            <dd>Days and cards wasting RAX in your collection.</dd>
          </div>
          <div>
            <dt>Potential</dt>
            <dd>What-if checker for cards you do not own — paste realapp.tools JSON manually.</dd>
          </div>
          <div>
            <dt>Cards</dt>
            <dd>Per-card claimable, overlap, and entry totals.</dd>
          </div>
        </dl>
      </section>

      <section className="panel help-section">
        <h2>OTD dates</h2>
        <p>
          Claim rules apply per month/day, not per calendar year. If you have entries on
          01/15/2025 and 01/15/2026, they compete for the same two sport slots and one Pro
          bonus on January 15. Each card only uses its best performance for that day.
        </p>
      </section>

      <section className="panel help-section">
        <h2>Rarity preview (owned cards)</h2>
        <p>
          On the Cards or Entry page, pick a card imported via username and set &quot;Preview
          as&quot; to simulate upgrading rarity (e.g. Mystic → Iconic). Dashboard, Calendar, and
          Overlaps update live with the simulated OTD values. Previews are not saved to your Real
          account — clear the dropdown to return to actual totals.
        </p>
      </section>

      <section className="panel help-section">
        <h2>Backup and privacy</h2>
        <p>
          Data is stored in your browser localStorage. Use Export JSON on the Dashboard to
          back up or move to another device, then Import JSON there. Clearing site data
          removes your tracker.
        </p>
        <ul className="help-list">
          <li>
            <strong>Export files are sensitive.</strong> Backups are plain JSON and include
            your saved Real username, card list, and RAX history. Do not post them in public
            chats, email, or cloud folders others can access.
          </li>
          <li>
            <strong>Device access.</strong> Anyone with access to this browser or an unlocked
            export file can read your tracker data. Sign out of shared computers when done.
          </li>
          <li>
            <strong>Site password.</strong> The shared login password only controls who can open
            the app URL. It does not sync or isolate data between people — each browser keeps
            its own collection.
          </li>
        </ul>
      </section>
    </div>
  )
}
