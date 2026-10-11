/**
 * Read-only live probe of Real's API for shape discovery.
 *
 * Usage: node scripts/probe-real.mjs <passes|earnings|daily|params|pagination|seasons|shop|plays> [args]
 *
 * shop args: [sport] [season] [entityType]  (defaults: ncaam 2026 player)
 * Also probes before=0/20, a second live season (mlb/soccer team), and field inventory.
 *
 * Credentials are read from .env.local and are never printed. Raw responses are
 * cached under the OS temp dir (never the repo) so later phases can reuse them
 * without re-requesting.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Hashids from 'hashids'

const CACHE_DIR = path.join(os.tmpdir(), 'real-probe')
const BASE_URL = 'https://web.realapp.com'
const GORDON_USER_ID = 'jvbKVyL3'

function loadEnvLocal() {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (!match) continue
    process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
  }
}

function config() {
  const authInfo = process.env.REAL_AUTH_INFO ?? ''
  return {
    authInfo,
    sessionToken: process.env.REAL_SESSION_TOKEN ?? '',
    deviceUuid: process.env.REAL_DEVICE_UUID ?? '',
    deviceName: process.env.REAL_DEVICE_NAME ?? '',
    version: process.env.REAL_VERSION ?? '35',
    botUserId: authInfo.split('!')[0] ?? '',
  }
}

function headers(cfg) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'real-auth-info': cfg.authInfo,
    'real-session-token': cfg.sessionToken,
    'real-device-uuid': cfg.deviceUuid,
    'real-device-name': cfg.deviceName,
    'real-device-type': 'desktop_web',
    'real-version': cfg.version,
    'real-request-token': new Hashids('realwebapp', 16).encode(Date.now()),
    origin: 'https://www.realapp.com',
    referer: 'https://www.realapp.com/',
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function get(cfg, urlPath, query = {}) {
  const url = new URL(`${BASE_URL}${urlPath}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const response = await fetch(url.toString(), { method: 'GET', headers: headers(cfg) })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* leave null; caller inspects status + snippet */
  }
  await sleep(400)
  return { status: response.status, json, snippet: text.slice(0, 300), search: url.search }
}

function cachePath(name) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  return path.join(CACHE_DIR, `${name}.json`)
}

function writeCache(name, value) {
  fs.writeFileSync(cachePath(name), JSON.stringify(value, null, 2))
}

function readCache(name) {
  return JSON.parse(fs.readFileSync(cachePath(name), 'utf8'))
}

function summarizePasses(label, result) {
  console.log(`--- ${label}: status ${result.status}`)
  if (!result.json) {
    console.log('non-JSON body snippet:', result.snippet)
    return
  }
  console.log('top-level keys:', Object.keys(result.json))
  const passes = result.json.passes
  console.log('passes count:', Array.isArray(passes) ? passes.length : 'n/a')
  for (const key of ['total', 'cursor', 'hasMore', 'limit', 'offset', 'nextCursor', 'count']) {
    if (result.json[key] !== undefined) console.log(`  ${key}:`, result.json[key])
  }
}

async function phasePasses(cfg) {
  const bot = await get(cfg, `/userpasses/${cfg.botUserId}/passes`)
  writeCache('bot-passes', bot)
  summarizePasses('bot passes', bot)

  const gordon = await get(cfg, `/userpasses/${GORDON_USER_ID}/passes`)
  writeCache('gordon-passes', gordon)
  summarizePasses('gordon passes', gordon)

  console.log('\nviewOptions:', JSON.stringify(gordon.json?.viewOptions))
  console.log('\nfilterOptions keys:', Object.keys(gordon.json?.filterOptions ?? {}))
  console.log('filterOptions:', JSON.stringify(gordon.json?.filterOptions).slice(0, 2000))

  const botPasses = (bot.json?.passes ?? []).filter((pass) => Number(pass.earned) > 0)
  botPasses.sort((a, b) => Number(b.earned) - Number(a.earned))
  console.log('\nbot pass keys:', Object.keys(botPasses[0] ?? {}))
  console.log('\ntop bot passes by earned:')
  for (const pass of botPasses.slice(0, 12)) {
    console.log(
      JSON.stringify({
        sport: pass.sport,
        season: pass.season,
        seasonDisplay: pass.seasonDisplay,
        entityType: pass.entityType,
        entityId: pass.entityId,
        label: pass.label,
        earned: pass.earned,
        serialNumber: pass.serialNumber,
        boostInfo: pass.boostInfo,
      }),
    )
  }
}

