import { expect, it } from 'vitest'
import { remainingTestArgs } from './test-ci-remaining.mjs'

it('excludes exactly the deployment-gate files while retaining normal Vitest discovery', () => {
  expect(remainingTestArgs('vitest run lib/guard.test.ts src/pages/Login.test.tsx')).toEqual([
    'run', '--exclude', 'lib/guard.test.ts', '--exclude', 'src/pages/Login.test.tsx',
  ])
})

it.each(['vitest run', 'node scripts/another-runner.mjs', 'vitest run --project gate', 'vitest run lib/*.test.ts'])('refuses an ambiguous gate command instead of silently skipping coverage: %s', command => {
  expect(() => remainingTestArgs(command)).toThrow(/explicit test files/i)
})
