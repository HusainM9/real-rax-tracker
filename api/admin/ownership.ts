import { adminStorageConfigured } from '../../lib/adminEventStore'
import { normalizeRealUsername, validateImportOwnershipSnapshot } from '../../lib/importOwnershipTypes'
import {
  getImportOwnershipSnapshot,
  listImportOwnershipSnapshotSummaries,
  upsertImportOwnershipSnapshot,
} from '../../lib/importOwnershipStore'
import { requireAdminSession, requireAppSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    const appDenied = await requireAppSession(request)
    if (appDenied) return appDenied

    if (!adminStorageConfigured()) {
      return Response.json({ ok: true, stored: false, storageConfigured: false })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const snapshot = validateImportOwnershipSnapshot(body)
    if (!snapshot) {
      return Response.json({ error: 'Invalid ownership snapshot' }, { status: 400 })
    }

    const stored = await upsertImportOwnershipSnapshot(snapshot)
    return Response.json({ ok: true, stored, storageConfigured: true })
  }

  if (request.method === 'GET') {
    const adminDenied = await requireAdminSession(request)
    if (adminDenied) return adminDenied

    const url = new URL(request.url)
    const listAll = url.searchParams.get('list') === '1'
    const username = normalizeRealUsername(url.searchParams.get('username') ?? '')

    if (listAll || !username) {
      const snapshots = await listImportOwnershipSnapshotSummaries()
      return Response.json({
        snapshots,
        storageConfigured: adminStorageConfigured(),
      })
    }

    const snapshot = await getImportOwnershipSnapshot(username)
    return Response.json({
      ownership: snapshot,
      storageConfigured: adminStorageConfigured(),
    })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
