import { adminStorageConfigured } from '../../lib/adminEventStore'
import { gzipJsonToBase64 } from '../../lib/cloudSyncCompression'
import { getImportOwnershipSnapshot } from '../../lib/importOwnershipStore'
import { normalizeRealUsername } from '../../lib/importOwnershipTypes'
import { requireAppSession } from '../admin/_helpers'

type OwnershipImportRequest = {
  username?: unknown
}

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  if (!adminStorageConfigured()) {
    return Response.json(
      { error: 'Ownership cache is not configured in this environment.' },
      { status: 503 },
    )
  }

  let body: OwnershipImportRequest
  try {
    body = (await request.json()) as OwnershipImportRequest
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const username = normalizeRealUsername(typeof body.username === 'string' ? body.username : '')
  if (!username) {
    return Response.json({ error: 'Username is required' }, { status: 400 })
  }

  const snapshot = await getImportOwnershipSnapshot(username)
  if (!snapshot) {
    return Response.json(
      {
        error:
          'No admin ownership snapshot found for this username yet. Ask admin to import this username before meowbot shutdown.',
      },
      { status: 404 },
    )
  }

  return Response.json({
    ok: true,
    source: 'admin_ownership_snapshot',
    username: snapshot.realUsername,
    importedAt: snapshot.importedAt,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.rarities ? { rarities: snapshot.rarities } : {}),
    passesEncoding: 'gzip-base64',
    passesPayload: await gzipJsonToBase64(snapshot.passes),
  })
}

