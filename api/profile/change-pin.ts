import { methodNotAllowed } from '../../lib/httpResponses'

import { requireAppSession } from '../admin/_helpers'
import { changeTrackerProfilePin, profileSyncConfigured } from '../../lib/trackerProfileStore'

export const config = {
  runtime: 'edge',
}

type ChangePinBody = {
  username?: unknown
  currentPin?: unknown
  newPin?: unknown
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  if (!profileSyncConfigured()) {
    return Response.json(
      { error: 'Cloud profile sync is not configured in this environment.', storageConfigured: false },
      { status: 503 },
    )
  }

  let body: ChangePinBody
  try {
    body = (await request.json()) as ChangePinBody
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username : ''
  const currentPin = typeof body.currentPin === 'string' ? body.currentPin : ''
  const newPin = typeof body.newPin === 'string' ? body.newPin : ''

  if (!username.trim() || !currentPin.trim() || !newPin.trim()) {
    return Response.json(
      { error: 'Username, current sync PIN, and new sync PIN are required.' },
      { status: 400 },
    )
  }

  try {
    const result = await changeTrackerProfilePin({
      username,
      currentPassphrase: currentPin,
      newPassphrase: newPin,
    })

    if (result.notFound) {
      return Response.json({ error: 'No cloud profile found for this username.' }, { status: 404 })
    }
    if (result.unauthorized) {
      return Response.json({ error: 'Current sync PIN is incorrect.' }, { status: 403 })
    }
    if (!result.ok || !result.meta) {
      return Response.json({ error: 'Could not change sync PIN.' }, { status: 500 })
    }

    return Response.json({
      ok: true,
      updatedAt: result.meta.updatedAt,
      cardCount: result.meta.cardCount,
      performanceCount: result.meta.performanceCount,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not change sync PIN.' },
      { status: 400 },
    )
  }
}
