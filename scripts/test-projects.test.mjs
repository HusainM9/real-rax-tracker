import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverTestProjects } from './test-projects.mjs'

const roots = []
// Build fixture annotations without annotating this Node test itself.
const environment = name => '@vitest-' + 'environment ' + name
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('rax-test-projects-')) throw new Error('Unsafe fixture cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})
function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rax-test-projects-'))
  roots.push(root)
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), source)
  }
  return root
}

it('discovers a newly added test exactly once and separates browser facilities from Node tests', () => {
  const root = fixture({
    'lib/domain.test.ts': '',
    'lib/future.spec.ts': '',
    'src/browser.test.ts': '// ' + environment('jsdom') + '\r\n',
    'src/block.test.tsx': '/** ' + environment('jsdom') + ' */\n',
    'api/handler.test.ts': '// ' + environment('node') + '\n',
    'scripts/check.test.mjs': '',
    'src/domain.ts': '',
    'node_modules/package/ignored.test.ts': '',
  })
  expect(discoverTestProjects(root)).toEqual({
    unit: ['api/handler.test.ts', 'lib/domain.test.ts', 'lib/future.spec.ts', 'scripts/check.test.mjs'],
    ui: ['src/block.test.tsx', 'src/browser.test.ts'], integration: [],
  })
  writeFileSync(path.join(root, 'lib/new.test.ts'), '')
  expect(discoverTestProjects(root).unit).toEqual([
    'api/handler.test.ts', 'lib/domain.test.ts', 'lib/future.spec.ts', 'lib/new.test.ts', 'scripts/check.test.mjs',
  ])
})

it('keeps integration files outside the unit/UI service substitutes even with a browser annotation', () => {
  const root = fixture({
    'tests/integration/account.test.ts': '',
    'tests/integration/browser.test.tsx': '// ' + environment('jsdom') + '\n',
    'tests/safety/guard.test.ts': '',
  })
  expect(discoverTestProjects(root)).toEqual({
    unit: ['tests/safety/guard.test.ts'], ui: [],
    integration: ['tests/integration/account.test.ts', 'tests/integration/browser.test.tsx'],
  })
})
