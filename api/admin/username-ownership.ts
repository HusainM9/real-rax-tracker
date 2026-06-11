import { adminStorageConfigured } from '../../lib/adminEventStore'
import { persistUsernameOwnershipSnapshot } from '../../lib/usernameOwnershipImport'
import { requireAdminSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

type RequestBody = {
  usernames?: unknown
}

const MAX_USERNAMES = 50

function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.replace(/^@/, '').trim().toLowerCase() : ''
}

function parseUsernames(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : []
  return [...new Set(raw.map(normalizeUsername).filter(Boolean))]
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAdminSession(request)
  if (denied) return denied

  if (!adminStorageConfigured()) {
    return Response.json({ error: 'Ownership cache is not configured (link KV in Vercel).' }, { status: 503 })
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const usernames = parseUsernames(body.usernames).slice(0, MAX_USERNAMES)
  if (usernames.length === 0) {
    return Response.json({ error: 'Enter at least one username.' }, { status: 400 })
  }

  const usernamesSaved: Array<{
    username: string
    passesSaved: number
    error?: string
  }> = []
  const totals = {
    usernames: 0,
    passesSaved: 0,
    failures: 0,
  }

  for (const username of usernames) {
    try {
      const result = await persistUsernameOwnershipSnapshot(username)
      usernamesSaved.push({
        username: result.realUsername,
        passesSaved: result.passesSaved,
      })
      totals.usernames += 1
      totals.passesSaved += result.passesSaved
    } catch (error) {
      usernamesSaved.push({
        username,
        passesSaved: 0,
        error: error instanceof Error ? error.message : 'Ownership import failed',
      })
      totals.failures += 1
    }
  }

  return Response.json({
    ok: totals.failures === 0 || totals.usernames > 0,
    usernamesSaved,
    totals,
  })
}
