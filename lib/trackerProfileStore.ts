import { kv } from '@vercel/kv'
import { adminStorageConfigured } from './adminEventStore'
import {
  decodeStoredProfilePayload,
  encodeStoredProfilePayload,
  encodedProfileByteLength,
} from './cloudSyncCompression'
import {
  compactTrackerProfileForCloudSync,
  trackerProfileJsonByteLength,
} from './cloudSyncPayload'
import { normalizeRealUsername } from './importOwnershipTypes'
import { validateSyncPin } from './syncPinRules'
import { hashSyncPassphrase } from './syncPassphrase'

const PROFILE_PREFIX = 'rax:tracker-profile:'
const TRACKER_PROFILE_USERNAMES_KEY = 'rax:tracker-profile:usernames'
/** Max gzip-compressed blob stored in KV (Upstash allows up to 100 MB). */
const MAX_COMPRESSED_PROFILE_BYTES = 4_000_000
/** Reject absurd payloads before compression work. */
const MAX_UNCOMPRESSED_PROFILE_BYTES = 15_000_000

function profileTooLargeError(input: {
  compressedBytes?: number
  uncompressedBytes: number
}): Error {
  const limitKb = Math.ceil(MAX_COMPRESSED_PROFILE_BYTES / 1024)
  if (input.compressedBytes !== undefined) {
    const usedKb = Math.ceil(input.compressedBytes / 1024)
    return new Error(
      `Tracker profile is too large for cloud sync (${usedKb} KB compressed; limit ${limitKb} KB). Export a local JSON backup, then remove unused saved profiles or potential cards before retrying.`,
    )
  }

  const usedKb = Math.ceil(input.uncompressedBytes / 1024)
  return new Error(
    `Tracker profile is too large for cloud sync (${usedKb} KB uncompressed; limit ${Math.ceil(MAX_UNCOMPRESSED_PROFILE_BYTES / 1024)} KB). Export a local JSON backup, then remove unused saved profiles or potential cards before retrying.`,
  )
}

export type TrackerProfileAdminSummary = {
  username: string
  updatedAt: string
  cardCount: number
  performanceCount: number
}

export type StoredTrackerProfile = {
  username: string
  passphraseHash: string
  /** Legacy uncompressed payload — still read for older saves. */
  data?: unknown
  dataBlob?: string
  dataEncoding?: 'gzip-base64'
  updatedAt: string
  cardCount: number
  performanceCount: number
}

export type TrackerProfileMeta = {
  updatedAt: string
  cardCount: number
  performanceCount: number
}

function profileKey(username: string): string {
  return `${PROFILE_PREFIX}${normalizeRealUsername(username)}`
}

export function profileSyncConfigured(): boolean {
  return adminStorageConfigured()
}

export function validateTrackerProfileData(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.cards) && Array.isArray(record.performances)
}

function profileMeta(data: unknown): Pick<StoredTrackerProfile, 'cardCount' | 'performanceCount'> {
  const record = data as Record<string, unknown>
  return {
    cardCount: Array.isArray(record.cards) ? record.cards.length : 0,
    performanceCount: Array.isArray(record.performances) ? record.performances.length : 0,
  }
}

function assertValidSyncPin(passphrase: string): string {
  const validated = validateSyncPin(passphrase)
  if (!validated.ok) {
    throw new Error(validated.error)
  }
  return validated.pin
}

