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
  return response.json()
}

async function exactCount(filter) {
  const response = await fetch(`${base}/rest/v1/meowbot_passes?select=season_year&limit=1&${filter}`, {
    headers: { ...headers, Prefer: 'count=exact' },
  })
  return Number((response.headers.get('content-range') ?? '').split('/')[1] ?? 0)
}

const sample = await fetchJson('meowbot_passes?select=sport,season_year&limit=5')
console.log('sample rows', sample)

for (const sport of ['FC', 'fc', 'MLB', 'NBA']) {
  const count = await exactCount(`sport=eq.${sport}&pass_kind=eq.player`)
  const years = new Set()
  for (let offset = 0; offset < count; offset += 1000) {
    const rows = await fetchJson(
      `meowbot_passes?select=season_year,season_label&sport=eq.${sport}&pass_kind=eq.player&order=season_year.desc&limit=1000&offset=${offset}`,
    )
    for (const row of rows) years.add(row.season_year)
    if (rows.length < 1000) break
  }
  console.log({ sport, count, years: [...years].sort((a, b) => b - a) })
}

for (const sport of ['NBA', 'FC', 'MLB']) {
  const labelSet = new Set()
  const count = await exactCount(`sport=eq.${sport}&pass_kind=eq.player`)
  for (let offset = 0; offset < Math.min(count, 5000); offset += 1000) {
    const rows = await fetchJson(
      `meowbot_passes?select=season_year,season_label&sport=eq.${sport}&pass_kind=eq.player&limit=1000&offset=${offset}`,
    )
    for (const row of rows) labelSet.add(`${row.season_year}|${row.season_label}`)
    if (rows.length < 1000) break
  }
  console.log(sport, 'distinct season keys', [...labelSet].sort().reverse().slice(0, 15), 'total', labelSet.size)
}
