import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const roots = ['api', 'lib', 'scripts', 'src', 'tests']
const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/** One owner per file. Existing browser annotations remain authoritative. */
export function discoverTestProjects(root) {
  const projects = { unit: [], ui: [], integration: [] }
  function visit(directory) {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory() && !['node_modules', '.git', '.superpowers', 'dist'].includes(entry.name)) visit(absolute)
      else if (entry.isFile() && testFile.test(entry.name)) {
        const file = path.relative(root, absolute).split(path.sep).join('/')
        // Match the installed Vitest's annotation parser, including block comments.
        const browser = readFileSync(absolute, 'utf8').match(/@(?:vitest|jest)-environment\s+([\w-]+)\b/)?.[1] === 'jsdom'
        const project = file.startsWith('tests/integration/') ? 'integration' : browser ? 'ui' : 'unit'
        projects[project].push(file)
      }
    }
  }
  for (const directory of roots) visit(path.join(root, directory))
  for (const files of Object.values(projects)) files.sort()
  return projects
}
