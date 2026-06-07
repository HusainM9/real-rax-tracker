import { Link } from 'react-router-dom'
import { realappToolsShutdownLabel } from '../lib/importShutdown'

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
            <strong>Username import (until shutdown)</strong> — on Entry, enter your Real @username.
            Legendary, Mystic, and Iconic player and team passes can be fetched via{' '}
            <a href="https://realapp.tools" target="_blank" rel="noreferrer">
              realapp.tools
            </a>{' '}
            / Meowbot until {realappToolsShutdownLabel()}. Existing imported cards and earnings
            remain saved locally after the service closes.
          </li>
          <li>
            <strong>Add card &amp; earnings</strong> — on Entry, set up the pass and paste daily
            RAX JSON from realapp.com in one form. Cached player earnings from prior imports can
            be loaded when available.
          </li>
          <li>
            <strong>Manual entry</strong> — use single-day mode in the same form for one-off rows.
          </li>
        </ol>
      </section>

      <section className="panel help-section">
        <h2>realapp.tools shutdown</h2>
        <p>
          realapp.tools / Meowbot is shutting down, so automatic username import will stop working.
          This does <strong>not</strong> delete cards or earnings already imported into this
          browser.
        </p>
        <ul className="help-list">
          <li>
            <strong>Back up before and after big imports.</strong> Use Export JSON on Dashboard.
            Backups include cards, earnings, saved profiles, potential profiles, sell rankings,
            and cached player earnings.
          </li>
          <li>
            <strong>Local player earnings cache.</strong> While username import still works, the
            tracker caches player daily earnings it sees. Entry and Potential can load those cached
            rows later to avoid another JSON paste.
          </li>
          <li>
            <strong>Backend ownership cache.</strong> Successful username imports can report a
            minimal pass list to the operator cache: username, pass name, sport, season, entity ID,
            rarity, and pass kind. It does not upload your notes, claim math, or full backup.
          </li>
          <li>
            <strong>After shutdown.</strong> New cards and earnings are manual: use Add card &amp;
            earnings, paste realapp.com JSON, add single-day rows, or restore an exported backup.
          </li>
        </ul>
      </section>

      <section className="panel help-section">
        <h2>Manual realapp.com earnings JSON</h2>
        <p>
          After username import closes, or when a pass is missing daily rows, you can fill it in from{' '}
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
            In Network, filter for the request whose URL
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
          realapp.com uses an <code>earnings</code> array. The tracker still accepts old
          realapp.tools <code>rows</code> JSON while you have it. Earnings are also saved to{' '}
          <strong>Saved earnings profiles</strong> on Entry — restore them after re-import or manual
          card changes.
        </p>
      </section>

      <section className="panel help-section">
        <h2>Saved earnings profiles</h2>
        <p>
          When you paste or import earnings on Entry, the tracker automatically saves a profile for
          that player (card details + all RAX rows + pasted JSON). Re-importing your username
          replaces earnings on imported passes but does <strong>not</strong> delete saved profiles.
        </p>
        <ul className="help-list">
          <li>
            <strong>Restore</strong> — re-applies saved RAX rows onto the matching pass (by import
            ID when available, otherwise name + sport + season).
          </li>
          <li>
            <strong>Load JSON</strong> — fills the paste box without importing yet.
          </li>
          <li>
            Profiles are stored in this browser with your collection and included in JSON export
            backups.
          </li>
        </ul>
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
            <dd>What-if checker for cards you do not own — load cached earnings or paste JSON.</dd>
          </div>
          <div>
            <dt>Cards</dt>
            <dd>Per-card totals, sorting, and rarity preview.</dd>
          </div>
          <div>
            <dt>If sold</dt>
            <dd>
              Simulate selling a pass — lost vs freed claimable RAX and optional sale price
              comparison.
            </dd>
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
          <li>
            <strong>Operator logging and ownership cache.</strong> Production imports can report
            import events plus a minimal username/pass snapshot to help restore known pass lists
            later. This does not upload your local notes, manual edits, claim results, or backup
            JSON.
          </li>
        </ul>
      </section>
    </div>
  )
}