function findPass(passes, sport, season, entityType, entityId) {
  return passes.find(
    (pass) =>
      pass.sport === sport &&
      String(pass.season) === String(season) &&
      pass.entityType === entityType &&
      String(pass.entityId) === String(entityId),
  )
}

function earningsPath(sport, season, entityType, entityId) {
  return `/userpassearnings/${sport}/season/${season}/entity/${entityType}/${entityId}`
}

function summarizeEarnings(label, result) {
  console.log(`\n=== ${label}${result.search ? ` ${result.search}` : ''}: status ${result.status}`)
  if (!result.json) {
    console.log('non-JSON snippet:', result.snippet)
    return null
  }
  console.log('top-level keys:', Object.keys(result.json))
  const arrayKey = Object.keys(result.json).find((key) => Array.isArray(result.json[key]))
  const rows = arrayKey ? result.json[arrayKey] : []
  console.log('array key:', arrayKey, 'row count:', rows.length)
  for (const [key, value] of Object.entries(result.json)) {
    if (Array.isArray(value)) continue
    console.log(`  ${key}:`, JSON.stringify(value)?.slice(0, 400))
  }
  if (rows.length > 0) {
    console.log('row keys:', Object.keys(rows[0]))
    console.log('first rows:')
    for (const row of rows.slice(0, 5)) console.log(' ', JSON.stringify(row))
    console.log('last row:', JSON.stringify(rows[rows.length - 1]))
    const sum = rows.reduce((total, row) => total + Number(row.earnings ?? 0), 0)
    console.log('sum of earnings:', sum)
    const days = rows.map((row) => row.day).filter(Boolean)
    console.log('day range:', days[0], '->', days[days.length - 1])
  }
  return rows
}

async function phaseEarnings(cfg, args) {
  const botPasses = readCache('bot-passes').json.passes ?? []
  const gordonPasses = readCache('gordon-passes').json.passes ?? []

  const targets = []
  if (args.length >= 4) {
    targets.push({ label: 'cli target', spec: args.slice(0, 4) })
  } else {
    const ranked = botPasses
      .filter((pass) => Number(pass.earned) > 0)
      .sort((a, b) => Number(b.earned) - Number(a.earned))
    for (const pass of ranked.slice(0, 3)) {
      targets.push({
        label: `bot-owned ${pass.sport} ${pass.season} ${pass.entityType} ${pass.entityId} (${pass.label}, ${pass.boostInfo?.rarityLabel}, ${pass.boostInfo?.multiplier}, earned=${pass.earned})`,
        spec: [pass.sport, pass.season, pass.entityType, pass.entityId],
      })
    }
    targets.push({ label: 'gordon-owned soccer 2025 player 551 (bot does NOT own)', spec: ['soccer', '2025', 'player', '551'] })
  }

  const results = {}
  for (const target of targets) {
    const [sport, season, entityType, entityId] = target.spec
    const result = await get(cfg, earningsPath(sport, season, entityType, entityId))
    results[target.spec.join('|')] = result
    summarizeEarnings(target.label, result)
    const owned = findPass(botPasses, sport, season, entityType, entityId)
    if (owned) {
      console.log(
        'owning pass:',
        JSON.stringify({ earned: owned.earned, boostInfo: owned.boostInfo, serialNumber: owned.serialNumber }),
      )
    } else {
      const g = findPass(gordonPasses, sport, season, entityType, entityId)
      console.log('not in bot list; gordon copy:', JSON.stringify(g ? { earned: g.earned, boostInfo: g.boostInfo } : null))
    }
  }
  writeCache('earnings', results)
}

