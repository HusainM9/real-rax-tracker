import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const transports = new Set(['lib/guardedUpstreamFetch.ts', 'src/lib/safeImportFetch.ts', 'lib/noRetryKv.ts'])
const sdks = new Set(['@vercel/kv', '@upstash/redis', 'axios', 'undici', 'node:http', 'node:https', 'http', 'https'])

/** Build gate, not a sandbox: catch accidental new bypasses, including fetch aliases. */
export function auditRequestSafetySource(fileName, source) {
  const name = fileName.replaceAll('\\', '/')
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const issues = []
  const add = (node, message) => issues.push({ file: name, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, message })
  function visit(node) {
    if (!transports.has(name)) {
      if (ts.isIdentifier(node) && ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'].includes(node.text)) add(node, 'Use the shared guarded request transport.')
      if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) && ['fetch', 'sendBeacon'].includes(node.argumentExpression.text)) add(node, 'Computed request access bypasses safety.')
    }
    const typeOnlyImport = node.parent && ts.isImportDeclaration(node.parent) && node.parent.importClause?.isTypeOnly
    const importReference = node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || (
      ts.isCallExpression(node.parent) && (node.parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'require'))
    ))
    if (ts.isStringLiteral(node) && importReference && sdks.has(node.text) && !typeOnlyImport && !(name === 'lib/noRetryKv.ts' && node.text === '@vercel/kv')) add(node, 'Direct network SDK imports bypass the guarded transport.')
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return issues
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(name) : [name]
  })
}

export function auditRequestSafety(root = process.cwd()) {
  const files = [...['src', 'lib', 'api'].flatMap((dir) => walk(path.join(root, dir))), path.join(root, 'middleware.ts')].filter((name) =>
    /\.tsx?$/.test(name) && !/\.(test|bench)\./.test(name) && !name.includes(`${path.sep}testing${path.sep}`))
  const issues = files.flatMap((file) => auditRequestSafetySource(path.relative(root, file), fs.readFileSync(file, 'utf8')))
  return { files: files.length, issues }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditRequestSafety()
  for (const issue of result.issues) console.error(`${issue.file}:${issue.line}: ${issue.message}`)
  if (result.issues.length) process.exitCode = 1
  else console.log(`Request-safety audit passed: ${result.files} runtime modules; only approved transports/SDK boundary access HTTP.`)
}
