# Earnings page retirement

Owner requested removing the standalone Earnings page on October 31. Remove its route/import and Profile/help links; redirect old `/earnings` and `/earnings/access` bookmarks to Dashboard. Layout already has no Earnings tab.

The daily public-reconstruction snapshots and linked tracking feeds serve this page only, so retire their manual/tracking APIs and stop snapshot entry points before provider/storage work, including forced requests and cron aliases. Acknowledge stale scheduled deliveries without scraping. Remove the repository Vercel earnings schedules and disable their GitHub fallback. No remote schedule settings, deployments or restarts are authorized.

Preserve saved history and collection data, collection imports' earnings backfill, OTD/optimization calculations, profile collection totals, and the private access/auth helpers shared with Marketplace. Preserve earlier uncommitted source work by detaching the old page rather than destructive cleanup of its helpers/data.

Implementation/checklist: write route/Profile and no-network retired-API regressions first; confirm RED; remove active UI references and retire page-specific workers; run targeted/full offline tests and mandatory gated build. Work solo/current branch and keep the site-wide 5xx rule intact. This is a direct removal request, not a new UI design requiring another approval cycle.

## Verification

- Observed RED before implementation: both legacy URLs remained on Earnings; manual/tracking and forced snapshot calls did not return the retirement contract. Targeted route/API tests then passed after implementation.
- Full offline suite: **1,107 tests in 133 files passed**. Updated two obsolete configuration assertions that required the now-retired Vercel snapshot jobs/function overrides; the fallback workflow assertion also checks its disabled-job guard.
- Mandatory `npm run build`: passed, including the request-safety audit of **221 runtime modules**, **294 safety tests in 13 files**, TypeScript and Vite. The generated assets contain no Earnings page chunk.
- `git diff --check`: passed. No saved data was deleted, no dev server was restarted, no live provider requests were made, and nothing was deployed. Remote schedules/hosting settings were not changed; repository retirement takes effect only on an explicitly authorized rollout.

Logs (local/ignored): `.superpowers/earnings-removal-red.log`, `.superpowers/earnings-removal-tests.log`, `.superpowers/earnings-removal-build.log`.
