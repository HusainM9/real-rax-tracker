import { compactTrackerProfileForCloudSync } from '../../lib/cloudSyncPayload'
import type { RaxTrackerData } from '../types/rax'
import {
  createEmptyData,
  normalizeData,
} from './storage'

const LEGACY_LOCAL_KEY = 'real-rax-tracker:v1'
const IDB_NAME = 'real-rax-tracker'
const IDB_STORE = 'profile'
const IDB_KEY = 'v1'

export type PersistenceScope = { accountUsername: string }

function storageKeys(scope?: PersistenceScope) {
  if (!scope) return { local: LEGACY_LOCAL_KEY, idb: IDB_KEY }
  const username = scope.accountUsername.trim().toLowerCase()
  if (!username) throw new Error('Account storage requires a username.')
  const suffix = `:account:${encodeURIComponent(username)}`
  return { local: LEGACY_LOCAL_KEY + suffix, idb: IDB_KEY + suffix }
}

export type StoragePersistResult = {
  ok: boolean
  byteSize: number
  compacted: boolean
  idbSaved: boolean
  localSaved: boolean
  reason?: 'quota' | 'unavailable' | 'unknown'
}

export type StorageLoadResult = {
  data: RaxTrackerData
  source: 'idb' | 'local' | 'empty'
}

function storageErrorReason(error: unknown): StoragePersistResult['reason'] {
  if (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.code === 22)
  ) {
    return 'quota'
  }
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = String((error as { name?: unknown }).name)
    if (name === 'QuotaExceededError') return 'quota'
  }
  return 'unknown'
}

function localStorageAvailable(): boolean {
  try {
    const probe = '__rax_storage_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'))
  })
}

async function readIdbJson(key: string): Promise<string | null> {
  if (!indexedDbAvailable()) return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const request = tx.objectStore(IDB_STORE).get(key)
    request.onsuccess = () => {
      const value = request.result
      resolve(typeof value === 'string' ? value : null)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not read IndexedDB.'))
  })
}

async function writeIdbJson(json: string, key: string): Promise<boolean> {
  if (!indexedDbAvailable()) return false
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(json, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not write IndexedDB.'))
    })
    return true
  } catch {
    return false
  }
}

function readLocalJson(key: string): string | null {
  if (!localStorageAvailable()) return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalJson(json: string, key: string): boolean {
  if (!localStorageAvailable()) return false
  try {
    localStorage.setItem(key, json)
    return true
  } catch {
    return false
  }
}

function parseStoredJson(raw: string): RaxTrackerData {
  return normalizeData(JSON.parse(raw))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function storageWarningMessage(result: StoragePersistResult): string {
  const sizeLabel = formatBytes(result.byteSize)
  if (result.ok && result.idbSaved) {
    return ''
  }
  if (result.reason === 'quota' || (!result.localSaved && !result.idbSaved)) {
    return `Your collection (${sizeLabel}) could not be saved in this browser${
      result.reason === 'quota' ? ' — storage is full' : ''
    }. Sign in so your collection can save to your account, or Export JSON from Dashboard. Safari Private Browsing also clears data when you close the window.`
  }
  if (!result.localSaved && result.idbSaved) {
    return ''
  }
  return `Could not save your collection (${sizeLabel}). Export a JSON backup from Dashboard and sign in so your account can keep a copy.`
}

export async function loadPersistedTrackerData(scope?: PersistenceScope): Promise<StorageLoadResult> {
  const keys = storageKeys(scope)
  try {
    const idbRaw = await readIdbJson(keys.idb)
    if (idbRaw) {
      return { data: parseStoredJson(idbRaw), source: 'idb' }
    }
  } catch {
    // Fall through to legacy localStorage.
  }

  const localRaw = readLocalJson(keys.local)
  if (localRaw) {
    try {
      const data = parseStoredJson(localRaw)
      void persistTrackerData(data, scope)
      return { data, source: 'local' }
    } catch {
      // Leave the damaged value recoverable; never borrow another account's cache.
    }
  }

  return { data: createEmptyData(), source: 'empty' }
}

export async function persistTrackerData(data: RaxTrackerData, scope?: PersistenceScope): Promise<StoragePersistResult> {
  const keys = storageKeys(scope)
  const fullJson = JSON.stringify(data)
  const fullBytes = new TextEncoder().encode(fullJson).length
  const compactedPayload = compactTrackerProfileForCloudSync(data)
  const compactedJson = JSON.stringify(compactedPayload)
  const compactedBytes = new TextEncoder().encode(compactedJson).length
  const useCompact = compactedBytes < fullBytes
  const byteSize = useCompact ? compactedBytes : fullBytes
  const json = useCompact ? compactedJson : fullJson

  let idbSaved = false
  let localSaved = false
  let reason: StoragePersistResult['reason'] | undefined

  try {
    idbSaved = await writeIdbJson(json, keys.idb)
  } catch (error) {
    reason = storageErrorReason(error)
  }

  try {
    localSaved = writeLocalJson(json, keys.local)
  } catch (error) {
    if (!reason) reason = storageErrorReason(error)
  }

  if (!idbSaved && !localSaved && !reason) {
    reason = 'unavailable'
  }

  return {
    ok: idbSaved || localSaved,
    byteSize,
    compacted: useCompact,
    idbSaved,
    localSaved,
    reason: idbSaved || localSaved ? undefined : reason,
  }
}

