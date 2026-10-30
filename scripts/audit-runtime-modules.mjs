/** Conservative static reachability check, not a proof that externally callable APIs are unused. */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const files = []
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(name)
    else if (/\.(tsx?|mjs|css|svg|png)$/.test(name)) files.push(path.resolve(name))
  }
}
for (const directory of ['src', 'lib', 'api', 'scripts', 'public']) if (fs.existsSync(directory)) walk(directory)
files.push(path.resolve('middleware.ts'), path.resolve('vite.config.ts'))
const fileSet = new Set(files)
const graph = new Map()
const testFile = (file) => /\.(test|bench)\.tsx?$/.test(file)
function resolve(from, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/src/') && !specifier.startsWith('/lib/')) return
  const base = specifier.startsWith('/') ? path.join(root, specifier) : path.resolve(path.dirname(from), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, base.replace(/\.js$/, '.ts'), path.join(base, 'index.ts')]
  return candidates.find((file) => fileSet.has(file))
}
for (const file of files) {
  const dependencies = new Set()
  const source = /\.(png)$/.test(file) ? '' : fs.readFileSync(file, 'utf8')
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const dependency = resolve(file, node.moduleSpecifier.text)
      if (dependency) dependencies.add(dependency)
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(parsed).endsWith('ssrLoadModule')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const dependency = resolve(file, node.arguments[0].text)
      if (dependency) dependencies.add(dependency)
    }
    ts.forEachChild(node, visit)
  }
  if (/\.(tsx?|mjs)$/.test(file)) visit(parsed)
  for (const match of source.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)) {
    const dependency = resolve(file, match[1])
    if (dependency) dependencies.add(dependency)
  }
  graph.set(file, dependencies)
}
const entries = files.filter((file) => file.includes(`${path.sep}api${path.sep}`) && !testFile(file)
  || file.includes(`${path.sep}scripts${path.sep}`) && file.endsWith('.mjs')
  || file.includes(`${path.sep}public${path.sep}`))
entries.push(path.resolve('src/main.tsx'), path.resolve('middleware.ts'), path.resolve('vite.config.ts'))
const reachable = new Set()
function reach(file) { if (reachable.has(file)) return; reachable.add(file); for (const dep of graph.get(file) ?? []) reach(dep) }
entries.forEach(reach)
const relative = (file) => path.relative(root, file).replaceAll('\\', '/')
console.log(JSON.stringify({
  sourceFiles: files.filter((file) => /\.(tsx?|mjs)$/.test(file)).length,
  testFiles: files.filter(testFile).length,
  unreachableCandidates: files.filter((file) => !testFile(file) && !reachable.has(file) && !file.endsWith('.d.ts')).map(relative),
  largestModules: files.filter((file) => /\.(tsx?|mjs)$/.test(file) && !testFile(file)).map((file) => ({ file: relative(file), lines: fs.readFileSync(file, 'utf8').split('\n').length })).sort((a, b) => b.lines - a.lines).slice(0, 12),
}, null, 2))
