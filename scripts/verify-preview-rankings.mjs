// Compare saved, normally-authenticated browser probe output with the same local
// core and recorded inputs. This reads private local files; it makes no API calls.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const files = process.argv.slice(2)
if (!files.length || files.some((file) => !/^\.benchmarks\/ranking-preview-[a-z0-9_-]+\.json$/i.test(file))) {
  throw new Error('Pass saved .benchmarks/ranking-preview-<name>.json files.')
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' })
const nativeFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Offline verification must not make network requests.') }
globalThis.window ??= { setTimeout, clearTimeout }
try {
  const { normalizeData } = await server.ssrLoadModule('/src/lib/storage.ts')
  const rank = await server.ssrLoadModule('/src/lib/passRecommendation.ts')
  const fixture = JSON.parse(await fs.readFile('.benchmarks/gordon.json', 'utf8'))
  const data = normalizeData(fixture.data ?? fixture)
  const { profiles } = JSON.parse(await fs.readFile('.benchmarks/all-sport-ranking-pool.json', 'utf8'))
  const results = []
  for (const file of files) {
    const report = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(report.mode, 'deployed-browser-recorded-pool')
    assert.equal(report.cards, data.cards.length)
    assert.equal(report.rows, data.performances.length)
    assert.equal(report.samples.length, 6, 'A partial browser run is not a complete probe.')
    const requested = report.samples[0].requested
    const pool = profiles.filter((profile) => report.sports.includes(profile.sport))
    assert.equal(report.pool, pool.length)
    const result = await rank.rankAndRecommendAsync(data, pool, requested, {
      caps: rank.recommendationCapsForSports(report.sports),
      excludedSportSeasonKeys: rank.defaultRankExcludedSportSeasonKeys(),
    })
    const expected = {
      requested, actual: result.bundle.picks.length, analyzed: result.ranked.analyzedCount,
      trimmed: result.ranked.prefilterTrimmed, rankingHash: digest(result.ranked.rows),
      picksHash: digest(result.bundle.picks), gain: result.bundle.combinedNetDelta,
      guaranteedGain: result.bundle.picks.reduce((sum, pick) => sum + pick.netGuaranteedDelta, 0),
    }
    for (const sample of report.samples) {
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(sample[key], value, `${file}: sample ${sample.iteration}, ${key}`)
    }
    results.push({ file, sports: report.sports, samples: report.samples.length, ...expected, parity: true })
  }
  await fs.writeFile('.benchmarks/preview-ranking-verification.json', JSON.stringify({ verifiedAt: new Date().toISOString(), results }, null, 2))
  console.log(JSON.stringify({ results }, null, 2))
} finally {
  globalThis.fetch = nativeFetch
  await server.close()
}
