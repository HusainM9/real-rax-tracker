import { requireAppSession } from '../admin/_helpers'
import { resolveCatalogAvatars } from '../../lib/catalogAvatarResolve'
import { BULK_PROFILE_KEYS_MAX_REQUEST } from '../../lib/meowbotCatalogStore'
import { resolveRealApiConfig, type RealApiContext } from '../../lib/realApi'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
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
          error: `Too many passes in one request (max ${BULK_PROFILE_KEYS_MAX_REQUEST}).`,
        },
        { status: 400 },
      )
    }

    const realConfig = resolveRealApiConfig()
    const realContext: RealApiContext | null = realConfig
      ? { config: realConfig, signal: request.signal }
      : null

    const result = await resolveCatalogAvatars(externalKeys, {
      signal: request.signal,
      realContext,
    })

    return Response.json(result)
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Catalog avatar resolve failed.',
        storageConfigured: false,
        avatars: [],
      },
      { status: 500 },
    )
  }
}
