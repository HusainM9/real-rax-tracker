#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_MEOWBOT_URL = 'https://mfsyhtuqybbxprgwwykd.supabase.co'
const DEFAULT_MEOWBOT_KEY = 'sb_publishable_Al7QsFGnNTlknoI8KVxjag_JUwrytZy'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([^=]+)=(.*)$/.exec(trimmed)
    if (!match) continue
    const key = match[1].trim()
    const value = match[2].trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvFile(path.resolve('.env.local'))
loadEnvFile(path.resolve('.env'))

function argValue(name, fallback = '') {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  if (found) return found.slice(prefix.length)
  const envName = `npm_config_${name.replace(/-/g, '_')}`
  return process.env[envName] || fallback
}

function hasFlag(name) {
  const envName = `npm_config_${name.replace(/-/g, '_')}`
  return process.argv.includes(`--${name}`) || process.env[envName] === 'true'
}

function parseList(value) {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseNumberList(value) {
  return parseList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function normalizeSport(raw) {
  const sport = String(raw ?? '').trim().toLowerCase()
  if (sport === 'ncaab' || sport === 'ncaa-mens-basketball') return 'ncaam'
  if (sport === 'ncaafootball' || sport === 'ncaa-football' || sport === 'cfb') return 'ncaaf'
  return sport
}

function displaySport(raw) {
  switch (normalizeSport(raw)) {
    case 'nba':
      return 'NBA'
    case 'wnba':
      return 'WNBA'
    case 'nfl':
      return 'NFL'
    case 'ncaaf':
      return 'CFB'
    case 'mlb':
      return 'MLB'
    case 'nhl':
      return 'NHL'
    case 'ncaam':
      return 'CBB'
    case 'golf':
      return 'Golf'
    case 'fc':
    case 'soccer':
      return 'FC'
    case 'ufc':
      return 'UFC'
    default:
      return 'Other'
  }
}

function isCalendarYearSport(raw) {
  const sport = normalizeSport(raw)
  return sport === 'ufc' || sport === 'golf' || sport === 'mlb' || sport === 'wnba'
}

// Real reports the season's first year for these (matches seasonYearKindForSport).
// CBB/ncaam is end-year: season 2026 is the 2025-26 season — do not treat as start-year.
function isStartYearSport(raw) {
  const sport = normalizeSport(raw)
  return (
    sport === 'nfl' ||
    sport === 'nhl' ||
    sport === 'ncaaf' ||
    sport === 'fc' ||
    sport === 'soccer'
  )
}

function seasonLabelFromPass(seasonYear, sportRaw) {
  if (!Number.isInteger(seasonYear) || seasonYear < 1000) return String(seasonYear)
  if (isStartYearSport(sportRaw)) return `${seasonYear}-${String(seasonYear + 1).slice(-2)}`
  if (isCalendarYearSport(sportRaw)) return String(seasonYear)
  return `${seasonYear - 1}-${String(seasonYear).slice(-2)}`
}

function externalKey(entityId, seasonYear, sport) {
  return `${entityId}|${seasonYear}|${sport}`
}

async function invokeMeowbot(action, payload) {
  const baseUrl = (process.env.MEOWBOT_SUPABASE_URL || process.env.VITE_MEOWBOT_SUPABASE_URL || DEFAULT_MEOWBOT_URL).replace(/\/$/, '')
  const key = process.env.MEOWBOT_SUPABASE_KEY || process.env.VITE_MEOWBOT_SUPABASE_KEY || DEFAULT_MEOWBOT_KEY
  const response = await fetch(`${baseUrl}/functions/v1/market-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ action, payload }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Meowbot ${action} failed (${response.status})`)
  }
  return data
}

function normalizeSupabaseProjectUrl(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\/$/, '')
    .replace(/\/rest\/v1$/i, '')
}

