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
assert(scripts.has('RESERVE_OPERATION') && scripts.has('FINISH'))
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
const reserve = (key, owner, op) => evaluate('RESERVE_OPERATION', key, [owner, '2026-10-31T00:00:00.000Z', op])
const finish = (key, owner, op = '', status = '', unknown = false) => evaluate('FINISH', key, [owner, status, status || unknown ? 'supabase-catalog' : '', 'GET', '2026-10-31T00:00:00.000Z', unknown ? JSON.stringify({ outcome: 'transport_unknown', incidentId: owner }) : '', op])
const saved = key => JSON.parse(records.get(key))

assert.equal(reserve('independent', 'one', 'avatar'), null)
assert.equal(reserve('independent', 'two', 'earnings'), null)
assert.equal(JSON.parse(reserve('independent', 'three', 'avatar')).owner, 'one')
assert.equal(finish('independent', 'wrong-owner', 'avatar'), 0)
assert.equal(finish('independent', 'one'), 0, 'Unscoped completion cannot delete a scoped family')
assert.equal(finish('independent', 'one', 'avatar'), 1)
assert.equal(saved('independent').operations.earnings.owner, 'two')
assert.equal(finish('independent', 'two', 'earnings', '', true), 1)
assert.equal(JSON.parse(reserve('independent', 'three', 'earnings')).outcome, 'transport_unknown')
assert.equal(reserve('independent', 'three', 'other'), null)

for (let status = 500; status <= 599; status++) {
  const key = `status-${status}`
  assert.equal(reserve(key, 'failed', 'first'), null)
  assert.equal(reserve(key, 'late-success', 'second'), null)
  assert.equal(finish(key, 'failed', 'first', status), 1)
  assert.equal(finish(key, 'late-success', 'second'), 1)
  assert.equal(saved(key).status, status, 'Late success cannot erase a confirmed family failure')
  assert.equal(JSON.parse(reserve(key, 'new', 'third')).status, status)
  assert.equal(finish(key, 'failed'), 0)
  assert.equal(saved(key).status, status)
}

for (const legacy of [{ owner: 'old' }, { owner: 'old', status: 503 }]) {
  const raw = JSON.stringify(legacy)
  records.set('legacy', raw)
  assert.equal(reserve('legacy', 'new', 'avatar'), raw)
  assert.equal(records.get('legacy'), raw, 'Legacy family records must not be migrated or cleared')
}
for (const raw of ['invalid-json', 'null', '{"version":2,"operations":false}',
  ...[false, null, 7, [], {}].map(operation => JSON.stringify({ version: 2, operations: { avatar: operation } }))]) {
  records.set('malformed', raw)
  assert.throws(() => reserve('malformed', 'new', 'avatar'))
  assert.equal(records.get('malformed'), raw)
}
assert.equal(reserve('success', 'one', 'avatar'), null)
assert.equal(finish('success', 'one', 'avatar'), 1)
assert.equal(records.has('success'), false)
records.set('confirmed-legacy', JSON.stringify({ owner: 'old', status: 502 }))
assert.equal(finish('confirmed-legacy', 'old'), 0)
assert.equal(saved('confirmed-legacy').status, 502)
console.log('Offline Lua VM passed: 100 status families, late success, isolated unknowns, ownership, legacy records, malformed state and clean completion. No Redis/network access.')
