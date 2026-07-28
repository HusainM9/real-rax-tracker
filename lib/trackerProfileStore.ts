import { kv } from '@vercel/kv'
import { adminStorageConfigured } from './adminEventStore'
import {
  validateAccountPassword,
  validateAccountUsername,
} from './accountPasswordRules'
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
import { hashSyncPassphrase } from './syncPassphrase'

const PROFILE_PREFIX = 'rax:tracker-profile:'
const TRACKER_PROFILE_USERNAMES_KEY = 'rax:tracker-profile:usernames'
const MAX_COMPRESSED_PROFILE_BYTES = 4_000_000
const MAX_UNCOMPRESSED_PROFILE_BYTES = 15_000_000

function emptyAccountDataForUsername(username: string) {
  return {
    version: 1,
    settings: {
      proBonusEnabled: true,
      savedUsername: username,
      importRarePasses: false,
      importEpicPasses: false,
    },
    cards: [],
    performances: [],
    potentialCards: [],
    savedCardProfiles: [],
    cachedPlayerEarnings: [],
    savedSellRankings: null,
    plannedPasses: [],
    packTrackers: [],
    /** Seed one shared pack-account template so Packs / Admin account trackers start ready. */
    packAccountTemplates: [
      {
        id: `ptpl-${username}`,
        name: username,
        username,
        opensPacks: true,
      },
    ],
    ignoredPassKeys: [],
  }
}

