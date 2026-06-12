import { requireAppSession } from '../admin/_helpers'
import { fetchCatalogImportProfilesBulk } from '../../lib/meowbotCatalogStore'

export const config = {
  maxDuration: 60,
}

export default async function handler(request: Request): Promise<Response> {
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

  if (externalKeys.length > 50) {
    return Response.json({ error: 'externalKeys exceeds maximum of 50 per request' }, { status: 400 })
  }

  try {
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
