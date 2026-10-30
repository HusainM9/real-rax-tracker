// Private collection/catalog fixtures are read/written only in ignored .benchmarks/.
// Usage: node scripts/benchmark-ranking.mjs [--capture] [--matrix] [--reference] [--label name]
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'current'
if (!/^[a-z0-9_-]+$/i.test(label)) throw new Error('Use a simple report label.')
const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' })
globalThis.window ??= { setTimeout, clearTimeout }
const nativeFetch = globalThis.fetch
const requests = []
globalThis.fetch = async (url, init) => {
  if (typeof url !== 'string' || !url.startsWith('/api/')) throw new Error('Only local app APIs are permitted.')
  const start = performance.now()
  const response = await nativeFetch(`http://127.0.0.1:5174${url}`, init)
  const body = await response.text()
  requests.push({ route: url.split('?')[0], ms: performance.now() - start, status: response.status, bytes: Buffer.byteLength(body) })
  return new Response(body, { status: response.status, headers: response.headers })
}
try {
  const { data } = JSON.parse(await fs.readFile('.benchmarks/gordon.json', 'utf8'))
  const rank = await server.ssrLoadModule('/src/lib/passRecommendation.ts')
  const reference = await server.ssrLoadModule('/src/testing/rankingReference.ts')
  const { SPORTS } = await server.ssrLoadModule('/src/types/rax.ts')
  const api = await server.ssrLoadModule('/src/lib/catalogApi.ts')
  const sports = SPORTS.filter((sport) => sport !== 'Other')
  if (args.includes('--capture')) {
    const profiles = []
    for (const sport of sports) {
      const caps = rank.recommendationCapsForSport(sport)
      const summaries = await api.fetchCatalogPassSummaries({ sport, limit: Math.min(caps.bulkFetchCap + 250, 1500) })
      if (!summaries.storageConfigured) throw new Error('Catalog is not configured.')
      const selected = rank.selectSummariesForBulkFetch(data, summaries.results, { sport, excludedSportSeasonKeys: rank.defaultRankExcludedSportSeasonKeys() })
      const bulk = await api.fetchCatalogImportProfilesBulk(selected.keys)
      if (!bulk.storageConfigured) throw new Error('Catalog profiles unavailable.')
      profiles.push(...bulk.profiles)
      console.log(JSON.stringify({ captured: sport, summaries: summaries.results.length, profiles: bulk.profiles.length, fetchTrimmed: selected.fetchTrimmed }))
    }
    await fs.writeFile('.benchmarks/all-sport-ranking-pool.json', JSON.stringify({ profiles, requests }))
  }
  const matrix = args.includes('--matrix')
  const fixture = JSON.parse(await fs.readFile(matrix ? '.benchmarks/all-sport-ranking-pool.json' : '.benchmarks/nba-ranking-pool.json', 'utf8'))
  const combinations = args.includes('--sports') ? [args[args.indexOf('--sports') + 1].split(',')] : matrix ? [['NBA'], ['NHL'], ['NFL'], ['NBA', 'NHL'], ['NBA', 'NFL'], ['NBA', 'NHL', 'NFL'], sports.filter((sport) => sport !== 'UFC'), sports] : [['NBA']]
  const sizes = matrix ? [0, 1, 3, 5, 10, 20] : [0, 3]
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const sourceHash = digest(await Promise.all(['src/lib/importScenario.ts', 'src/lib/claimOptimizer.ts', 'src/lib/passRecommendation.ts', 'src/testing/rankingReference.ts'].map((file) => fs.readFile(file, 'utf8'))))
  const previous = args.includes('--resume') ? JSON.parse(await fs.readFile(`.benchmarks/ranking-${label}.json`, 'utf8')) : null
  if (previous && (previous.sourceHash !== sourceHash || previous.fixtureHash !== digest(fixture.profiles))) throw new Error('Cannot resume measurements from a different scorer or fixture.')
  const output = previous?.output ?? []
  for (const selectedSports of combinations) {
    const completed = (size) => output.some((row) => row.requested === size && JSON.stringify(row.sports) === JSON.stringify(selectedSports) && row.parity === true)
    if (sizes.every(completed)) continue
    const profiles = fixture.profiles.filter((profile) => selectedSports.includes(profile.sport))
    const caps = matrix ? rank.recommendationCapsForSports(selectedSports) : { bulkFetchCap: 600, analysisCap: 600, greedyRerankCap: 120 }
    const filters = matrix ? { excludedSportSeasonKeys: rank.defaultRankExcludedSportSeasonKeys() } : {}
    let expected
    const referenceCheckpoints = {}
    if (args.includes('--reference')) {
      expected = reference.rankAndRecommendReference(data, profiles, Math.max(...sizes), { ...filters, analysisCap: caps.analysisCap }, (picks, ms) => {
        referenceCheckpoints[picks] = ms
        console.log(JSON.stringify({ reference: selectedSports.join('+'), picks, ms }))
      })
    }
    for (const size of sizes) {
      if (completed(size)) continue
      const samples = []
      let result
      for (let index = 0; index < 6; index++) {
        const started = performance.now()
        result = await rank.rankAndRecommendAsync(data, profiles, size, { ...filters, caps })
        samples.push(performance.now() - started)
      }
      if (expected) {
        assert.deepEqual(result.ranked, expected.ranked)
        assert.deepEqual(result.bundle.picks, expected.bundle.picks.slice(0, size))
        assert.equal(result.bundle.combinedNetDelta, expected.bundle.picks.slice(0, size).reduce((sum, row) => sum + row.netClaimableDelta, 0))
        assert.equal(result.bundle.picks.reduce((sum, row) => sum + row.netGuaranteedDelta, 0), expected.bundle.picks.slice(0, size).reduce((sum, row) => sum + row.netGuaranteedDelta, 0))
      }
      const warm = samples.slice(1).sort((a, b) => a - b)
      const row = { sports: selectedSports, requested: size, actual: result.bundle.picks.length, pool: profiles.length, analyzed: result.ranked.analyzedCount, trimmed: result.ranked.prefilterTrimmed, skippedOwned: result.ranked.skippedOwnedIconic, skippedAdjusted: result.ranked.skippedAdjusted, skippedNoRows: result.ranked.skippedNoRows, firstMs: samples[0], medianMs: warm[2], rangeMs: [warm[0], warm[4]], referenceMs: referenceCheckpoints[size], parity: expected ? true : 'not-run', rankingHash: digest(result.ranked.rows), pickKeys: result.bundle.picks.map((pick) => pick.externalKey), gain: result.bundle.combinedNetDelta, guaranteedGain: result.bundle.picks.reduce((sum, pick) => sum + pick.netGuaranteedDelta, 0) }
      output.push(row)
      console.log(JSON.stringify(row))
      await fs.writeFile(`.benchmarks/ranking-${label}.json`, JSON.stringify({ measuredAt: new Date().toISOString(), mode: 'recorded-catalog-node-processing-wall-time', node: process.version, cpu: cpus()[0]?.model, sourceHash, warmSamples: 5, referenceSamples: 1, collectionCards: data.cards.length, collectionRows: data.performances.length, fixtureHash: digest(fixture.profiles), output }, null, 2))
    }
  }
} finally {
  globalThis.fetch = nativeFetch
  await server.close()
}
