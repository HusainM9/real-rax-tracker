import { methodNotAllowed } from '../../lib/httpResponses'

import { requireAppSession } from '../admin/_helpers'
import { cachedProfilesToCatalogPayload } from '../../lib/meowbotCatalogProfiles'
import {
  attachPassTotals,
  meowbotCatalogConfigured,
  upsertCatalogSnapshot,
} from '../../lib/meowbotCatalogStore'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  if (!meowbotCatalogConfigured()) {
    return Response.json({ ok: true, storageConfigured: false, passesUpserted: 0, rowsUpserted: 0 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const payload = body && typeof body === 'object' && 'profiles' in body
    ? (body as { profiles?: unknown }).profiles
    : body
  const catalog = cachedProfilesToCatalogPayload(payload)
  if (catalog.passes.length === 0) {
    return Response.json(
      {
        error: 'No valid cached profiles were found.',
        skipped: catalog.skipped,
      },
      { status: 400 },
    )
  }

  const passes = attachPassTotals(catalog.passes, catalog.dailyEarnings)
  const { passesUpserted, rowsUpserted } = await upsertCatalogSnapshot(passes, catalog.dailyEarnings)

  return Response.json({
    ok: true,
    storageConfigured: true,
    passesUpserted,
    rowsUpserted,
    skipped: catalog.skipped,
  })
}

