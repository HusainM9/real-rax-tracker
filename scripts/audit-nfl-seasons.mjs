import fs from 'node:fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (!match) continue
  process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
}

const base = (process.env.SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = { apikey: key, Authorization: `Bearer ${key}` }

async function fetchJson(path) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers })
  return response.json()
}

const rows = []
for (let offset = 0; ; offset += 1000) {
  const page = await fetchJson(
    `meowbot_passes?select=entity_id,season_year,season_label,name&sport=eq.NFL&pass_kind=eq.player&has_earnings=eq.true&limit=1000&offset=${offset}`,
  )
  rows.push(...page)
  if (page.length < 1000) break
}

const byEntityYear = new Map()
for (const row of rows) {
  const k = `${row.entity_id}|${row.season_year}`
  if (!byEntityYear.has(k)) byEntityYear.set(k, new Set())
  byEntityYear.get(k).add(row.season_label)
}

let dup = 0
const samples = []
for (const [k, labels] of byEntityYear) {
  if (labels.size > 1) {
    dup++
    if (samples.length < 5) samples.push({ k, labels: [...labels] })
  }
}
console.log('entity+season_year with multiple labels:', dup, 'samples:', samples)

const labels = new Map()
for (const row of rows) {
  labels.set(row.season_label, (labels.get(row.season_label) ?? 0) + 1)
}
console.log('\nUnique season labels:', [...labels.entries()].sort((a, b) => b[0].localeCompare(a[0])))