async function phaseDaily(cfg, args) {
  const day = args[0] ?? new Date().toISOString().slice(0, 10)
  const endpoints = [
    `/userpassearnings/day/${day}?before=0`,
  ]

  for (const endpoint of endpoints) {
    const result = await get(cfg, endpoint)
    if (endpoint.startsWith('/userpassearnings')) writeCache(`daily-${day}`, result)
    const { key, rows } = findArrayField(result.json)
    console.log(`endpoint=${endpoint} status=${result.status}`)
    console.log('top-level keys:', Object.keys(result.json ?? {}))
    console.log('array:', key, 'length:', rows.length)
    console.log('row keys:', Object.keys(rows[0] ?? {}))
    if (endpoint.startsWith('/userpassearnings')) {
      console.log('userPass keys:', Object.keys(rows[0]?.userPass ?? {}))
      console.log('info row keys:', Object.keys(rows[0]?.infos?.[0] ?? {}))
    } else {
      console.log('feed info keys:', Object.keys(result.json?.info ?? {}))
      console.log('additionalInfo keys:', Object.keys(rows[0]?.additionalInfo ?? {}))
      console.log('display keys:', Object.keys(rows[0]?.display ?? {}))
    }
  }
}

async function phaseParams(cfg, args) {
  const [sport, season, entityType, entityId, cutoff = '2026-01-01', boxScoreId = '1'] = args
  const base = earningsPath(sport, season, entityType, entityId)
  const variants = [
    { name: 'before ISO', query: { before: `${cutoff}T00:00:00.000Z` } },
    { name: 'before date', query: { before: cutoff } },
    { name: 'after date', query: { after: cutoff } },
    { name: 'level', query: { level: 1 } },
    { name: 'playerBoxScoreId', query: { playerBoxScoreId: boxScoreId } },
  ]
  for (const variant of variants) {
    const result = await get(cfg, base, variant.query)
    summarizeEarnings(variant.name, result)
  }
}

/** `level` makes Real return the rarity-boosted figure alongside the base one. */
async function phaseLevels(cfg, args) {
  const [sport, season, entityType, entityId, ...levels] = args
  const base = earningsPath(sport, season, entityType, entityId)
  for (const level of levels) {
    const result = await get(cfg, base, { level })
    if (!result.json) {
      console.log(`level=${level}: status ${result.status}`, result.snippet)
      continue
    }
    const rows = result.json.earnings ?? []
    const ratios = rows
      .slice(0, 6)
      .map((row) => `${row.earnings}->${row.atRarityEarnings} (x${(Number(row.atRarityEarnings) / Number(row.earnings)).toFixed(3)})`)
    console.log(
      `level=${level}: status ${result.status} info=${JSON.stringify(result.json.info)} sample=${ratios.join(' ')}`,
    )
  }
}

async function phasePagination(cfg) {
  const variants = [
    { name: 'limit=10', query: { limit: 10 } },
    { name: 'offset=1200', query: { offset: 1200 } },
    { name: 'limit=10&offset=10', query: { limit: 10, offset: 10 } },
  ]
  for (const variant of variants) {
    const result = await get(cfg, `/userpasses/${GORDON_USER_ID}/passes`, variant.query)
    summarizePasses(`gordon passes ${variant.name}`, result)
  }
}

