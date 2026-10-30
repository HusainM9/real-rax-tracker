// Optional offline VM check. Install Fengari in an ignored scratch directory,
// then pass that directory here. No Redis client, HTTP or environment credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

if (!process.argv[2]) throw new Error('Pass the scratch directory containing node_modules/fengari. This check never installs dependencies.')
const requireTool = createRequire(path.resolve(process.argv[2], 'package.json'))
const { lua, lauxlib, lualib, to_luastring: str } = requireTool('fengari')
const source = readFileSync(new URL('../lib/requestSafetyStore.ts', import.meta.url), 'utf8')
const tree = ts.createSourceFile('requestSafetyStore.ts', source, ts.ScriptTarget.Latest, true)
const scripts = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isNoSubstitutionTemplateLiteral(node.initializer)) scripts.set(node.name.text, node.initializer.text)
  ts.forEachChild(node, visit)
}
visit(tree)
assert(scripts.has('RECORD_FAILURE'))
const records = new Map()
const nullValue = {}
function push(L, value) {
  if (value === null) lua.lua_pushlightuserdata(L, nullValue)
  else if (typeof value === 'string') lua.lua_pushstring(L, str(value))
  else if (typeof value === 'number') lua.lua_pushnumber(L, value)
  else if (typeof value === 'boolean') lua.lua_pushboolean(L, value)
  else if (value === undefined) lua.lua_pushnil(L)
  else {
    lua.lua_newtable(L)
    for (const [key, item] of Object.entries(value)) {
      push(L, Array.isArray(value) ? Number(key) + 1 : key)
      push(L, item)
      lua.lua_settable(L, -3)
    }
  }
}
function value(L, index) {
  switch (lua.lua_type(L, index)) {
    case lua.LUA_TNIL: return null
    case lua.LUA_TBOOLEAN: return lua.lua_toboolean(L, index)
    case lua.LUA_TNUMBER: return lua.lua_tonumber(L, index)
    case lua.LUA_TSTRING: return lua.lua_tojsstring(L, index)
    case lua.LUA_TLIGHTUSERDATA: assert.equal(lua.lua_touserdata(L, index), nullValue); return null
    case lua.LUA_TTABLE: {
      const result = Object.create(null)
      const absolute = lua.lua_absindex(L, index)
      lua.lua_pushnil(L)
      while (lua.lua_next(L, absolute)) {
        result[value(L, -2)] = value(L, -1)
        lua.lua_pop(L, 1)
      }
      return result
    }
    default: throw new Error('Unsupported Lua value in isolated JSON adapter')
  }
}
function evaluate(name, key, args) {
  const L = lauxlib.luaL_newstate()
  lualib.luaL_openlibs(L)
  function callback(fn) {
    return state => {
      try { push(state, fn(state)); return 1 }
      catch (error) { return lauxlib.luaL_error(state, str(error.message)) }
    }
  }
  function table(name, functions) {
    lua.lua_newtable(L)
    for (const [field, fn] of Object.entries(functions)) {
      lua.lua_pushcfunction(L, callback(fn))
      lua.lua_setfield(L, -2, str(field))
    }
    lua.lua_setglobal(L, str(name))
  }
  try {
    push(L, [key]); lua.lua_setglobal(L, str('KEYS'))
    push(L, args.map(String)); lua.lua_setglobal(L, str('ARGV'))
    table('cjson', {
      decode: state => JSON.parse(value(state, 1)),
      encode: state => JSON.stringify(value(state, 1)),
    })
    table('redis', {
      call: state => {
        const command = value(state, 1)
        const target = value(state, 2)
        assert.equal(target, key, 'Scripts must only touch their one family key')
        if (command === 'GET') return records.get(target) ?? false
        if (command === 'SET') { records.set(target, value(state, 3)); return 'OK' }
        if (command === 'DEL') return records.delete(target) ? 1 : 0
        throw new Error('Unexpected Redis command')
      },
      error_reply: () => { throw new Error('Invalid safety record') },
    })
    const compiled = lauxlib.luaL_loadstring(L, str(scripts.get(name)))
    if (compiled !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1))
    return value(L, -1)
  } finally { lua.lua_close(L) }
}
const record = (key, value) => evaluate('RECORD_FAILURE', key, [JSON.stringify(value)])
const saved = key => JSON.parse(records.get(key))
const first = { owner: 'first', provider: 'real', status: 500, recordedAt: '2026-10-31T00:00:00.000Z' }
assert.equal(record('confirmed', first), 1)
const original = records.get('confirmed')
assert.equal(record('confirmed', { ...first, owner: 'later', recordedAt: 'later' }), 1)
assert.equal(records.get('confirmed'), original, 'The first confirmed 500 is never overwritten')

for (const legacy of [{ owner: 'old' }, { owner: 'old', status: 503 }, { owner: 'old', outcome: 'transport_unknown' }]) {
  const raw = JSON.stringify(legacy)
  records.set('unknown', raw)
  assert.equal(record('unknown', first), 1)
  assert.equal(saved('unknown').status, 500)
  assert.equal(saved('unknown').previousRecord, raw, 'Retain old evidence when recording an actual 500')
}
const envelope = JSON.stringify({ version: 2, status: 503, operations: { known: { owner: 'known', status: 500 } } })
records.set('nested', envelope)
assert.equal(record('nested', first), 1)
assert.equal(records.get('nested'), envelope, 'Keep legacy nested confirmed-500 history')

for (let status = 501; status <= 599; status++) {
  assert.throws(() => record('not-500', { ...first, status }))
  assert.equal(records.has('not-500'), false)
}
assert.throws(() => record('not-real', { ...first, provider: 'kv' }))
assert.equal(records.has('not-real'), false)
records.set('malformed', 'invalid-json')
assert.equal(record('malformed', first), 1)
assert.equal(saved('malformed').previousRecord, 'invalid-json')
console.log('Offline safety Lua passed: only Real 500 accepted; first/nested failures and prior unknown evidence retained. No Redis/network access.')
