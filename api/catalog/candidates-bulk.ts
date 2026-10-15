import { methodNotAllowed } from '../../lib/httpResponses'

import { requireAppSession } from '../admin/_helpers'
import {
  fetchCatalogImportProfilesBulk,
  BULK_PROFILE_KEYS_MAX_REQUEST,
} from '../../lib/meowbotCatalogStore'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return methodNotAllowed()
    }

    const denied = await requireAppSession(request)
    if (denied) return denied

    let body: { externalKeys?: unknown }
    try {
      body = (await request.json()) as { externalKeys?: unknown }
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const externalKeys = Array.isArray(body.externalKeys)
      ? body.externalKeys.filter((key): key is string => typeof key === 'string')
      : []

    if (externalKeys.length === 0) {
      return Response.json({ error: 'externalKeys array is required' }, { status: 400 })
    }

    if (externalKeys.length > BULK_PROFILE_KEYS_MAX_REQUEST) {
      return Response.json(
        {
          error: `Too many passes in one request (max ${BULK_PROFILE_KEYS_MAX_REQUEST}). Hard-refresh the page (Ctrl+Shift+R) if this persists after updating.`,
        },
        { status: 400 },
      )
    }

    const result = await fetchCatalogImportProfilesBulk(externalKeys)
    return Response.json(result)
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Catalog bulk import failed.',
        storageConfigured: false,
      },
      { status: 500 },
    )
  }
}
