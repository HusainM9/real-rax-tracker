import { compactTrackerProfileForCloudSync } from '../../lib/cloudSyncPayload'
import type { RaxTrackerData } from '../types/rax'

const missing = Symbol('missing')
const conflict = Symbol('conflict')
type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, i) => equal(value, right[i]))
  if (!record(left) || !record(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]))
}

function keyed(values: unknown[]): Map<string, RecordValue> | null {
  const result = new Map<string, RecordValue>()
  for (const value of values) {
    if (!record(value) || typeof value.id !== 'string' || !value.id || result.has(value.id)) return null
    result.set(value.id, value)
  }
  return result
}

function merge(base: unknown, local: unknown, remote: unknown, key = ''): unknown {
  if (equal(local, base)) return remote
  if (equal(remote, base) || equal(local, remote)) return local
  // Entity timestamps describe the edits merged below; they are not user content.
  if (key === 'updatedAt' && typeof local === 'string' && typeof remote === 'string' &&
    Number.isFinite(Date.parse(local)) && Number.isFinite(Date.parse(remote))) {
    return Date.parse(local) >= Date.parse(remote) ? local : remote
  }
  if (record(base) && record(local) && record(remote)) {
    const entries: [string, unknown][] = []
    for (const child of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = merge(Object.hasOwn(base, child) ? base[child] : missing,
        Object.hasOwn(local, child) ? local[child] : missing, Object.hasOwn(remote, child) ? remote[child] : missing, child)
      if (value === conflict) return conflict
      if (value !== missing) entries.push([child, value])
    }
    return Object.fromEntries(entries)
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const before = keyed(base), ours = keyed(local), theirs = keyed(remote)
    if (!before || !ours || !theirs) return conflict
    const common = [...before.keys()].filter(id => ours.has(id) && theirs.has(id))
    const commonIds = new Set(common)
    const localOrder = [...ours.keys()].filter(id => commonIds.has(id))
    const remoteOrder = [...theirs.keys()].filter(id => commonIds.has(id))
    const localReordered = !equal(common, localOrder), remoteReordered = !equal(common, remoteOrder)
    if (localReordered && remoteReordered && !equal(localOrder, remoteOrder)) return conflict
    const order = localReordered ? [...ours.keys(), ...theirs.keys(), ...before.keys()]
      : [...theirs.keys(), ...ours.keys(), ...before.keys()]
    const result: unknown[] = []
    for (const id of new Set(order)) {
      const value = merge(before.get(id) ?? missing, ours.get(id) ?? missing, theirs.get(id) ?? missing)
      if (value === conflict) return conflict
      if (value !== missing) result.push(value)
    }
    return result
  }
  // Includes deletion-versus-edit, concurrent different additions and primitive arrays.
  return conflict
}

/** Three-way reconciliation never chooses a winner for competing content edits. */
export function mergeAccountData(base: RaxTrackerData, local: RaxTrackerData, remote: RaxTrackerData):
  { ok: true; data: RaxTrackerData } | { ok: false } {
  const value = merge(compactTrackerProfileForCloudSync(base), compactTrackerProfileForCloudSync(local), compactTrackerProfileForCloudSync(remote))
  return value === conflict ? { ok: false } : { ok: true, data: { ...local, ...value as RaxTrackerData } }
}
