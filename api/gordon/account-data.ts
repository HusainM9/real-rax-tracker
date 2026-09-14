import { normalizeRealUsername } from '../../lib/importOwnershipTypes'
import { accountsConfigured, getAccountProfileForSession } from '../../lib/trackerProfileStore'
import { requireGordonSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  const session = await requireGordonSession(request)
  if (session instanceof Response) return session

  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!accountsConfigured()) {
    return Response.json(
      { error: 'Account storage is not configured in this environment.', storageConfigured: false },
      { status: 503 },
    )
  }

  const url = new URL(request.url)
  const username = normalizeRealUsername(url.searchParams.get('username') ?? '')
  if (!username) {
    return Response.json({ error: 'Username is required.' }, { status: 400 })
  }

  const result = await getAccountProfileForSession(username)
  if (result.notFound || !result.transfer) {
    return Response.json({ error: `No account found for @${username}.` }, { status: 404 })
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
