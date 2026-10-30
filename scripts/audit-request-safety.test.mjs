import { describe, expect, it } from 'vitest'
import { auditRequestSafetySource } from './audit-request-safety.mjs'

describe('pre-deployment request boundary audit', () => {
  it.each([
    'fetch("/api/test")',
    'const send = fetch; send("/api/test")',
    'globalThis.fetch("/api/test")',
    'window["fetch"]("/api/test")',
    'const {fetch: send} = globalThis; send("/api/test")',
    'import {kv} from "@vercel/kv"; kv.get("x")',
    'const sdk = await import("axios")',
  ])('rejects unguarded request access: %s', (source) => {
    expect(auditRequestSafetySource('src/pages/Example.tsx', source).length).toBeGreaterThan(0)
  })
  it('allows consumers of the shared guarded transport', () => {
    expect(auditRequestSafetySource('src/lib/earnings.ts', 'import {safeFetch} from "./safeImportFetch"; await safeFetch("/api/test")')).toEqual([])
  })
  it('does not mistake erased Node request types for live network access', () => {
    expect(auditRequestSafetySource('lib/adapter.ts', 'import type { IncomingMessage } from "node:http"')).toEqual([])
  })
  it('allows harmless protocol strings that do not import a request SDK', () => {
    expect(auditRequestSafetySource('lib/adapter.ts', 'const protocol = "https"')).toEqual([])
  })
  it('allows raw transport only in its audited implementation file', () => {
    expect(auditRequestSafetySource('lib/guardedUpstreamFetch.ts', 'await fetch(url, init)')).toEqual([])
    expect(auditRequestSafetySource('lib/newProvider.ts', 'await fetch(url, init)')).toHaveLength(1)
  })
  it('permits the response-aware KV boundary but not SDK middleware elsewhere', () => {
    expect(auditRequestSafetySource('lib/noRetryKv.ts', 'import {createClient} from "@vercel/kv"; await fetch(url, init)')).toEqual([])
    expect(auditRequestSafetySource('lib/cache.ts', 'import {createClient} from "@vercel/kv"; await fetch(url, init)')).toHaveLength(2)
  })
})