async function phaseToday(cfg, args) {
  const userId = args[0] ?? GORDON_USER_ID
  const sport = args[1] ?? 'nfl'
  const season = args[2] ?? 2026
  for (const filter of ['playstoday', 'playstomorrow']) {
    const result = await get(cfg, `/userpasses/${userId}/passes`, {
      filter,
      entityType: 'player',
      sport,
      season,
    })
    const passes = Array.isArray(result.json?.passes) ? result.json.passes : []
    console.log(JSON.stringify({
      filter,
      status: result.status,
      count: passes.length,
      playerCount: passes.filter((pass) => pass.entityType === 'player').length,
      activeCount: passes.filter((pass) => pass.isActive === true).length,
      boostedCount: passes.filter((pass) => pass.boostInfo?.isCardBoosted === true).length,
      sample: passes.slice(0, 3).map((pass) => ({
        keys: Object.keys(pass),
        id: pass.id,
        sport: pass.sport,
        season: pass.season,
        entityType: pass.entityType,
        entityId: pass.entityId,
        label: pass.label,
        teamId: pass.teamId,
        entity: pass.entity,
        boostInfo: pass.boostInfo,
        boosterCardInfo: pass.boosterCardInfo,
      })),
    }, null, 2))
    writeCache(`${filter}-${userId}`, result)
  }
}

async function phaseBox(cfg, args) {
  const playerBoxScoreId = args[0]
  if (!playerBoxScoreId) throw new Error('player box score id is required')
  const result = await get(cfg, `/playerboxscores/${playerBoxScoreId}`, { version: 2 })
  const light = await get(cfg, `/playerboxscores/${playerBoxScoreId}/light`)
  const box = result.json?.playerBoxScore ?? {}
  console.log(JSON.stringify({
    status: result.status,
    topLevelKeys: Object.keys(result.json ?? {}),
    boxKeys: Object.keys(box),
    id: box.id,
    sport: box.sport,
    day: box.day,
    value: box.value,
    statValues: box.statValues,
    statValueDisplays: box.statValueDisplays,
    advancedStatValueDisplays: box.advancedStatValueDisplays,
    topStats: box.topStats,
    advancedStats: result.json?.advancedStats,
    lightStatus: light.status,
    lightKeys: Object.keys(light.json?.playerBoxScore ?? {}),
    lightStatValues: light.json?.playerBoxScore?.statValues,
  }, null, 2))
  writeCache(`playerbox-${playerBoxScoreId}`, result)
}

async function phaseBooster(cfg, args) {
  const [userPassId, userId = GORDON_USER_ID, entityType = 'player', sport = 'nfl'] = args
  if (!userPassId) throw new Error('user pass id is required')
  const result = await get(cfg, `/userpassboostercards/${userPassId}/entity/${entityType}`, {
    userId,
    sport,
    displayType: 'earnings',
    version: 'stat',
  })
  console.log(JSON.stringify({
    status: result.status,
    boosterCardInfo: result.json?.boosterCardInfo,
  }, null, 2))
}

async function phaseHome(cfg, args) {
  const [sport = 'nfl', day = new Date().toISOString().slice(0, 10)] = args
  const result = await get(cfg, `/home/${sport}/day/next`, { day })
  const content = result.json?.content ?? {}
  const games = [...(content.games ?? []), ...(content.replayGames ?? [])]
  console.log(JSON.stringify({
    status: result.status,
    contentKeys: Object.keys(content),
    games: games.map((game) => ({
      id: game.id,
      sport: game.sport,
      day: game.day,
      status: game.status,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
    })),
  }, null, 2))
  writeCache(`home-${sport}-${day}`, result)
}

async function phaseGameStats(cfg, args) {
  const [sport, gameId] = args
  if (!sport || !gameId) throw new Error('sport and game id are required')
  const result = await get(cfg, `/games/${gameId}/sport/${sport}/stats`)
  const rows = Array.isArray(result.json?.playerBoxScores) ? result.json.playerBoxScores : []
  console.log(JSON.stringify({
    status: result.status,
    keys: Object.keys(result.json ?? {}),
    count: rows.length,
    playerBoxScoreKeys: Object.keys(rows[0] ?? {}),
    sample: rows.slice(0, 3).map((row) => ({
      id: row.id,
      playerId: row.playerId,
      value: row.value,
      status: row.status,
      statValues: row.statValues,
    })),
  }, null, 2))
  writeCache(`game-stats-${sport}-${gameId}`, result)
}

