import {
  adminDeleteTrackerProfile,
  adminResetTrackerProfilePin,
  lookupTrackerProfileForAdmin,
  profileSyncConfigured,
} from '../../lib/trackerProfileStore'
import { requireAdminSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

type ResetPinBody = {
  username?: unknown
  newPin?: unknown
}

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  if (!profileSyncConfigured()) {
    return Response.json(
      { error: 'Cloud profile sync is not configured in this environment.', storageConfigured: false },
      { status: 503 },
    )
  }

  const url = new URL(request.url)
  const usernameParam = url.searchParams.get('username') ?? ''

  if (request.method === 'GET') {
    if (!usernameParam.trim()) {
      return Response.json({ error: 'Username is required.' }, { status: 400 })
    }

    const result = await lookupTrackerProfileForAdmin(usernameParam)
    return Response.json({
      profile: result.profile,
      storageConfigured: result.storageConfigured,
    })
  }

  if (request.method === 'POST') {
    let body: ResetPinBody
    try {
      body = (await request.json()) as ResetPinBody
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const username = typeof body.username === 'string' ? body.username : ''
    const newPin = typeof body.newPin === 'string' ? body.newPin : ''
    if (!username.trim() || !newPin.trim()) {
      return Response.json({ error: 'Username and new sync PIN are required.' }, { status: 400 })
    }

    try {
      const result = await adminResetTrackerProfilePin(username, newPin)
      if (result.notFound) {
        return Response.json({ error: 'No cloud profile found for this username.' }, { status: 404 })
      }
      if (!result.ok || !result.meta) {
        return Response.json({ error: 'Could not reset sync PIN.' }, { status: 500 })
      }

      return Response.json({
        ok: true,
        profile: {
          username: username.replace(/^@/, '').trim().toLowerCase(),
          updatedAt: result.meta.updatedAt,
          cardCount: result.meta.cardCount,
          performanceCount: result.meta.performanceCount,
        },
      })
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Could not reset sync PIN.' },
        { status: 400 },
      )
    }
  }

  if (request.method === 'DELETE') {
    if (!usernameParam.trim()) {
      return Response.json({ error: 'Username is required.' }, { status: 400 })
    }

    const result = await adminDeleteTrackerProfile(usernameParam)
    if (result.notFound) {
      return Response.json({ error: 'No cloud profile found for this username.' }, { status: 404 })
    }
    if (!result.ok) {
      return Response.json({ error: 'Could not delete cloud profile.' }, { status: 500 })
    }

    return Response.json({ ok: true })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
