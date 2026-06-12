import { compactTrackerProfileForCloudSync } from '../../lib/cloudSyncPayload'
import { readResponseError, readResponseJson } from './readResponseJson'
import { importTrackerData } from './storage'
import type { RaxTrackerData } from '../types/rax'

export type CloudProfileMeta = {
  updatedAt: string
  cardCount: number
  performanceCount: number
}

export type CloudProfileLoadResult = {
  data: RaxTrackerData
  meta: CloudProfileMeta
  storageConfigured: boolean
}

export type CloudProfileSaveResult = {
  meta: CloudProfileMeta
  storageConfigured: boolean
}

async function parseError(response: Response): Promise<string> {
  return readResponseError(response, 'Cloud sync failed')
}

export async function loadCloudProfile(
  username: string,
  passphrase: string,
): Promise<CloudProfileLoadResult> {
  const params = new URLSearchParams({
    username: username.trim(),
    passphrase,
  })
  const response = await fetch(`/api/profile/sync?${params}`, {
    credentials: 'include',
  })

  if (response.status === 503) {
    throw new Error('Cloud profile sync is not configured on this server.')
  }
  if (!response.ok) {
    throw new Error(await parseError(response))
  }

  const payload = await readResponseJson<{
    data?: unknown
    updatedAt?: string
    cardCount?: number
    performanceCount?: number
    storageConfigured?: boolean
  }>(response)

  const parsed = importTrackerData(JSON.stringify(payload.data ?? {}))
  const reportedCards = Number(payload.cardCount) || 0
  const reportedPerformances = Number(payload.performanceCount) || 0
  if (reportedCards > 0 && parsed.cards.length === 0) {
    throw new Error(
      'Cloud profile could not be restored — the server reported cards but none were returned. Try saving again from your other device.',
    )
  }
  if (reportedPerformances > 0 && parsed.performances.length === 0) {
    throw new Error(
      'Cloud profile could not be restored — the server reported earnings rows but none were returned. Try saving again from your other device.',
    )
  }

  return {
    data: parsed,
    meta: {
      updatedAt: payload.updatedAt ?? new Date().toISOString(),
      cardCount: parsed.cards.length || reportedCards,
      performanceCount: parsed.performances.length || reportedPerformances,
    },
    storageConfigured: payload.storageConfigured !== false,
  }
}

export async function saveCloudProfile(
  username: string,
  passphrase: string,
  data: RaxTrackerData,
  options?: { ifUnmodifiedSince?: string },
): Promise<CloudProfileSaveResult> {
  const response = await fetch('/api/profile/sync', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: username.trim(),
      passphrase,
      data: compactTrackerProfileForCloudSync(data),
      ifUnmodifiedSince: options?.ifUnmodifiedSince,
    }),
  })

  if (response.status === 503) {
    throw new Error('Cloud profile sync is not configured on this server.')
  }
  if (!response.ok) {
    throw new Error(await parseError(response))
  }

  const payload = await readResponseJson<{
    updatedAt?: string
    cardCount?: number
    performanceCount?: number
    storageConfigured?: boolean
  }>(response)

  return {
    meta: {
      updatedAt: payload.updatedAt ?? new Date().toISOString(),
      cardCount: Number(payload.cardCount) || 0,
      performanceCount: Number(payload.performanceCount) || 0,
    },
    storageConfigured: payload.storageConfigured !== false,
  }
}

export async function changeCloudProfilePin(
  username: string,
  currentPin: string,
  newPin: string,
): Promise<{ meta: CloudProfileMeta; storageConfigured: boolean }> {
  const response = await fetch('/api/profile/change-pin', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: username.trim(),
      currentPin,
      newPin,
    }),
  })

  if (response.status === 503) {
    throw new Error('Cloud profile sync is not configured on this server.')
  }
  if (!response.ok) {
    throw new Error(await parseError(response))
  }

  const payload = await readResponseJson<{
    updatedAt?: string
    cardCount?: number
    performanceCount?: number
    storageConfigured?: boolean
  }>(response)

  return {
    meta: {
      updatedAt: payload.updatedAt ?? new Date().toISOString(),
      cardCount: Number(payload.cardCount) || 0,
      performanceCount: Number(payload.performanceCount) || 0,
    },
    storageConfigured: payload.storageConfigured !== false,
  }
}

export function formatCloudProfileMeta(meta: CloudProfileMeta): string {
  const updated = new Date(meta.updatedAt)
  const timestamp = Number.isNaN(updated.getTime())
    ? meta.updatedAt
    : updated.toLocaleString()
  return `${meta.cardCount} card${meta.cardCount === 1 ? '' : 's'} · ${meta.performanceCount} earnings row${meta.performanceCount === 1 ? '' : 's'} · updated ${timestamp}`
}
