import { listTrackerProfilesForAdmin, profileSyncConfigured } from '../../lib/trackerProfileStore'
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

  if (!profileSyncConfigured()) {
    return Response.json(
      { error: 'Account storage is not configured in this environment.', storageConfigured: false },
      { status: 503 },
    )
  }

  const result = await listTrackerProfilesForAdmin()
  return Response.json({
    ok: true,
    profiles: result.profiles,
    storageConfigured: result.storageConfigured,
  })
}
