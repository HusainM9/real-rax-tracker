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
  console.error('Missing SUPABASE env')
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}` }

async function fetchJson(path) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text.slice(0, 200)}`)
  }
  return response.json()
}

async function mahomesPasses() {
  return fetchJson(
    'meowbot_passes?select=external_key,entity_id,season_year,season_label,name,total_base_rax,has_earnings&sport=eq.NFL&pass_kind=eq.player&name=ilike.*Mahomes*&order=season_year.desc',
  )
}

async function dailyForKey(externalKey) {
  const quoted = `"${externalKey.replace(/"/g, '\\"')}"`
  return fetchJson(
    `meowbot_daily_earnings?select=claim_day,base_rax_earned,player_box_score_id&external_key=eq.${encodeURIComponent(quoted)}&order=claim_day.asc`,
  )
}

async function dailyCountForKey(externalKey) {
  const quoted = `"${externalKey.replace(/"/g, '\\"')}"`
  const response = await fetch(
    `${base}/rest/v1/meowbot_daily_earnings?select=claim_day&external_key=eq.${encodeURIComponent(quoted)}&limit=1`,
    { headers: { ...headers, Prefer: 'count=exact' } },
  )
  const range = response.headers.get('content-range') ?? ''
  return Number(range.split('/')[1] ?? 0)
}

function sumRows(rows) {
  return rows.reduce((sum, row) => sum + Number(row.base_rax_earned), 0)
}

function dedupeByClaimDay(rows) {
  const byDay = new Map()
  for (const row of rows) {
    const day = row.claim_day
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(row)
  }
  return byDay
}

const passes = await mahomesPasses()
console.log(`Found ${passes.length} Mahomes NFL passes\n`)

for (const pass of passes) {
  const daily = await dailyForKey(pass.external_key)
  const dailyCount = await dailyCountForKey(pass.external_key)
  const sum = sumRows(daily)
  const dupDays = [...dedupeByClaimDay(daily).entries()].filter(([, rows]) => rows.length > 1)

  console.log({
    externalKey: pass.external_key,
    seasonYear: pass.season_year,
    seasonLabel: pass.season_label,
    storedTotal: Number(pass.total_base_rax),
    dailyRowCount: daily.length,
    dailyCountHeader: dailyCount,
    sumFromDaily: sum,
    ratio: sum / Number(pass.total_base_rax),
    dupClaimDays: dupDays.length,
  })

  if (dupDays.length > 0) {
    console.log('  duplicate claim days sample:', dupDays.slice(0, 3).map(([day, rows]) => ({
      day,
      count: rows.length,
      rax: rows.map((r) => Number(r.base_rax_earned)),
    })))
  }
}

// Check NFL duplicate entity+season_year with different external keys
console.log('\n--- NFL duplicate entity+season_year ---')
const nflPasses = await fetchJson(
  'meowbot_passes?select=external_key,entity_id,season_year,season_label,name,total_base_rax&sport=eq.NFL&pass_kind=eq.player&name=ilike.*Mahomes*&season_year=eq.2024',
)
const byEntityYear = new Map()
for (const pass of nflPasses) {
  const key = `${pass.entity_id}|${pass.season_year}`
  if (!byEntityYear.has(key)) byEntityYear.set(key, [])
  byEntityYear.get(key).push(pass)
}
for (const [key, group] of byEntityYear) {
  if (group.length > 1) {
    console.log(key, group.map((p) => ({
      externalKey: p.external_key,
      label: p.season_label,
      total: Number(p.total_base_rax),
    })))
  }
}

// Sample NFL passes with multiple labels per season_year
console.log('\n--- NFL season years with multiple labels (sample) ---')
const labelCheck = await fetchJson(
  'meowbot_passes?select=entity_id,season_year,season_label,external_key,name,total_base_rax&sport=eq.NFL&pass_kind=eq.player&season_year=eq.2024&limit=20&order=total_base_rax.desc',
)
const entityLabels = new Map()
for (const row of labelCheck) {
  const k = row.entity_id
  if (!entityLabels.has(k)) entityLabels.set(k, new Set())
  entityLabels.get(k).add(`${row.season_label}|${row.external_key}|${row.total_base_rax}`)
}
let multiLabel = 0
for (const [entityId, labels] of entityLabels) {
  if (labels.size > 1) {
    multiLabel++
    if (multiLabel <= 5) console.log({ entityId, labels: [...labels] })
  }
}
console.log('entities with multiple passes same season_year (in top 20 sample):', multiLabel)
