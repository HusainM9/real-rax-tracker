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

function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
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

async function readIdbJson(): Promise<string | null> {
  if (!indexedDbAvailable()) return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const request = tx.objectStore(IDB_STORE).get(IDB_KEY)
    request.onsuccess = () => {
      const value = request.result
      resolve(typeof value === 'string' ? value : null)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not read IndexedDB.'))
  })
}

async function writeIdbJson(json: string): Promise<boolean> {
  if (!indexedDbAvailable()) return false
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(json, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not write IndexedDB.'))
    })
    return true
  } catch {
    return false
  }
}

function readLegacyLocalJson(): string | null {
  if (!localStorageAvailable()) return null
  try {
    return localStorage.getItem(LEGACY_LOCAL_KEY)
  } catch {
    return null
  }
}

function writeLegacyLocalJson(json: string): boolean {
  if (!localStorageAvailable()) return false
  try {
    localStorage.setItem(LEGACY_LOCAL_KEY, json)
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
    }. Use Dashboard → Save to cloud with a sync PIN, or Export JSON. Safari Private Browsing also clears data when you close the window.`
  }
  if (!result.localSaved && result.idbSaved) {
    return ''
  }
  return `Could not save your collection (${sizeLabel}). Export a JSON backup from Dashboard and set up cloud sync with a PIN.`
}

export async function loadPersistedTrackerData(): Promise<StorageLoadResult> {
  try {
    const idbRaw = await readIdbJson()
    if (idbRaw) {
      return { data: parseStoredJson(idbRaw), source: 'idb' }
    }
  } catch {
    // Fall through to legacy localStorage.
  }

  const localRaw = readLegacyLocalJson()
  if (localRaw) {
    const data = parseStoredJson(localRaw)
    void persistTrackerData(data)
    return { data, source: 'local' }
  }

  return { data: createEmptyData(), source: 'empty' }
}

export async function persistTrackerData(data: RaxTrackerData): Promise<StoragePersistResult> {
  const fullBytes = estimateBytes(data)
  const compactedPayload = compactTrackerProfileForCloudSync(data)
  const compactedBytes = estimateBytes(compactedPayload)
  const useCompact = compactedBytes < fullBytes
  const payload = useCompact ? compactedPayload : data
  const byteSize = useCompact ? compactedBytes : fullBytes
  const json = JSON.stringify(payload)

  let idbSaved = false
  let localSaved = false
  let reason: StoragePersistResult['reason'] | undefined

  try {
    idbSaved = await writeIdbJson(json)
  } catch (error) {
    reason = storageErrorReason(error)
  }

  try {
    localSaved = writeLegacyLocalJson(json)
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

