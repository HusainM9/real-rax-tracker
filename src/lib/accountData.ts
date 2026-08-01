import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'
import { buildGzipSyncPutBody } from '../../lib/cloudSyncRequest'
import { readResponseError, readResponseJson } from './readResponseJson'
import { importTrackerData } from './storage'
import type { RaxTrackerData } from '../types/rax'

export type AccountDataMeta = {
  updatedAt: string
  cardCount: number
  performanceCount: number
}

export type AccountDataLoadResult = {
  data: RaxTrackerData
  meta: AccountDataMeta
  storageConfigured: boolean
}

export type AccountDataSaveResult = {
  meta: AccountDataMeta
  storageConfigured: boolean
}

export class AccountDataConflictError extends Error {
  readonly existingUpdatedAt: string

  constructor(existingUpdatedAt: string, message = 'Account data was updated on another device.') {
    super(message)
    this.name = 'AccountDataConflictError'
    this.existingUpdatedAt = existingUpdatedAt
  }
}

async function parseError(response: Response): Promise<string> {
  return readResponseError(response, 'Account sync failed')
}

export async function loadAccountData(): Promise<AccountDataLoadResult> {
  const response = await fetch('/api/account/data', {
    credentials: 'include',
  })

  if (response.status === 503) {
    throw new Error('Account storage is not configured on this server.')
  }
  if (!response.ok) {
    throw new Error(await parseError(response))
  }

  const payload = await readResponseJson<{
    data?: unknown
    dataBlob?: string
    dataEncoding?: 'gzip-base64'
    updatedAt?: string
    cardCount?: number
    performanceCount?: number
    storageConfigured?: boolean
  }>(response)

  let rawData: unknown = payload.data
  if (payload.dataEncoding === 'gzip-base64' && typeof payload.dataBlob === 'string') {
    rawData = await gunzipBase64ToJson(payload.dataBlob)
  }

  const parsed = importTrackerData(JSON.stringify(rawData ?? {}))
  const reportedCards = Number(payload.cardCount) || 0
  const reportedPerformances = Number(payload.performanceCount) || 0
  if (reportedCards > 0 && parsed.cards.length === 0) {
    throw new Error(
      'Account data could not be restored — the server reported cards but none were returned.',
    )
  }
  if (reportedPerformances > 0 && parsed.performances.length === 0) {
    throw new Error(
      'Account data could not be restored — the server reported earnings rows but none were returned.',
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

export async function saveAccountData(
  data: RaxTrackerData,
  options?: { ifUnmodifiedSince?: string },
): Promise<AccountDataSaveResult> {
  const put = await buildGzipSyncPutBody({
    data,
    ifUnmodifiedSince: options?.ifUnmodifiedSince,
  })
  const response = await fetch('/api/account/data', {
    method: 'PUT',
    credentials: 'include',
    headers: put.headers,
    body: put.body as BodyInit,
  })

  if (response.status === 503) {
    throw new Error('Account storage is not configured on this server.')
  }

  if (response.status === 413) {
    throw new Error(
      'Account data is too large to sync (server limit). Export a local JSON backup, then remove unused saved profiles or potential cards before retrying.',
    )
  }

  if (response.status === 409) {
    const payload = await readResponseJson<{
      error?: string
      existingMeta?: { updatedAt?: string }
    }>(response)
    const existingUpdatedAt = payload.existingMeta?.updatedAt
    if (existingUpdatedAt) {
      throw new AccountDataConflictError(
        existingUpdatedAt,
        typeof payload.error === 'string' ? payload.error : undefined,
      )
    }
    throw new Error(payload.error ?? 'Account data was updated on another device.')
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