async function supabaseUpsert(table, rows, conflictColumns) {
  if (rows.length === 0) return 0
  const supabaseUrl = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.')
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=${conflictColumns}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Supabase upsert ${table} failed (${response.status}). ${detail}`.trim())
  }
  return rows.length
}

async function getAvailableSeasons() {
  const data = await invokeMeowbot('get_available_seasons', {})
  return (data.seasons ?? [])
    .map((season) => Number(season))
    .filter((season) => Number.isFinite(season) && season > 0)
    .sort((a, b) => b - a)
}

async function discoverPasses({ seasons, types, sport, limit }) {
  const passes = new Map()
  const normalizedSportFilter = sport ? normalizeSport(sport) : ''

  if (types.includes('players')) {
    const data = await invokeMeowbot('get_otd_earnings_table', { seasons })
    for (const row of data.rows ?? []) {
      const entityId = Number(row.entityId)
      const seasonYear = Number(row.season)
      const sportRaw = String(row.sport ?? '')
      if (!Number.isFinite(entityId) || !Number.isFinite(seasonYear) || !sportRaw) continue
      if (normalizedSportFilter && normalizeSport(sportRaw) !== normalizedSportFilter) continue
      const sportLabel = displaySport(sportRaw)
      const pass = {
        entityId,
        seasonYear,
        sportRaw,
        sport: sportLabel,
        seasonLabel: String(row.seasonLabel ?? '').trim() || seasonLabelFromPass(seasonYear, sportRaw),
        name: String(row.playerName ?? `Player ${entityId}`),
        passKind: 'player',
        externalKey: externalKey(entityId, seasonYear, sportLabel),
      }
      passes.set(`player|${pass.externalKey}`, pass)
    }
  }

  if (types.includes('teams')) {
    const data = await invokeMeowbot('get_team_otd_earnings_table', { seasons })
    for (const row of data.rows ?? []) {
      const entityId = Number(row.entityId)
      const seasonYear = Number(row.season)
      const sportRaw = String(row.sport ?? '')
      if (!Number.isFinite(entityId) || !Number.isFinite(seasonYear) || !sportRaw) continue
      if (normalizedSportFilter && normalizeSport(sportRaw) !== normalizedSportFilter) continue
      const sportLabel = displaySport(sportRaw)
      const pass = {
        entityId,
        seasonYear,
        sportRaw,
        sport: sportLabel,
        seasonLabel: String(row.seasonLabel ?? '').trim() || seasonLabelFromPass(seasonYear, sportRaw),
        name: String(row.teamName ?? `Team ${entityId}`),
        passKind: 'team',
        externalKey: externalKey(entityId, seasonYear, sportLabel),
      }
      passes.set(`team|${pass.externalKey}`, pass)
    }
  }

  const discovered = [...passes.values()]
  return limit > 0 ? discovered.slice(0, limit) : discovered
}

async function fetchDailyRows(pass) {
  const action = pass.passKind === 'team' ? 'get_team_daily_earnings' : 'get_daily_earnings'
  const data = await invokeMeowbot(action, {
    entityId: pass.entityId,
    season: pass.seasonYear,
    sport: normalizeSport(pass.sportRaw),
    seasonLabel: pass.seasonLabel,
  })
  return (data.rows ?? [])
    .map((row) => ({
      external_key: pass.externalKey,
      claim_day: /^(\d{4}-\d{2}-\d{2})/.exec(String(row.day ?? ''))?.[1] ?? '',
      base_rax_earned: Number(row.earnings),
      player_box_score_id: row.player_box_score_id ?? row.playerBoxScoreId ?? null,
    }))
    .filter((row) => row.claim_day && Number.isFinite(row.base_rax_earned) && row.base_rax_earned > 0)
}

async function runWithConcurrency(items, limit, worker) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
}

function chunk(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function main() {
  if (hasFlag('help')) {
    console.log('Usage: node scripts/seed-meowbot-catalog.mjs --seasons=2026,2025 --types=players,teams --sport=nba --limit=250 --concurrency=8 --write')
    return
  }

  const seasonsArg = argValue('seasons')
  const seasons = seasonsArg ? parseNumberList(seasonsArg) : await getAvailableSeasons()
  const types = parseList(argValue('types', 'players,teams'))
  const sport = argValue('sport')
  const limit = Number(argValue('limit', '250'))
  const concurrency = Math.max(1, Number(argValue('concurrency', '8')) || 8)
  const dryRun = !hasFlag('write') || hasFlag('dry-run')

  console.log(`Discovering OTD passes: seasons=${seasons.join(',')} types=${types.join(',')} sport=${sport || 'all'} limit=${limit || 'all'}`)
  const passes = await discoverPasses({ seasons, types, sport, limit })
  console.log(`Discovered ${passes.length} passes.`)

  const passRows = []
  const dailyRows = []
  let noEarnings = 0
  let failures = 0

  await runWithConcurrency(passes, concurrency, async (pass, index) => {
    try {
      const rows = await fetchDailyRows(pass)
      if (rows.length === 0) {
        noEarnings += 1
        passRows.push({
          external_key: pass.externalKey,
          entity_id: pass.entityId,
          pass_kind: pass.passKind,
          sport: pass.sport,
          season_year: pass.seasonYear,
          season_label: pass.seasonLabel,
          name: pass.name,
          rarity_label: null,
          has_earnings: false,
          total_base_rax: 0,
          source_updated_at: new Date().toISOString(),
        })
        return
      }
      const totalBaseRax = rows.reduce((sum, row) => sum + row.base_rax_earned, 0)
      passRows.push({
        external_key: pass.externalKey,
        entity_id: pass.entityId,
        pass_kind: pass.passKind,
        sport: pass.sport,
        season_year: pass.seasonYear,
        season_label: pass.seasonLabel,
        name: pass.name,
        rarity_label: null,
        has_earnings: true,
        total_base_rax: totalBaseRax,
        source_updated_at: new Date().toISOString(),
      })
      dailyRows.push(...rows)
      if ((index + 1) % 25 === 0) {
        console.log(`Fetched ${index + 1}/${passes.length} passes...`)
      }
    } catch (error) {
      failures += 1
      console.warn(`Failed ${pass.name}: ${error.message}`)
    }
  })

  console.log(`Ready to save ${passRows.length} passes and ${dailyRows.length} daily rows. noEarnings=${noEarnings} failures=${failures}`)
  if (dryRun) {
    console.log('Dry run: nothing written to Supabase. Add --write to save rows.')
    return
  }

  const passesByKey = new Map()
  for (const row of passRows) {
    row.total_base_rax = Math.max(0, Number(row.total_base_rax) || 0)
    const existing = passesByKey.get(row.external_key)
    if (!existing || row.total_base_rax > existing.total_base_rax) {
      passesByKey.set(row.external_key, row)
    }
  }
  const uniquePassRows = [...passesByKey.values()]

  let savedPasses = 0
  let savedRows = 0
  for (const rows of chunk(uniquePassRows, 500)) {
    savedPasses += await supabaseUpsert('meowbot_passes', rows, 'external_key')
  }
  for (const rows of chunk(dailyRows, 1000)) {
    savedRows += await supabaseUpsert('meowbot_daily_earnings', rows, 'external_key,claim_day')
  }
  console.log(`Saved ${savedPasses} passes and ${savedRows} daily rows to Supabase.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

