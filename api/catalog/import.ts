import { requireAppSession } from '../admin/_helpers'
import { getCatalogImportProfile } from '../../lib/meowbotCatalogStore'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  const url = new URL(request.url)
  const externalKey = url.searchParams.get('externalKey')?.trim() ?? ''
  if (!externalKey) {
    return Response.json({ error: 'externalKey is required' }, { status: 400 })
  }

  const result = await getCatalogImportProfile(externalKey)
  if (result.storageConfigured && !result.profile) {
    return Response.json({ error: 'Catalog pass was not found.' }, { status: 404 })
  }

  return Response.json(result)
}

