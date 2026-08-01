import { readRequestJson } from '../../lib/cloudSyncCompression'
import {
  accountsConfigured,
  getAccountProfileForSession,
  saveAccountProfileForSession,
} from '../../lib/trackerProfileStore'
import { requireAccountSession } from '../admin/_helpers'

export const config = {
  runtime: 'edge',
}

type PutBody = {
  data?: unknown
  ifUnmodifiedSince?: unknown
}

export default async function handler(request: Request): Promise<Response> {
  const session = await requireAccountSession(request)
  if (session instanceof Response) return session

  if (!accountsConfigured()) {
    return Response.json(
      { error: 'Account storage is not configured in this environment.', storageConfigured: false },
      { status: 503 },
    )
  }

  if (request.method === 'GET') {
    const result = await getAccountProfileForSession(session.username)
    if (result.notFound || !result.transfer) {
      return Response.json({ error: 'Account data not found.' }, { status: 404 })
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
  }

  if (request.method === 'PUT') {
    let body: PutBody
    try {
      body = (await readRequestJson(request)) as PutBody
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const ifUnmodifiedSince =
      typeof body.ifUnmodifiedSince === 'string' ? body.ifUnmodifiedSince : undefined

    try {
      const result = await saveAccountProfileForSession({
        username: session.username,
        data: body.data,
        ifUnmodifiedSince,
      })

      if (result.notFound) {
        return Response.json({ error: 'Account data not found.' }, { status: 404 })
      }

      if (result.conflict && result.existingMeta) {
        return Response.json(
          {
            error: 'Account data was updated on another device.',
            existingMeta: result.existingMeta,
          },
          { status: 409 },
        )
      }

      if (!result.ok || !result.meta) {
        return Response.json({ error: 'Could not save account data.' }, { status: 500 })
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
        { error: error instanceof Error ? error.message : 'Could not save account data.' },
        { status: 400 },
      )
    }
  }

  return new Response('Method Not Allowed', { status: 405 })
}
