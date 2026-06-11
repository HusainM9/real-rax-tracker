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

async function fetchJson(path) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return response.json()
}

async function dailyRows(externalKey) {
  const quoted = `in.("${externalKey.replace(/"/g, '\\"')}")`
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const page = await fetchJson(
      `meowbot_daily_earnings?select=claim_day,base_rax_earned&external_key=${quoted}&order=claim_day.asc&limit=1000&offset=${offset}`,
    )
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

async function auditSport(sport, sampleSize = 150) {
  const passes = await fetchJson(
    `meowbot_passes?select=external_key,name,total_base_rax,meowbot_daily_earnings(count)&sport=eq.${sport}&pass_kind=eq.player&has_earnings=eq.true&order=total_base_rax.desc&limit=${sampleSize}`,
  )

  let inflated = 0
  let deflated = 0
  let match = 0
  let noDaily = 0
  const examples = { inflated: [], deflated: [], match: [] }

  for (const pass of passes) {
    const embed = pass.meowbot_daily_earnings?.[0]?.count ?? 0
    if (embed === 0) {
      noDaily++
      continue
    }
    const rows = await dailyRows(pass.external_key)
    const sum = rows.reduce((total, row) => total + Number(row.base_rax_earned), 0)
    const stored = Number(pass.total_base_rax)
    const ratio = stored > 0 ? sum / stored : null

    if (stored > 0 && ratio > 1.01) {
      inflated++
      if (examples.inflated.length < 10) {
        examples.inflated.push({ name: pass.name, stored, sum, ratio })
      }
    } else if (stored > 0 && ratio < 0.99) {
      deflated++
      if (examples.deflated.length < 10) {
        examples.deflated.push({ name: pass.name, stored, sum, ratio })
      }
    } else {
      match++
      if (examples.match.length < 3) {
        examples.match.push({ name: pass.name, stored, sum, ratio })
      }
    }
  }

  console.log(JSON.stringify({ sport, checked: passes.length, noDaily, inflated, deflated, match, examples }, null, 2))
}

for (const sport of ['NHL', 'NFL', 'NBA']) {
  await auditSport(sport, 120)
}
