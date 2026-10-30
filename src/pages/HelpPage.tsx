import { Link } from 'react-router-dom'

export default function HelpPage() {
  return <div className="page-stack">
    <section className="hero-card"><div><p className="eyebrow">Guide</p><h2>How this tracker works</h2>
      <p>Import your collection, review daily claims, and compare upgrades before changing your Plan.</p>
    </div><Link className="button primary" to="/#dashboard-import">Import collection</Link></section>
    <section className="panel help-section"><h2>Import your collection</h2>
      <ol className="help-list ordered">
        <li>Open Dashboard and enter your Real username in the import tools.</li>
        <li>Legendary, Mystic, and Iconic passes are included. Optionally include Rare or Epic.</li>
        <li>Import replaces the collection with current ownership. Export a backup first if you need one.</li>
        <li>Use Retry failed earnings for temporary failures without scanning ownership again. Passes with no earnings remain in your collection; import again when data is available.</li>
      </ol>
      <p>Collection entry is import-only. JSON backup and restore remain under Dashboard's backup controls.</p>
    </section>
    <section className="panel help-section"><h2>OTD claims</h2><ul className="help-list">
      <li><strong>Guaranteed:</strong> top two cards per sport on each recurring month/day, pooling years.</li>
      <li><strong>Pro:</strong> one additional claim across sports, when enabled.</li>
      <li><strong>Overlap:</strong> remaining performances that cannot be claimed that day.</li>
      <li>Each card uses its best performance on that month/day. UFC combines the fighter's same-day fights.</li>
      <li>Use Cards for rarity changes and collection review.</li>
    </ul></section>
    <section className="panel help-section"><h2>Choose a tool</h2><dl className="help-dl">
      <div><dt>Dashboard</dt><dd>Collection import, totals, and backups.</dd></div>
      <div><dt>Calendar, OTD, and Overlaps</dt><dd>Inspect claim days, opportunities, and unclaimable earnings.</dd></div>
      <div><dt>Optimization</dt><dd>Find the best upgrades ranks passes by net collection gain and calculates a greedy bundle. You can optionally assume upgrades for selected Plan cards.</dd></div>
      <div><dt>Plan</dt><dd>Compare intended acquisitions and simulated sells without changing your collection.</dd></div>
      <div><dt>Packs</dt><dd>Track rating progress across accounts. Successful scans may be reused for 30 seconds; enable Always refresh from Real to bypass that snapshot.</dd></div>
      <div><dt>If sold</dt><dd>Compare lost and newly freed claims when selling a pass.</dd></div>
    </dl></section>
    <section className="panel help-section"><h2>Backup and privacy</h2>
      <p>Your signed-in tracker account syncs collection data to server storage. The browser also keeps a local cache. Export JSON from Dashboard for an independent backup; exports contain usernames, cards, notes, and earnings in plain text.</p>
      <p>The site password controls app access; it is separate from your tracker account. Imports use the operator's server-configured Real session, not a Real password entered by you. Shared catalog data and minimal import diagnostics may also be stored.</p>
    </section>
  </div>
}
