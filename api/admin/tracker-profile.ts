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

type ResetPasswordBody = {
  username?: unknown
  newPassword?: unknown
  /** Legacy alias from sync PIN UI. */
  newPin?: unknown
}

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  if (!profileSyncConfigured()) {
    return Response.json(
      { error: 'Account storage is not configured in this environment.', storageConfigured: false },
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
    let body: ResetPasswordBody
    try {
      body = (await request.json()) as ResetPasswordBody
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const username = typeof body.username === 'string' ? body.username : ''
    const newPassword =
      typeof body.newPassword === 'string'
        ? body.newPassword
        : typeof body.newPin === 'string'
          ? body.newPin
          : ''
    if (!username.trim() || !newPassword.trim()) {
      return Response.json({ error: 'Username and new password are required.' }, { status: 400 })
    }

    try {
      const result = await adminResetTrackerProfilePin(username, newPassword)
      if (result.notFound) {
        return Response.json({ error: 'No account found for this username.' }, { status: 404 })
      }
      if (!result.ok || !result.meta) {
        return Response.json({ error: 'Could not reset password.' }, { status: 500 })
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
        { error: error instanceof Error ? error.message : 'Could not reset password.' },
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
      return Response.json({ error: 'No account found for this username.' }, { status: 404 })
    }
    if (!result.ok) {
      return Response.json({ error: 'Could not delete account.' }, { status: 500 })
    }

    return Response.json({ ok: true })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
