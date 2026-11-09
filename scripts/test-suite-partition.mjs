import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverTestProjects } from './test-projects.mjs'
import { remainingTestArgs } from './test-ci-remaining.mjs'

const normalizeFile = (root, file) => path.resolve(root, file).split(path.sep).join('/')

/** Compare occurrences, not sets: parameterized cases can share a title. */
export function verifyTestPartition(parts, { root = process.cwd(), requiredGateFiles = [], expectedFiles = [] } = {}) {
  const counts = {}
  for (const name of ['full', 'gate', 'remaining']) {
    if (!Array.isArray(parts[name]) || !parts[name].length) throw new Error(`Empty ${name} test discovery`)
    const occurrences = new Map()
    for (const test of parts[name]) {
      if (!test || typeof test.file !== 'string' || !test.file || typeof test.name !== 'string' || !test.name) throw new Error('Malformed test discovery')
      const key = JSON.stringify([test.projectName ?? '', normalizeFile(root, test.file), test.name])
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
    }
    counts[name] = occurrences
  }
  const owners = new Map()
  for (const test of parts.full) {
    const file = normalizeFile(root, test.file)
    const project = test.projectName ?? ''
    if (owners.has(file) && owners.get(file) !== project) throw new Error('Test file belongs to multiple projects')
    owners.set(file, project)
  }
  if ([...counts.gate.keys()].some(key => counts.remaining.has(key))) throw new Error('Mandatory and remaining tests overlap')
  const combined = new Map(counts.gate)
  for (const [key, count] of counts.remaining) combined.set(key, count)
  if ([...counts.full].some(([key, count]) => (combined.get(key) ?? 0) < count)) throw new Error('Missing case occurrences from CI partition')
  if ([...combined].some(([key, count]) => (counts.full.get(key) ?? 0) < count)) throw new Error('Extra case occurrences in CI partition')
  const gateFiles = new Set(parts.gate.map(test => normalizeFile(root, test.file)))
  if (requiredGateFiles.some(file => !gateFiles.has(normalizeFile(root, file)))) throw new Error('Mandatory file discovers no test cases')
  const fullFiles = new Set(parts.full.map(test => normalizeFile(root, test.file)))
  if (expectedFiles.some(file => !fullFiles.has(normalizeFile(root, file)))) throw new Error('Undiscovered file in test projects')
  return { total: parts.full.length, gate: parts.gate.length, remaining: parts.remaining.length, files: fullFiles.size }
}

function verifyCurrentSuite(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const remaining = remainingTestArgs(pkg.scripts['test:safety']).slice(1)
  const gate = pkg.scripts['test:safety'].trim().split(/\s+/).slice(2)
  const require = createRequire(import.meta.url)
  const cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'rax-test-partition-'))
  try {
    const parts = {}
    for (const [name, args] of [['full', []], ['gate', gate], ['remaining', remaining]]) {
      const report = path.join(scratch, `${name}.json`)
      const result = spawnSync(process.execPath, [cli, 'list', ...args, `--json=${report}`], { cwd: root, encoding: 'utf8', timeout: 60000 })
      if (result.error || result.status !== 0) throw new Error(`Could not discover ${name} tests; run Vitest list locally to inspect configuration`)
      parts[name] = JSON.parse(readFileSync(report, 'utf8'))
    }
    return verifyTestPartition(parts, { root, requiredGateFiles: gate, expectedFiles: Object.values(discoverTestProjects(root)).flat() })
  } finally {
    if (path.dirname(scratch) !== os.tmpdir() || !path.basename(scratch).startsWith('rax-test-partition-')) throw new Error('Unsafe discovery cleanup')
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyCurrentSuite(fileURLToPath(new URL('../', import.meta.url)))
    console.log(`Test partition verified: ${result.total} cases / ${result.files} files = ${result.gate} mandatory + ${result.remaining} remaining; no overlap or omissions.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Test partition could not be verified')
    process.exitCode = 1
  }
}
