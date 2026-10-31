import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('does not schedule retired earnings snapshot endpoints', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  expect(config.crons.filter((job: { path: string }) => job.path.startsWith('/api/cron/snapshot-earnings'))).toEqual([])
})

it('does not reserve function overrides for retired earnings workers', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  expect(Object.keys(config.functions).filter(path => path === 'api/account/earnings.ts' || path.startsWith('api/cron/snapshot-earnings'))).toEqual([])
})

it('keeps the archived GitHub Actions snapshot job disabled', () => {
  const workflow = readFileSync('.github/workflows/earnings-snapshot.yml', 'utf8')
  expect(workflow).toMatch(/snapshot:\s*\n(?:[ \t]*#[^\n]*\n)*[ \t]+if:\s*\$\{\{\s*false\s*\}\}/)
})