function phaseSeasons() {
  const passes = readCache('gordon-passes').json.passes ?? []
  const map = new Map()
  for (const pass of passes) {
    const key = `${pass.sport}|${pass.season}`
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(String(pass.seasonDisplay))
  }
  console.log('total passes:', passes.length, 'distinct sport|season:', map.size)
  for (const key of [...map.keys()].sort()) {
    console.log(key, '=>', [...map.get(key)].join(' , '))
  }
  const entityTypes = new Set(passes.map((pass) => pass.entityType))
  console.log('entityTypes:', [...entityTypes])
}

function shopPath(sport, season, entityType) {
  return `/userpassshop/${sport}/season/${season}/entity/${entityType}/section/earningstotal`
}

/** Redact obvious auth/user secrets; keep all game/catalog fields. */
function redactShopValue(key, value) {
  const lower = String(key).toLowerCase()
  if (
    /token|secret|password|auth|session|cookie|authorization|deviceuuid|device-uuid/.test(lower)
  ) {
    return typeof value === 'string' && value.length > 0 ? `[redacted len=${value.length}]` : '[redacted]'
  }
  return value
}

function redactShopItem(item) {
  if (item == null || typeof item !== 'object') return item
  if (Array.isArray(item)) return item.map(redactShopItem)
  const out = {}
  for (const [key, value] of Object.entries(item)) {
    if (value != null && typeof value === 'object') out[key] = redactShopItem(value)
    else out[key] = redactShopValue(key, value)
  }
  return out
}

function findArrayField(json) {
  if (!json || typeof json !== 'object') return { key: null, rows: [] }
  for (const [key, value] of Object.entries(json)) {
    if (Array.isArray(value)) return { key, rows: value }
  }
  return { key: null, rows: [] }
}

function itemIdentity(item) {
  if (!item || typeof item !== 'object') return null
  return (
    item.entityId ??
    item.entity_id ??
    item.id ??
    item.passId ??
    item.playerId ??
    item.teamId ??
    null
  )
}

function earningsTotalOf(item) {
  if (!item || typeof item !== 'object') return null
  for (const key of [
    'value', // shop earningstotal section uses string `value`
    'earned',
    'earnings',
    'totalEarnings',
    'total',
    'earningstotal',
    'earningsTotal',
    'baseRax',
    'totalBaseRax',
    'rax',
  ]) {
    if (item[key] !== undefined && item[key] !== null) return Number(item[key])
  }
  return null
}

function summarizeShopPage(label, result) {
  console.log(`\n=== ${label}: status ${result.status}`)
  if (!result.json) {
    console.log('non-JSON snippet:', result.snippet)
    return null
  }
  console.log('top-level keys:', Object.keys(result.json))
  for (const [key, value] of Object.entries(result.json)) {
    if (Array.isArray(value)) continue
    const preview = typeof value === 'object' ? JSON.stringify(value)?.slice(0, 500) : value
    console.log(`  ${key}:`, preview)
  }
  const { key, rows } = findArrayField(result.json)
  console.log('array key:', key, 'length:', rows.length)
  if (rows.length === 0) return { key, rows, ids: [], totals: [] }
  console.log('item keys:', Object.keys(rows[0]))
  console.log('sample items (full, secrets redacted):')
  for (const item of rows.slice(0, 3)) {
    console.log(JSON.stringify(redactShopItem(item), null, 2))
  }
  const ids = rows.map(itemIdentity)
  const totals = rows.map(earningsTotalOf)
  console.log('identity sample:', ids.slice(0, 5))
  console.log('totals sample:', totals.slice(0, 5))
  console.log(
    'totals monotonic desc?:',
    totals.every((t, i) => i === 0 || t == null || totals[i - 1] == null || totals[i - 1] >= t),
  )
  return { key, rows, ids, totals }
}