function profileTooLargeError(input: {
  compressedBytes?: number
  uncompressedBytes: number
}): Error {
  const limitKb = Math.ceil(MAX_COMPRESSED_PROFILE_BYTES / 1024)
  if (input.compressedBytes !== undefined) {
    const usedKb = Math.ceil(input.compressedBytes / 1024)
    return new Error(
      `Account data is too large (${usedKb} KB compressed; limit ${limitKb} KB). Export a local JSON backup, then remove unused saved profiles or potential cards before retrying.`,
    )
  }

  const usedKb = Math.ceil(input.uncompressedBytes / 1024)
  return new Error(
    `Account data is too large (${usedKb} KB uncompressed; limit ${Math.ceil(MAX_UNCOMPRESSED_PROFILE_BYTES / 1024)} KB). Export a local JSON backup, then remove unused saved profiles or potential cards before retrying.`,
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
  /** Password hash (legacy field name passphraseHash for KV compatibility). */
  passphraseHash: string
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

export function accountsConfigured(): boolean {
  return profileSyncConfigured()
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

function assertValidAccountPassword(password: string): string {
  const validated = validateAccountPassword(password)
  if (!validated.ok) {
    throw new Error(validated.error)
  }
  return validated.password
}

function assertValidAccountUsername(username: string): string {
  const validated = validateAccountUsername(username)
  if (!validated.ok) {
    throw new Error(validated.error)
  }
  return validated.username
}

async function encodeAndAssertSize(data: unknown): Promise<{
  dataBlob: string
  dataEncoding: 'gzip-base64'
  counts: Pick<StoredTrackerProfile, 'cardCount' | 'performanceCount'>
}> {
  if (!validateTrackerProfileData(data)) {
    throw new Error('Invalid tracker profile payload.')
  }

  const profileData = compactTrackerProfileForCloudSync(data)
  const uncompressedBytes = trackerProfileJsonByteLength(profileData)
  if (uncompressedBytes > MAX_UNCOMPRESSED_PROFILE_BYTES) {
    throw profileTooLargeError({ uncompressedBytes })
  }

  const encoded = await encodeStoredProfilePayload(profileData)
  const compressedBytes = encodedProfileByteLength(encoded.dataBlob)
  if (compressedBytes > MAX_COMPRESSED_PROFILE_BYTES) {
    throw profileTooLargeError({ compressedBytes, uncompressedBytes })
  }

  return {
    dataBlob: encoded.dataBlob,
    dataEncoding: encoded.dataEncoding,
    counts: profileMeta(profileData),
  }
}

export async function registerAccount(input: {
  username: string
  password: string
}): Promise<{
  ok: boolean
  storageConfigured: boolean
  alreadyExists: boolean
  username?: string
}> {
  if (!accountsConfigured()) {
    return { ok: false, storageConfigured: false, alreadyExists: false }
  }

  const normalizedUsername = assertValidAccountUsername(input.username)
  const password = assertValidAccountPassword(input.password)
  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  if (existing) {
    return { ok: false, storageConfigured: true, alreadyExists: true }
  }

  const encoded = await encodeAndAssertSize(emptyAccountDataForUsername(normalizedUsername))
  const passphraseHash = await hashSyncPassphrase(normalizedUsername, password)
  const updatedAt = new Date().toISOString()
  const stored: StoredTrackerProfile = {
    username: normalizedUsername,
    passphraseHash,
    dataBlob: encoded.dataBlob,
    dataEncoding: encoded.dataEncoding,
    updatedAt,
    ...encoded.counts,
  }

  await kv.set(key, stored)
  await kv.sadd(TRACKER_PROFILE_USERNAMES_KEY, normalizedUsername)

  return {
    ok: true,
    storageConfigured: true,
    alreadyExists: false,
    username: normalizedUsername,
  }
}

export async function verifyAccountCredentials(
  username: string,
  password: string,
): Promise<{
  ok: boolean
  storageConfigured: boolean
  unauthorized: boolean
  notFound: boolean
  username?: string
}> {
  if (!accountsConfigured()) {
    return { ok: false, storageConfigured: false, unauthorized: false, notFound: false }
  }

  let normalizedUsername: string
  let validatedPassword: string
  try {
    normalizedUsername = assertValidAccountUsername(username)
    validatedPassword = assertValidAccountPassword(password)
  } catch {
    return { ok: false, storageConfigured: true, unauthorized: true, notFound: false }
  }

  const stored = await kv.get<StoredTrackerProfile | null>(profileKey(normalizedUsername))
  if (!stored) {
    return { ok: false, storageConfigured: true, unauthorized: false, notFound: true }
  }

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, validatedPassword)
  if (stored.passphraseHash !== passphraseHash) {
    return { ok: false, storageConfigured: true, unauthorized: true, notFound: false }
  }

  return {
    ok: true,
    storageConfigured: true,
    unauthorized: false,
    notFound: false,
    username: normalizedUsername,
  }
}

export async function getAccountProfileForSession(username: string): Promise<{
  transfer: {
    username: string
    updatedAt: string
    cardCount: number
    performanceCount: number
    data?: unknown
    dataBlob?: string
    dataEncoding?: 'gzip-base64'
  } | null
  storageConfigured: boolean
  notFound: boolean
}> {
  if (!accountsConfigured()) {
    return { transfer: null, storageConfigured: false, notFound: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  if (!normalizedUsername) {
    return { transfer: null, storageConfigured: true, notFound: true }
  }

  const stored = await kv.get<StoredTrackerProfile | null>(profileKey(normalizedUsername))
  if (!stored) {
    return { transfer: null, storageConfigured: true, notFound: true }
  }

  return {
    transfer: {
      username: stored.username,
      updatedAt: stored.updatedAt,
      cardCount: stored.cardCount,
      performanceCount: stored.performanceCount,
      data: stored.data,
      dataBlob: stored.dataBlob,
      dataEncoding: stored.dataEncoding,
    },
    storageConfigured: true,
    notFound: false,
  }
}

export async function saveAccountProfileForSession(input: {
  username: string
  data: unknown
  ifUnmodifiedSince?: string
}): Promise<{
  ok: boolean
  storageConfigured: boolean
  notFound: boolean
  conflict: boolean
  meta?: TrackerProfileMeta
  existingMeta?: TrackerProfileMeta
}> {
  if (!accountsConfigured()) {
    return { ok: false, storageConfigured: false, notFound: false, conflict: false }
  }

  const normalizedUsername = normalizeRealUsername(input.username)
  if (!normalizedUsername) {
    return { ok: false, storageConfigured: true, notFound: true, conflict: false }
  }

  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  if (!existing) {
    return { ok: false, storageConfigured: true, notFound: true, conflict: false }
  }

  if (input.ifUnmodifiedSince && existing.updatedAt !== input.ifUnmodifiedSince) {
    return {
      ok: false,
      storageConfigured: true,
      notFound: false,
      conflict: true,
      existingMeta: {
        updatedAt: existing.updatedAt,
        cardCount: existing.cardCount,
        performanceCount: existing.performanceCount,
      },
    }
  }

  const encoded = await encodeAndAssertSize(input.data)
  const updatedAt = new Date().toISOString()
  const stored: StoredTrackerProfile = {
    username: normalizedUsername,
    passphraseHash: existing.passphraseHash,
    dataBlob: encoded.dataBlob,
    dataEncoding: encoded.dataEncoding,
    updatedAt,
    ...encoded.counts,
  }

  await kv.set(key, stored)
  await kv.sadd(TRACKER_PROFILE_USERNAMES_KEY, normalizedUsername)

  return {
    ok: true,
    storageConfigured: true,
    notFound: false,
    conflict: false,
    meta: {
      updatedAt,
      cardCount: encoded.counts.cardCount,
      performanceCount: encoded.counts.performanceCount,
    },
  }
}

export async function getTrackerProfileMeta(
  username: string,
  passphrase: string,
): Promise<{ meta: TrackerProfileMeta | null; storageConfigured: boolean; unauthorized: boolean }> {
  if (!profileSyncConfigured()) {
    return { meta: null, storageConfigured: false, unauthorized: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  let password: string
  try {
    password = assertValidAccountPassword(passphrase)
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

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, password)
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
  let password: string
  try {
    password = assertValidAccountPassword(passphrase)
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

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, password)
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

export type TrackerProfileTransfer = {
  username: string
  updatedAt: string
  cardCount: number
  performanceCount: number
  data?: unknown
  dataBlob?: string
  dataEncoding?: 'gzip-base64'
}

export async function getTrackerProfileTransfer(
  username: string,
  passphrase: string,
): Promise<{
  transfer: TrackerProfileTransfer | null
  storageConfigured: boolean
  unauthorized: boolean
}> {
  if (!profileSyncConfigured()) {
    return { transfer: null, storageConfigured: false, unauthorized: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  let password: string
  try {
    password = assertValidAccountPassword(passphrase)
  } catch (error) {
    if (!normalizedUsername) {
      return { transfer: null, storageConfigured: true, unauthorized: true }
    }
    throw error
  }
  if (!normalizedUsername) {
    return { transfer: null, storageConfigured: true, unauthorized: true }
  }

  const stored = await kv.get<StoredTrackerProfile | null>(profileKey(normalizedUsername))
  if (!stored) {
    return { transfer: null, storageConfigured: true, unauthorized: false }
  }

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, password)
  if (stored.passphraseHash !== passphraseHash) {
    return { transfer: null, storageConfigured: true, unauthorized: true }
  }

  return {
    transfer: {
      username: stored.username,
      updatedAt: stored.updatedAt,
      cardCount: stored.cardCount,
      performanceCount: stored.performanceCount,
      data: stored.data,
      dataBlob: stored.dataBlob,
      dataEncoding: stored.dataEncoding,
    },
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

  const password = assertValidAccountPassword(input.passphrase)
  const encoded = await encodeAndAssertSize(input.data)
  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  const passphraseHash = await hashSyncPassphrase(normalizedUsername, password)

  if (existing && existing.passphraseHash !== passphraseHash) {
    return { ok: false, storageConfigured: true, unauthorized: true, conflict: false }
  }

  if (input.ifUnmodifiedSince && existing && existing.updatedAt !== input.ifUnmodifiedSince) {
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
  const stored: StoredTrackerProfile = {
    username: normalizedUsername,
    passphraseHash,
    dataBlob: encoded.dataBlob,
    dataEncoding: encoded.dataEncoding,
    updatedAt,
    ...encoded.counts,
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
      cardCount: encoded.counts.cardCount,
      performanceCount: encoded.counts.performanceCount,
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

/** List every registered tracker account (no payload decode). */
export async function listTrackerProfilesForAdmin(): Promise<{
  profiles: TrackerProfileAdminSummary[]
  storageConfigured: boolean
}> {
  if (!profileSyncConfigured()) {
    return { profiles: [], storageConfigured: false }
  }

  const members = await kv.smembers(TRACKER_PROFILE_USERNAMES_KEY)
  const usernames = (members ?? [])
    .map((value) => normalizeRealUsername(String(value)))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))

  const profiles: TrackerProfileAdminSummary[] = []
  for (const username of usernames) {
    const stored = await kv.get<StoredTrackerProfile | null>(profileKey(username))
    if (!stored) continue
    profiles.push({
      username: stored.username,
      updatedAt: stored.updatedAt,
      cardCount: stored.cardCount,
      performanceCount: stored.performanceCount,
    })
  }

  return { profiles, storageConfigured: true }
}

export type TrackerProfilePackSnapshot = {
  plannedPasses: unknown[]
  packTrackers: unknown[]
  packAccountTemplates: unknown[]
}

/** Decode an account’s pack-tracking slice for Admin account trackers. */
export async function lookupTrackerProfilePacksForAdmin(
  username: string,
): Promise<{
  profile: TrackerProfileAdminSummary | null
  packs: TrackerProfilePackSnapshot | null
  storageConfigured: boolean
}> {
  if (!profileSyncConfigured()) {
    return { profile: null, packs: null, storageConfigured: false }
  }

  const normalizedUsername = normalizeRealUsername(username)
  if (!normalizedUsername) {
    return { profile: null, packs: null, storageConfigured: true }
  }

  const stored = await kv.get<StoredTrackerProfile | null>(profileKey(normalizedUsername))
  if (!stored) {
    return { profile: null, packs: null, storageConfigured: true }
  }

  const data = await decodeStoredProfilePayload(stored)
  const record =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : ({} as Record<string, unknown>)

  return {
    profile: {
      username: stored.username,
      updatedAt: stored.updatedAt,
      cardCount: stored.cardCount,
      performanceCount: stored.performanceCount,
    },
    packs: {
      plannedPasses: Array.isArray(record.plannedPasses) ? record.plannedPasses : [],
      packTrackers: Array.isArray(record.packTrackers) ? record.packTrackers : [],
      packAccountTemplates: Array.isArray(record.packAccountTemplates)
        ? record.packAccountTemplates
        : [],
    },
    storageConfigured: true,
  }
}

/** Admin password reset — keeps account data intact. */
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

  const normalizedUsername = assertValidAccountUsername(username)
  const password = assertValidAccountPassword(newPassphrase)
  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  if (!existing) {
    return { ok: false, notFound: true, storageConfigured: true }
  }

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, password)
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

/** Wipe every stored account / legacy cloud-sync profile. */
export async function adminDeleteAllTrackerProfiles(): Promise<{
  ok: boolean
  storageConfigured: boolean
  deleted: number
  usernames: string[]
}> {
  if (!profileSyncConfigured()) {
    return { ok: false, storageConfigured: false, deleted: 0, usernames: [] }
  }

  const members = await kv.smembers(TRACKER_PROFILE_USERNAMES_KEY)
  const usernames = (members ?? [])
    .map((value) => normalizeRealUsername(String(value)))
    .filter(Boolean)
    .sort()

  for (const username of usernames) {
    await kv.del(profileKey(username))
  }
  if (usernames.length > 0) {
    await kv.del(TRACKER_PROFILE_USERNAMES_KEY)
  }

  return {
    ok: true,
    storageConfigured: true,
    deleted: usernames.length,
    usernames,
  }
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

  const normalizedUsername = assertValidAccountUsername(input.username)
  const currentPassword = assertValidAccountPassword(input.currentPassphrase)
  const newPassword = assertValidAccountPassword(input.newPassphrase)
  if (currentPassword === newPassword) {
    throw new Error('New password must be different from the current password.')
  }

  const key = profileKey(normalizedUsername)
  const existing = await kv.get<StoredTrackerProfile | null>(key)
  if (!existing) {
    return { ok: false, notFound: true, unauthorized: false, storageConfigured: true }
  }

  const currentHash = await hashSyncPassphrase(normalizedUsername, currentPassword)
  if (existing.passphraseHash !== currentHash) {
    return { ok: false, notFound: false, unauthorized: true, storageConfigured: true }
  }

  const passphraseHash = await hashSyncPassphrase(normalizedUsername, newPassword)
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