export async function getTrackerProfileMeta(
  username: string,
  passphrase: string,
): Promise<{ meta: TrackerProfileMeta | null; storageConfigured: boolean; unauthorized: boolean }> {
  if (!profileSyncConfigured()) {
    return { meta: null, storageConfigured: false, unauthorized: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  let pin: string
  try {
    pin = assertValidSyncPin(passphrase)
  } catch (error) {
    if (!normalizedUsername) {
      return { meta: null, storageConfigured: true, unauthorized: true }
    }
    throw error
  }
  if (!normalizedUsername) {
    return { meta: null, storageConfigured: true, unauthorized: true }
  }

  const stored = await kv.get<StoredTrackerProfile | null>(profileKey(normalizedUsername))
  if (!stored) {
    return { meta: null, storageConfigured: true, unauthorized: false }
  }

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, pin)
  if (stored.passphraseHash !== passphraseHash) {
    return { meta: null, storageConfigured: true, unauthorized: true }
  }

  return {
    meta: {
      updatedAt: stored.updatedAt,
      cardCount: stored.cardCount,
      performanceCount: stored.performanceCount,
    },
    storageConfigured: true,
    unauthorized: false,
  }
}

export async function getTrackerProfile(
  username: string,
  passphrase: string,
): Promise<{
  profile: StoredTrackerProfile | null
  storageConfigured: boolean
  unauthorized: boolean
}> {
  if (!profileSyncConfigured()) {
    return { profile: null, storageConfigured: false, unauthorized: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  let pin: string
  try {
    pin = assertValidSyncPin(passphrase)
  } catch (error) {
    if (!normalizedUsername) {
      return { profile: null, storageConfigured: true, unauthorized: true }
    }
    throw error
  }
  if (!normalizedUsername) {
    return { profile: null, storageConfigured: true, unauthorized: true }
  }

  const stored = await kv.get<StoredTrackerProfile | null>(profileKey(normalizedUsername))
  if (!stored) {
    return { profile: null, storageConfigured: true, unauthorized: false }
  }

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, pin)
  if (stored.passphraseHash !== passphraseHash) {
    return { profile: null, storageConfigured: true, unauthorized: true }
  }

  const data = await decodeStoredProfilePayload(stored)
  return {
    profile: { ...stored, data },
    storageConfigured: true,
    unauthorized: false,
  }
}

export async function saveTrackerProfile(input: {
  username: string
  passphrase: string
  data: unknown
  ifUnmodifiedSince?: string
}): Promise<{
  ok: boolean
  storageConfigured: boolean
  unauthorized: boolean
  conflict: boolean
  meta?: TrackerProfileMeta
  existingMeta?: TrackerProfileMeta
}> {
  if (!profileSyncConfigured()) {
    return { ok: false, storageConfigured: false, unauthorized: false, conflict: false }
  }

  const normalizedUsername = normalizeRealUsername(input.username)
  if (!normalizedUsername) {
    return { ok: false, storageConfigured: true, unauthorized: true, conflict: false }
  }

  let pin: string
  try {
    pin = assertValidSyncPin(input.passphrase)
  } catch (error) {
    throw error
  }

  if (!validateTrackerProfileData(input.data)) {
    throw new Error('Invalid tracker profile payload.')
  }

  const profileData = compactTrackerProfileForCloudSync(input.data)
  const uncompressedBytes = trackerProfileJsonByteLength(profileData)
  if (uncompressedBytes > MAX_UNCOMPRESSED_PROFILE_BYTES) {
    throw profileTooLargeError({ uncompressedBytes })
  }

  const encoded = await encodeStoredProfilePayload(profileData)
  const compressedBytes = encodedProfileByteLength(encoded.dataBlob)
  if (compressedBytes > MAX_COMPRESSED_PROFILE_BYTES) {
    throw profileTooLargeError({ compressedBytes, uncompressedBytes })
  }

  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  const passphraseHash = await hashSyncPassphrase(normalizedUsername, pin)

  if (existing && existing.passphraseHash !== passphraseHash) {
    return { ok: false, storageConfigured: true, unauthorized: true, conflict: false }
  }

  if (
    input.ifUnmodifiedSince &&
    existing &&
    existing.updatedAt !== input.ifUnmodifiedSince
  ) {
    return {
      ok: false,
      storageConfigured: true,
      unauthorized: false,
      conflict: true,
      existingMeta: {
        updatedAt: existing.updatedAt,
        cardCount: existing.cardCount,
        performanceCount: existing.performanceCount,
      },
    }
  }

  const updatedAt = new Date().toISOString()
  const counts = profileMeta(profileData)
  const stored: StoredTrackerProfile = {
    username: normalizedUsername,
    passphraseHash,
    dataBlob: encoded.dataBlob,
    dataEncoding: encoded.dataEncoding,
    updatedAt,
    ...counts,
  }

  await kv.set(key, stored)
  await kv.sadd(TRACKER_PROFILE_USERNAMES_KEY, normalizedUsername)

  return {
    ok: true,
    storageConfigured: true,
    unauthorized: false,
    conflict: false,
    meta: {
      updatedAt,
      cardCount: counts.cardCount,
      performanceCount: counts.performanceCount,
    },
  }
}

export async function lookupTrackerProfileForAdmin(
  username: string,
): Promise<{ profile: TrackerProfileAdminSummary | null; storageConfigured: boolean }> {
  if (!profileSyncConfigured()) {
    return { profile: null, storageConfigured: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  if (!normalizedUsername) {
    return { profile: null, storageConfigured: true }
  }

  const stored = await kv.get<StoredTrackerProfile | null>(profileKey(normalizedUsername))
  if (!stored) {
    return { profile: null, storageConfigured: true }
  }

  return {
    profile: {
      username: stored.username,
      updatedAt: stored.updatedAt,
      cardCount: stored.cardCount,
      performanceCount: stored.performanceCount,
    },
    storageConfigured: true,
  }
}

export async function adminResetTrackerProfilePin(
  username: string,
  newPassphrase: string,
): Promise<{
  ok: boolean
  notFound: boolean
  storageConfigured: boolean
  meta?: TrackerProfileMeta
}> {
  if (!profileSyncConfigured()) {
    return { ok: false, notFound: false, storageConfigured: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  if (!normalizedUsername) {
    throw new Error('Username is required.')
  }

  const pin = assertValidSyncPin(newPassphrase)
  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  if (!existing) {
    return { ok: false, notFound: true, storageConfigured: true }
  }

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, pin)
  const updatedAt = new Date().toISOString()
  await kv.set(key, {
    ...existing,
    passphraseHash,
    updatedAt,
  })
  await kv.sadd(TRACKER_PROFILE_USERNAMES_KEY, normalizedUsername)

  return {
    ok: true,
    notFound: false,
    storageConfigured: true,
    meta: {
      updatedAt,
      cardCount: existing.cardCount,
      performanceCount: existing.performanceCount,
    },
  }
}

export async function adminDeleteTrackerProfile(
  username: string,
): Promise<{ ok: boolean; notFound: boolean; storageConfigured: boolean }> {
  if (!profileSyncConfigured()) {
    return { ok: false, notFound: false, storageConfigured: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  if (!normalizedUsername) {
    throw new Error('Username is required.')
  }

  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  if (!existing) {
    return { ok: false, notFound: true, storageConfigured: true }
  }

  await kv.del(key)
  await kv.srem(TRACKER_PROFILE_USERNAMES_KEY, normalizedUsername)
  return { ok: true, notFound: false, storageConfigured: true }
}

export async function changeTrackerProfilePin(input: {
  username: string
  currentPassphrase: string
  newPassphrase: string
}): Promise<{
  ok: boolean
  notFound: boolean
  unauthorized: boolean
  storageConfigured: boolean
  meta?: TrackerProfileMeta
}> {
  if (!profileSyncConfigured()) {
    return { ok: false, notFound: false, unauthorized: false, storageConfigured: false }
  }

  const normalizedUsername = normalizeRealUsername(input.username)
  if (!normalizedUsername) {
    throw new Error('Username is required.')
  }

  const currentPin = assertValidSyncPin(input.currentPassphrase)
  const newPin = assertValidSyncPin(input.newPassphrase)
  if (currentPin === newPin) {
    throw new Error('New sync PIN must be different from the current PIN.')
  }

  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  if (!existing) {
    return { ok: false, notFound: true, unauthorized: false, storageConfigured: true }
  }

  const currentHash = await hashSyncPassphrase(normalizedUsername, currentPin)
  if (existing.passphraseHash !== currentHash) {
    return { ok: false, notFound: false, unauthorized: true, storageConfigured: true }
  }

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, newPin)
  const updatedAt = new Date().toISOString()
  await kv.set(key, {
    ...existing,
    passphraseHash,
    updatedAt,
  })

  return {
    ok: true,
    notFound: false,
    unauthorized: false,
    storageConfigured: true,
    meta: {
      updatedAt,
      cardCount: existing.cardCount,
      performanceCount: existing.performanceCount,
    },
  }
}