function fieldInventory(rows) {
  const wanted = {
    entityId: ['entityId', 'entity_id', 'id', 'playerId', 'teamId'],
    season: ['season', 'seasonYear', 'season_year'],
    sport: ['sport'],
    label: ['label', 'name', 'displayName', 'title'],
    totalEarnings: [
      'value',
      'earned',
      'earnings',
      'totalEarnings',
      'total',
      'earningstotal',
      'earningsTotal',
      'baseRax',
      'totalBaseRax',
      'rax',
    ],
    rarity: ['rarity', 'rarityLabel', 'boostInfo'],
    dailyRows: ['earnings', 'days', 'daily', 'dailyEarnings', 'history', 'rows'],
    avatar: ['avatar', 'avatarUrl', 'image', 'imageUrl', 'photo', 'photoUrl', 'headshot'],
    entityType: ['entityType', 'entity_type', 'type'],
    seasonDisplay: ['seasonDisplay', 'season_label', 'seasonLabel'],
  }
  const present = {}
  for (const [group, keys] of Object.entries(wanted)) {
    const hits = new Set()
    for (const row of rows.slice(0, 5)) {
      for (const key of keys) {
        if (row && Object.prototype.hasOwnProperty.call(row, key) && row[key] != null) {
          hits.add(key)
        }
      }
      // nested daily-looking arrays
      if (group === 'dailyRows') {
        for (const [k, v] of Object.entries(row ?? {})) {
          if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
            const sampleKeys = Object.keys(v[0])
            if (sampleKeys.some((sk) => /day|date|earn/i.test(sk))) hits.add(`${k}[]`)
          }
        }
      }
    }
    present[group] = [...hits]
  }
  console.log('\nfield inventory (present keys by concern):', JSON.stringify(present, null, 2))
  return present
}

async function phaseShop(cfg, args) {
  const sport = args[0] ?? 'ncaam'
  const season = args[1] ?? '2026'
  const entityType = args[2] ?? 'player'

  const page0 = await get(cfg, shopPath(sport, season, entityType), { before: 0 })
  writeCache(`shop-${sport}-${season}-${entityType}-0`, page0)
  const s0 = summarizeShopPage(`${sport}/${season}/${entityType} before=0`, page0)

  const page20 = await get(cfg, shopPath(sport, season, entityType), { before: 20 })
  writeCache(`shop-${sport}-${season}-${entityType}-20`, page20)
  const s20 = summarizeShopPage(`${sport}/${season}/${entityType} before=20`, page20)

  if (s0 && s20) {
    const overlap = s0.ids.filter((id) => id != null && s20.ids.includes(id))
    console.log('\npagination check:')
    console.log('  page0 len:', s0.rows.length, 'page20 len:', s20.rows.length)
    console.log('  overlapping identities:', overlap.length, overlap.slice(0, 5))
    console.log('  page0 last id:', s0.ids[s0.ids.length - 1], 'page20 first id:', s20.ids[0])
    console.log(
      '  continuity:',
      overlap.length === 0
        ? 'no overlap (clean page boundary)'
        : overlap.length === s0.rows.length
          ? 'FULL overlap (before ignored or same page)'
          : 'partial overlap',
    )
    if (s0.totals.length && s20.totals.length) {
      console.log('  page0 last total:', s0.totals[s0.totals.length - 1], 'page20 first total:', s20.totals[0])
    }
  }

  if (s0?.rows?.length) fieldInventory(s0.rows)

  // Live / updating seasons: MLB calendar year + soccer/FC teams
  const year = new Date().getFullYear()
  const extras = [
    { sport: 'mlb', season: String(year), entityType: 'player', before: 0 },
    { sport: 'mlb', season: String(year), entityType: 'team', before: 0 },
    { sport: 'soccer', season: String(year - 1), entityType: 'team', before: 0 },
    { sport: 'soccer', season: String(year), entityType: 'team', before: 0 },
    { sport: 'cbb', season: '2026', entityType: 'player', before: 0 },
    { sport: 'ncaab', season: '2026', entityType: 'player', before: 0 },
  ]
  const extraResults = {}
  for (const extra of extras) {
    const result = await get(cfg, shopPath(extra.sport, extra.season, extra.entityType), {
      before: extra.before,
    })
    extraResults[`${extra.sport}|${extra.season}|${extra.entityType}`] = {
      status: result.status,
      keys: result.json ? Object.keys(result.json) : null,
      array: findArrayField(result.json),
      snippet: result.json ? undefined : result.snippet,
    }
    const { key, rows } = findArrayField(result.json)
    console.log(
      `\nextra ${extra.sport}/${extra.season}/${extra.entityType} before=${extra.before}: status ${result.status} array=${key} len=${rows.length}`,
    )
    if (rows[0]) {
      console.log('  first item keys:', Object.keys(rows[0]))
      console.log('  first item:', JSON.stringify(redactShopItem(rows[0])).slice(0, 800))
    } else if (!result.json) {
      console.log('  snippet:', result.snippet)
    }
  }
  writeCache('shop-extras', extraResults)

  // Last-page sniff: jump far ahead
  const far = await get(cfg, shopPath(sport, season, entityType), { before: 20000 })
  const farArr = findArrayField(far.json)
  console.log(
    `\nlast-page sniff before=20000: status ${far.status} array=${farArr.key} len=${farArr.rows.length}`,
  )
  writeCache(`shop-${sport}-${season}-${entityType}-far`, far)
}

