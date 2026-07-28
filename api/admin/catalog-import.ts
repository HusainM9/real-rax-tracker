import {
  attachPassTotals,
  meowbotCatalogConfigured,
  upsertCatalogSnapshot,
} from '../../lib/meowbotCatalogStore'
import { manualCatalogUpsertPayload } from '../../lib/manualCatalogUpsert'
import { requireAdminSession } from './_helpers'

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
}

type RequestBody = {
  mode?: 'manual-upsert'
  entityId?: unknown
  seasonYear?: unknown
  sport?: unknown
  passKind?: unknown
  name?: unknown
  rarityLabel?: unknown
  seasonLabel?: unknown
  rawJson?: unknown
  externalKey?: unknown
}

function numberValue(input: unknown): number | null {
  const value = Number(input)
  return Number.isFinite(value) ? value : null
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAdminSession(request)
  if (denied) return denied

  if (!meowbotCatalogConfigured()) {
    return Response.json({ error: 'Supabase catalog is not configured.' }, { status: 503 })
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (body.mode !== 'manual-upsert') {
    return Response.json(
      {
        error:
          'Only manual-upsert is supported. Meowbot username/OTD/pass imports were removed — use the Real shop crawl instead.',
      },
      { status: 400 },
    )
  }

  const entityId = numberValue(body.entityId)
  const seasonYear = numberValue(body.seasonYear)
  const sport = typeof body.sport === 'string' ? body.sport.trim() : ''
  const passKind = body.passKind === 'team' ? 'team' : body.passKind === 'player' ? 'player' : null
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const rawJson = typeof body.rawJson === 'string' ? body.rawJson : ''
  if (!entityId || !seasonYear || !sport || !passKind || !name) {
    return Response.json(
      { error: 'entityId, seasonYear, sport, passKind, name, and rawJson are required.' },
      { status: 400 },
    )
  }

  try {
    const payload = manualCatalogUpsertPayload({
      entityId,
      seasonYear,
      sport,
      passKind,
      name,
      rarityLabel: typeof body.rarityLabel === 'string' ? body.rarityLabel : undefined,
      seasonLabel: typeof body.seasonLabel === 'string' ? body.seasonLabel : undefined,
      externalKey: typeof body.externalKey === 'string' ? body.externalKey : undefined,
      rawJson,
    })
    const passes = attachPassTotals([payload.pass], payload.dailyEarnings)
    const persisted = await upsertCatalogSnapshot(passes, payload.dailyEarnings)
    return Response.json({
      ok: true,
      mode: body.mode,
      passesScanned: 1,
      passesUpserted: persisted.passesUpserted,
      rowsUpserted: persisted.rowsUpserted,
      passesWithNoEarnings: 0,
      skippedRows: payload.skipped,
      failures: [],
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Manual catalog upsert failed.' },
      { status: 400 },
    )
  }
}
