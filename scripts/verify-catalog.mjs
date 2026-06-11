import fs from 'node:fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (!match) continue
  process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
}

const base = (process.env.SUPABASE_URL ?? '')
  .replace(/\/rest\/v1\/?$/i, '')
  .replace(/\/$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.')
  process.exit(1)
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
}

async function exactCount(table, filter = '') {
  const query = filter ? `&${filter}` : ''
  const response = await fetch(
    `${base}/rest/v1/${table}?select=external_key&limit=1${query}`,
    { headers: { ...headers, Prefer: 'count=exact' } },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${table} count failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  return Number((response.headers.get('content-range') ?? '').split('/')[1] ?? 0)
}

async function fetchJson(path) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Query failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  return response.json()
}

const [
  passCount,
  dailyCount,
  playerCount,
  teamCount,
  noEarningsCount,
  withEarningsCount,
  nullTotalCount,
  zeroTotalWithEarnings,
] = await Promise.all([
  exactCount('meowbot_passes'),
  exactCount('meowbot_daily_earnings'),
  exactCount('meowbot_passes', 'pass_kind=eq.player'),
  exactCount('meowbot_passes', 'pass_kind=eq.team'),
  exactCount('meowbot_passes', 'has_earnings=eq.false'),
  exactCount('meowbot_passes', 'has_earnings=eq.true'),
  exactCount('meowbot_passes', 'total_base_rax=is.null'),
  exactCount('meowbot_passes', 'has_earnings=eq.true&total_base_rax=eq.0'),
])

const seasonMin = (await fetchJson('meowbot_passes?select=season_year&order=season_year.asc&limit=1'))[0]
  ?.season_year
const seasonMax = (await fetchJson('meowbot_passes?select=season_year&order=season_year.desc&limit=1'))[0]
  ?.season_year

const topEarners = await fetchJson(
  'meowbot_passes?select=name,sport,season_year,total_base_rax,has_earnings&has_earnings=eq.true&order=total_base_rax.desc&limit=5',
)

const sampleNoEarnings = await fetchJson(
  'meowbot_passes?select=name,sport,season_year,has_earnings,total_base_rax&has_earnings=eq.false&order=season_year.desc,name.asc&limit=5',
)

const flaggedOrphans = await exactCount('meowbot_daily_earnings', 'meowbot_passes.is.null')

const consistencySample = await fetchJson(
  'meowbot_passes?select=external_key,total_base_rax,meowbot_daily_earnings(count)&has_earnings=eq.true&total_base_rax=gt.0&limit=1000',
)
const missingDailyInSample = consistencySample.filter(
  (row) => (row.meowbot_daily_earnings?.[0]?.count ?? 0) === 0,
)

const issues = []
if (nullTotalCount > 0) issues.push(`${nullTotalCount} passes with null total_base_rax`)
if (zeroTotalWithEarnings > 0) {
  issues.push(`${zeroTotalWithEarnings} passes marked has_earnings=true but total_base_rax=0`)
}
if (withEarningsCount + noEarningsCount !== passCount) {
  issues.push('has_earnings flags do not add up to total pass count')
}
if (missingDailyInSample.length > 0) {
  issues.push(
    `${missingDailyInSample.length}/${consistencySample.length} sampled earning passes have zero daily rows`,
  )
}

console.log(
  JSON.stringify(
    {
      status: issues.length === 0 ? 'ok' : 'review',
      totals: {
        meowbot_passes: passCount,
        meowbot_daily_earnings: dailyCount,
        avg_daily_rows_per_pass_with_earnings:
          withEarningsCount > 0 ? Math.round((dailyCount / withEarningsCount) * 10) / 10 : 0,
      },
      passes: {
        players: playerCount,
        teams: teamCount,
        has_earnings: withEarningsCount,
        no_earnings: noEarningsCount,
      },
      seasons: {
        min: seasonMin ?? null,
        max: seasonMax ?? null,
      },
      integrity: {
        null_total_base_rax: nullTotalCount,
        has_earnings_but_zero_total: zeroTotalWithEarnings,
        orphan_daily_rows_check: flaggedOrphans,
        orphan_check_note:
          flaggedOrphans === dailyCount
            ? 'PostgREST embed filter unreliable; FK on meowbot_daily_earnings prevents real orphans'
            : null,
        sampled_earning_passes_missing_daily_rows: missingDailyInSample.length,
        sample_size: consistencySample.length,
      },
      samples: {
        top_base_rax: topEarners,
        no_earnings: sampleNoEarnings,
      },
      issues,
    },
    null,
    2,
  ),
)
