import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The build runs this explicit gate; CI runs its complement, not a second copy. */
export function remainingTestArgs(safetyCommand) {
  const [tool, command, ...files] = safetyCommand.trim().split(/\s+/)
  if (tool !== 'vitest' || command !== 'run' || !files.length || files.some(file => !/^(?:lib|src|tests|scripts|api)\/[a-z0-9_./-]+\.test\.[cm]?[jt]sx?$/i.test(file))) {
    throw new Error('test:safety must list explicit test files; review CI partitioning if the command changes.')
  }
  return ['run', ...files.flatMap(file => ['--exclude', file])]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const require = createRequire(import.meta.url)
  const cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
  const result = spawnSync(process.execPath, [cli, ...remainingTestArgs(pkg.scripts['test:safety']), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
  if (result.error) console.error('Could not start CI tests:', result.error.code)
  process.exitCode = result.status ?? 1
}