/**
 * Probe candidate endpoints for per-play / boost-history ratings on an owned pass.
 * Usage: node scripts/probe-real.mjs plays [sport season entityType entityId]
 */
async function phasePlays(cfg, args) {
  let sport
  let season
  let entityType
  let entityId
  let passId
  let boostInfo

  if (args.length >= 4) {
    ;[sport, season, entityType, entityId] = args
  } else {
    let passes = []
    try {
      passes = readCache('bot-passes').json?.passes ?? []
    } catch {
      const bot = await get(cfg, `/userpasses/${cfg.botUserId}/passes`)
      writeCache('bot-passes', bot)
      passes = bot.json?.passes ?? []
    }
    const ranked = passes
      .filter(
        (pass) =>
          String(pass.entityType ?? '').toLowerCase() === 'player' &&
          pass.boostInfo &&
          Number(pass.boostInfo.progress) > 0,
      )
      .sort((a, b) => Number(b.boostInfo?.progress ?? 0) - Number(a.boostInfo?.progress ?? 0))
    const pick = ranked[0]
    if (!pick) {
      console.error('No player pass with boost progress found in bot cache.')
      return
    }
    sport = pick.sport
    season = pick.season
    entityType = pick.entityType
    entityId = pick.entityId
    passId = pick.id
    boostInfo = pick.boostInfo
    console.log(
      'using pass:',
      JSON.stringify({
        label: pick.label,
        sport,
        season,
        entityType,
        entityId,
        passId,
        boostInfo,
      }),
    )
  }

  const userId = cfg.botUserId
  const candidates = [
    `/userpassplays/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpassplayratings/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpassboost/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpassboosthistory/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpassboostrating/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpassratings/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpassratinghistory/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpassmoments/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpasspacks/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/userpassearnings/${sport}/season/${season}/entity/${entityType}/${entityId}/plays`,
    `/userpasses/${userId}/pass/${passId ?? entityId}/plays`,
    `/userpasses/${userId}/passes/${passId ?? entityId}/plays`,
    `/userpasses/${userId}/plays`,
    `/plays/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/playratings/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/boost/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/boosthistory/${sport}/season/${season}/entity/${entityType}/${entityId}`,
    `/pass/${passId ?? entityId}/plays`,
    `/pass/${passId ?? entityId}/boost`,
    `/userpass/${passId ?? entityId}/plays`,
    `/userpass/${sport}/${season}/${entityType}/${entityId}/plays`,
    `/userpassshop/${sport}/season/${season}/entity/${entityType}/section/plays`,
    `/userpassshop/${sport}/season/${season}/entity/${entityType}/section/rating`,
    `/userpassshop/${sport}/season/${season}/entity/${entityType}/section/boost`,
    `/userpassshop/${sport}/season/${season}/entity/${entityType}/${entityId}/section/plays`,
    `/collecting/${sport}/season/${season}/entity/${entityType}/${entityId}/plays`,
    `/user/${userId}/plays`,
    `/user/${userId}/boostrating`,
  ]

  const hits = []
  for (const urlPath of candidates) {
    if (urlPath.includes('undefined')) {
      console.log(`skip (undefined segment): ${urlPath}`)
      continue
    }
    const result = await get(cfg, urlPath)
    const { key, rows } = findArrayField(result.json)
    const ok = result.status >= 200 && result.status < 300 && result.json
    console.log(
      `${ok ? 'HIT' : 'miss'} ${result.status} ${urlPath}` +
        (ok ? ` keys=${Object.keys(result.json).join(',')} array=${key} len=${rows.length}` : ''),
    )
    if (!ok && result.snippet) console.log('  ', result.snippet.slice(0, 120))
    if (ok) {
      hits.push({ urlPath, status: result.status, keys: Object.keys(result.json), arrayKey: key, rowCount: rows.length })
      if (rows[0]) {
        console.log('  row keys:', Object.keys(rows[0]))
        console.log('  first row:', JSON.stringify(rows[0]).slice(0, 600))
      } else {
        console.log('  body preview:', JSON.stringify(result.json).slice(0, 800))
      }
      writeCache(`plays-hit-${urlPath.replace(/[^\w.-]+/g, '_')}`, result)
    }
  }

  // Also dump full boostInfo + any rating-ish keys on the pass itself.
  const fresh = await get(cfg, `/userpasses/${userId}/passes`)
  const match = (fresh.json?.passes ?? []).find(
    (pass) =>
      String(pass.sport) === String(sport) &&
      String(pass.season) === String(season) &&
      String(pass.entityType) === String(entityType) &&
      String(pass.entityId) === String(entityId),
  )
  console.log('\nmatched pass full object keys:', match ? Object.keys(match) : null)
  console.log('matched pass boostInfo:', JSON.stringify(match?.boostInfo ?? boostInfo))
  console.log('matched pass rating-ish fields:', JSON.stringify(match ? {
    boostInfo: match.boostInfo,
    playRating: match.playRating,
    rating: match.rating,
    plays: match.plays,
    playCount: match.playCount,
    moments: match.moments,
    packOpens: match.packOpens,
  } : null))

  writeCache('plays-probe-summary', { sport, season, entityType, entityId, passId, hits, matchBoost: match?.boostInfo })
  console.log('\nHIT count:', hits.length)
}

