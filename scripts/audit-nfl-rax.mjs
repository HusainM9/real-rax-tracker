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
const headers = { apikey: key, Authorization: `Bearer ${key}` }

async function fetchJson(path, extraHeaders = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: { ...headers, ...extraHeaders } })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return { json: await response.json(), response }
}

function quote(value) {
  return encodeURIComponent(`"${value.replace(/"/g, '\\"')}"`)
}

async function dailyRows(externalKey) {
  const quoted = `in.("${externalKey.replace(/"/g, '\\"')}")`
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const { json } = await fetchJson(
      `meowbot_daily_earnings?select=claim_day,base_rax_earned,player_box_score_id&external_key=${quoted}&order=claim_day.asc&limit=1000&offset=${offset}`,
    )
    rows.push(...json)
    if (json.length < 1000) break
  }
  return rows
}

function sumRows(rows) {
  return rows.reduce((sum, row) => sum + Number(row.base_rax_earned), 0)
}

function duplicateClaimDays(rows) {
  const byDay = new Map()
  for (const row of rows) {
    byDay.set(row.claim_day, (byDay.get(row.claim_day) ?? 0) + 1)
  }
  return [...byDay.entries()].filter(([, count]) => count > 1)
}

// Mahomes with earnings embed count
const { json: mahomes } = await fetchJson(
  'meowbot_passes?select=external_key,name,season_year,season_label,total_base_rax,has_earnings,meowbot_daily_earnings(count)&sport=eq.NFL&pass_kind=eq.player&name=ilike.*Mahomes*',
)
console.log('Mahomes passes:', mahomes)

for (const pass of mahomes) {
  const rows = await dailyRows(pass.external_key)
  const dup = duplicateClaimDays(rows)
  console.log({
    key: pass.external_key,
    label: pass.season_label,
    stored: Number(pass.total_base_rax),
    embedCount: pass.meowbot_daily_earnings?.[0]?.count ?? 0,
    fetched: rows.length,
    sum: sumRows(rows),
    dupDays: dup.length,
    ratio: rows.length ? sumRows(rows) / Number(pass.total_base_rax) : null,
    sampleDays: rows.slice(0, 5).map((r) => ({ day: r.claim_day, rax: Number(r.base_rax_earned) })),
  })
}

// Compare NFL vs NBA mismatch rate (stored vs daily sum)
async function auditSport(sport, sampleSize = 200) {
  const { json: passes } = await fetchJson(
    `meowbot_passes?select=external_key,name,total_base_rax,meowbot_daily_earnings(count)&sport=eq.${sport}&pass_kind=eq.player&has_earnings=eq.true&order=total_base_rax.desc&limit=${sampleSize}`,
  )

  let mismatch = 0
  let doubled = 0
  let dupDayIssues = 0
  const examples = []

  for (const pass of passes) {
    const embedCount = pass.meowbot_daily_earnings?.[0]?.count ?? 0
    if (embedCount === 0) continue
    const rows = await dailyRows(pass.external_key)
    const sum = sumRows(rows)
    const stored = Number(pass.total_base_rax)
    const dup = duplicateClaimDays(rows)
    if (dup.length > 0) {
      dupDayIssues++
      if (examples.length < 3) {
        examples.push({ type: 'dupDays', name: pass.name, key: pass.external_key, stored, sum, dupDays: dup.length })
      }
    }
    if (stored > 0 && Math.abs(sum - stored) > 0.01) {
      mismatch++
      if (examples.length < 5) {
        examples.push({ type: 'mismatch', name: pass.name, key: pass.external_key, stored, sum, ratio: sum / stored })
      }
    }
    if (stored > 0 && sum / stored > 1.8 && sum / stored < 2.2) {
      doubled++
      if (examples.length < 5) {
        examples.push({ type: 'doubled', name: pass.name, key: pass.external_key, stored, sum })
      }
    }
  }

  console.log(`\n${sport} audit (top ${sampleSize} by stored total):`, {
    checked: passes.length,
    mismatch,
    doubled,
    dupDayIssues,
    examples,
  })
}

await auditSport('NFL', 100)
await auditSport('NBA', 100)

// NFL duplicate entity+season_year passes
const { json: nflDupSample } = await fetchJson(
  'meowbot_passes?select=entity_id,season_year,season_label,external_key,name,total_base_rax&sport=eq.NFL&pass_kind=eq.player&has_earnings=eq.true&season_year=eq.2023&order=total_base_rax.desc&limit=500',
)
const groups = new Map()
for (const row of nflDupSample) {
  const k = `${row.entity_id}|${row.season_year}`
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(row)
}
const dupEntities = [...groups.entries()].filter(([, rows]) => rows.length > 1)
console.log('\nNFL 2023 duplicate entity passes:', dupEntities.length)
if (dupEntities.length) console.log('sample', dupEntities.slice(0, 3))
