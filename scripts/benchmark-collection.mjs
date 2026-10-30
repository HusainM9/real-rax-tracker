/** Isolated import/CPU benchmark: never writes a browser profile or account data.
 * Live mode uses the existing local API, including its normal shared-catalog cache writes.
 * Private response fixtures/results stay in ignored .benchmarks/, with no credentials.
 * Usage: npm run bench:collection -- gordon [--live] [--label before]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const username = args[0] || 'gordon'
if (!/^[a-z0-9_.-]{1,64}$/i.test(username)) throw new Error('Use a valid username.')
const live = args.includes('--live')
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'current'
if (!/^[a-z0-9_-]+$/i.test(label)) throw new Error('Use a simple report label.')
const directory = path.resolve('.benchmarks')
const fixturePath = path.join(directory, `${username}.json`)
const baseUrl = 'http://127.0.0.1:5174'
const nativeFetch = globalThis.fetch
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' })
globalThis.window ??= { setTimeout, clearTimeout }
try {
  const { importFromUsername } = await server.ssrLoadModule('/src/lib/usernameImport.ts')
  const { createEmptyData } = await server.ssrLoadModule('/src/lib/storage.ts')
  const claims = await server.ssrLoadModule('/src/lib/claimOptimizer.ts')
  const ranking = await server.ssrLoadModule('/src/lib/passRecommendation.ts')
  const fixture = live ? { responses: [] } : JSON.parse(await fs.readFile(fixturePath, 'utf8'))
  const requests = []
  const responseByKey = new Map(fixture.responses.map((entry) => [entry.key, entry]))
  globalThis.fetch = async (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api/')) throw new Error('Benchmark only permits local app API requests.')
    const key = `${init?.method || 'GET'} ${input} ${init?.body || ''}`
    if (args.includes('--legacy-batches') && JSON.parse(init?.body || '{}').cacheOnly) {
      return Response.json({ error: 'Benchmarking the pre-probe batch path.' }, { status: 400 })
    }
    const started = performance.now()
    let entry
    if (live) {
      const response = await nativeFetch(`${baseUrl}${input}`, init)
      const body = await response.text()
      entry = { key, status: response.status, body }
      fixture.responses.push(entry)
    } else {
      entry = responseByKey.get(key)
      if (!entry) throw new Error(`Fixture missing request for ${input.split('?')[0]}. Capture a new live fixture.`)
    }
    requests.push({ route: input.split('?')[0], ms: performance.now() - started, status: entry.status })
    return new Response(entry.body, { status: entry.status, headers: { 'content-type': 'application/json' } })
  }
  let lastProgress = 0
  let importFinished = false
  const started = performance.now()
  const imported = await importFromUsername(createEmptyData(), username, {
    signal: AbortSignal.timeout(240_000),
    onProgress: (progress) => {
      if (importFinished) return
      if (performance.now() - lastProgress < 2000) return
      lastProgress = performance.now()
      console.log(JSON.stringify({ phase: progress.phase, completed: progress.current, total: progress.total, elapsedMs: Math.round(performance.now() - started) }))
    },
  })
  const importMs = performance.now() - started
  importFinished = true
  const data = imported.data
  // Real imported pass profiles, not invented opponents. The ranker may exclude owned Iconics.
  const profiles = data.cards.map((card) => {
    const rows = data.performances.filter((row) => row.cardId === card.id).map((row) => ({ claimDay: row.claimDay, baseRaxEarned: row.baseRaxEarned ?? row.raxEarned }))
    return { externalKey: card.externalKey, entityId: Number(card.externalKey?.split('|')[0]), seasonYear: Number(card.externalKey?.split('|')[1]), sport: card.sport, passKind: card.passKind, name: card.name, seasonLabel: card.season, avatar: card.avatar, cachedAt: '2026-10-30T00:00:00Z', rowCount: rows.length, totalBaseRax: rows.reduce((sum, row) => sum + row.baseRaxEarned, 0), rows }
  }).filter((profile) => profile.rows.length > 0)
  const timings = {}
  for (const [name, fn] of Object.entries({
    claimDays: () => claims.computeClaimDayResults(data),
    yearRollup: () => claims.computeYearRollup(data),
    rank100: () => ranking.rankCatalogRecommendations(data, profiles, { analysisCap: 100 }),
    month100: () => ranking.rankCatalogRecommendationsForMonth(data, profiles, 9, { analysisCap: 100 }),
    upgrades15: () => ranking.analyzeOwnedIconicUpgradeImpacts(data, data.cards.slice(0, 15).map((card) => ({ key: card.id, name: card.name, sport: card.sport, season: card.season, card }))),
  })) {
    const samples = []
    let result
    for (let index = 0; index < 6; index++) { const begin = performance.now(); result = fn(); samples.push(performance.now() - begin) }
    const warm = samples.slice(1).sort((a, b) => a - b)
    timings[name] = { firstMs: samples[0], medianMs: warm[2], maxMs: warm[4], rows: result?.rows?.length ?? result?.length }
    console.log(JSON.stringify({ benchmark: name, ...timings[name] }))
  }
  const report = { username, mode: live ? 'live-local-api' : 'recorded-network-replay', measuredAt: new Date().toISOString(), importMs, cards: data.cards.length, performances: data.performances.length, backfill: imported.result.dailyRaxBackfill, failures: imported.result.passFetchErrors.length, noEarnings: imported.result.passesWithNoEarnings.length, requests, timings }
  await fs.mkdir(directory, { recursive: true })
  if (live) { fixture.data = data; fixture.capturedAt = report.measuredAt; await fs.writeFile(fixturePath, JSON.stringify(fixture)) }
  await fs.writeFile(path.join(directory, `${username}-${label}.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Benchmark failed.' }))
  process.exitCode = 1
} finally {
  globalThis.fetch = nativeFetch
  await server.close()
}
