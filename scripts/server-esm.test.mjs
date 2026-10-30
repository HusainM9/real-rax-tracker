import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('loads deployed API modules under native Node ESM without contacting any service', () => {
  const root = process.cwd()
  const scratchRoot = path.join(root, '.superpowers')
  mkdirSync(scratchRoot, { recursive: true })
  const scratch = mkdtempSync(path.join(scratchRoot, 'server-esm-'))
  try {
    const entrypoints = []
    for (const directory of ['api', 'lib', 'src']) {
      for (const entry of readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.(test|bench|d)\.tsx?$/.test(entry.name)) continue
        const input = path.join(entry.parentPath, entry.name)
        const relative = path.relative(root, input)
        const output = path.join(scratch, relative.replace(/\.tsx?$/, '.js'))
        mkdirSync(path.dirname(output), { recursive: true })
        writeFileSync(output, ts.transpileModule(readFileSync(input, 'utf8'), { fileName: input, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText)
        if (directory === 'api' && !entry.name.startsWith('_')) entrypoints.push(pathToFileURL(output).href)
      }
    }
    writeFileSync(path.join(scratch, 'package.json'), '{"type":"module"}')
    const code = `globalThis.fetch = async () => { throw new Error('Network forbidden in server module-load verification') }; for (const file of ${JSON.stringify(entrypoints)}) await import(file); console.log('Loaded API modules without network');`
    let error = ''
    try { execFileSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: scratch, stdio: 'pipe', timeout: 30000 }) }
    catch (failure) { error = String(failure.stderr ?? failure.message) }
    expect(error).toBe('')
  } finally {
    if (!scratch.startsWith(`${scratchRoot}${path.sep}server-esm-`)) throw new Error('Unsafe generated-test cleanup path')
    rmSync(scratch, { recursive: true, force: true })
  }
}, 45000)
