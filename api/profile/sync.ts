import { requireAppSession } from '../admin/_helpers'
import {
  getTrackerProfileTransfer,
  profileSyncConfigured,
  saveTrackerProfile,
} from '../../lib/trackerProfileStore'

export const config = {
  runtime: 'edge',
}

type SyncGetQuery = {
  username?: string | null
  passphrase?: string | null
}

type SyncPutBody = {
  username?: unknown
  passphrase?: unknown
  data?: unknown
  ifUnmodifiedSince?: unknown
}

function queryParams(request: Request): SyncGetQuery {
  const url = new URL(request.url)
  return {
    username: url.searchParams.get('username'),
    passphrase: url.searchParams.get('passphrase'),
  }
}

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireAppSession(request)
  if (denied) return denied

  if (!profileSyncConfigured()) {
    return Response.json(
      { error: 'Cloud profile sync is not configured in this environment.', storageConfigured: false },
      { status: 503 },
    )
  }

  if (request.method === 'GET') {
    const { username, passphrase } = queryParams(request)
    if (!username?.trim() || !passphrase?.trim()) {
      return Response.json({ error: 'Username and sync PIN are required.' }, { status: 400 })
    }

    try {
      const result = await getTrackerProfileTransfer(username, passphrase)
      if (result.unauthorized) {
        return Response.json({ error: 'Incorrect sync PIN for this username.' }, { status: 403 })
      }
      if (!result.transfer) {
        return Response.json({ error: 'No cloud profile found for this username.' }, { status: 404 })
      }

      const transfer = result.transfer
      return Response.json({
        ok: true,
        storageConfigured: true,
        username: transfer.username,
        updatedAt: transfer.updatedAt,
        cardCount: transfer.cardCount,
        performanceCount: transfer.performanceCount,
        dataEncoding: transfer.dataEncoding,
        dataBlob: transfer.dataBlob,
        data: transfer.dataEncoding === 'gzip-base64' ? undefined : transfer.data,
      })
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Invalid sync PIN.' },
        { status: 400 },
      )
    }
  }

  if (request.method === 'PUT') {
    let body: SyncPutBody
    try {
      body = (await request.json()) as SyncPutBody
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const username = typeof body.username === 'string' ? body.username : ''
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : ''
    const ifUnmodifiedSince =
      typeof body.ifUnmodifiedSince === 'string' ? body.ifUnmodifiedSince : undefined

    if (!username.trim() || !passphrase.trim()) {
      return Response.json({ error: 'Username and sync PIN are required.' }, { status: 400 })
    }

    try {
      const result = await saveTrackerProfile({
        username,
        passphrase,
        data: body.data,
        ifUnmodifiedSince,
      })

      if (result.unauthorized) {
        return Response.json(
          { error: 'Incorrect sync PIN for this username. Cloud profile already exists with a different PIN.' },
          { status: 403 },
        )
      }

      if (result.conflict && result.existingMeta) {
        return Response.json(
          {
            error: 'Cloud profile was updated on another device.',
            existingMeta: result.existingMeta,
          },
          { status: 409 },
        )
      }

      if (!result.ok || !result.meta) {
        return Response.json({ error: 'Could not save cloud profile.' }, { status: 500 })
      }

      return Response.json({
        ok: true,
        storageConfigured: true,
        updatedAt: result.meta.updatedAt,
        cardCount: result.meta.cardCount,
        performanceCount: result.meta.performanceCount,
      })
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Could not save cloud profile.' },
        { status: 400 },
      )
    }
  }

  return new Response('Method Not Allowed', { status: 405 })
}