async function main() {
  loadEnvLocal()
  const cfg = config()
  console.log('credentials loaded:', {
    authInfo: cfg.authInfo.length > 0,
    sessionToken: cfg.sessionToken.length > 0,
    deviceUuid: cfg.deviceUuid.length > 0,
    deviceName: cfg.deviceName.length > 0,
    botUserIdLength: cfg.botUserId.length,
  })

  const [phase, ...args] = process.argv.slice(2)
  if (phase === 'passes') await phasePasses(cfg)
  else if (phase === 'earnings') await phaseEarnings(cfg, args)
  else if (phase === 'daily') await phaseDaily(cfg, args)
  else if (phase === 'params') await phaseParams(cfg, args)
  else if (phase === 'levels') await phaseLevels(cfg, args)
  else if (phase === 'pagination') await phasePagination(cfg)
  else if (phase === 'today') await phaseToday(cfg, args)
  else if (phase === 'box') await phaseBox(cfg, args)
  else if (phase === 'booster') await phaseBooster(cfg, args)
  else if (phase === 'home') await phaseHome(cfg, args)
  else if (phase === 'game-stats') await phaseGameStats(cfg, args)
  else if (phase === 'seasons') phaseSeasons()
  else if (phase === 'shop') await phaseShop(cfg, args)
  else if (phase === 'plays') await phasePlays(cfg, args)
  else console.error('unknown phase')
}

await main()
