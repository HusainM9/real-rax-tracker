import { adminStorageConfigured, appendAdminEvents, listAdminEvents } from '../../lib/adminEventStore'
import {
  isAdminEventType,
  validateAdminEventInput,
  type AdminEventInput,
} from '../../lib/adminEventTypes'
import { requireAdminSession, requireAppSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

const MAX_BATCH_SIZE = 50

type EventsBody = {
  events?: unknown[]
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    const appDenied = await requireAppSession(request)
    if (appDenied) return appDenied

    if (!adminStorageConfigured()) {
      return Response.json({ ok: true, stored: 0, storageConfigured: false })
    }

    let body: EventsBody
    try {
      body = (await request.json()) as EventsBody
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const rawEvents = Array.isArray(body.events) ? body.events : [body]
    if (rawEvents.length === 0) {
      return Response.json({ error: 'No events provided' }, { status: 400 })
    }
    if (rawEvents.length > MAX_BATCH_SIZE) {
      return Response.json({ error: `Maximum ${MAX_BATCH_SIZE} events per request` }, { status: 400 })
    }

    const events: AdminEventInput[] = []
    for (const raw of rawEvents) {
      const validated = validateAdminEventInput(raw)
      if (!validated) {
        return Response.json({ error: 'Invalid event payload' }, { status: 400 })
      }
      events.push(validated)
    }

    const stored = await appendAdminEvents(events)
    return Response.json({ ok: true, stored, storageConfigured: true })
  }

  if (request.method === 'GET') {
    const adminDenied = await requireAdminSession(request)
    if (adminDenied) return adminDenied

    const url = new URL(request.url)
    const typeParam = url.searchParams.get('type') ?? undefined
    const type = typeParam && isAdminEventType(typeParam) ? typeParam : undefined
    const username = url.searchParams.get('username') ?? undefined
    const limit = Number(url.searchParams.get('limit') ?? '100')
    const offset = Number(url.searchParams.get('offset') ?? '0')

    const result = await listAdminEvents({ type, username, limit, offset })
    return Response.json(result)
  }

  return new Response('Method Not Allowed', { status: 405 })
}
