import { requireAdminSession } from './_helpers'
import {
  fetchGlobalMeowbotCatalog,
  normalizeGlobalMeowbotCatalog,
} from '../../lib/meowbotGlobalCatalog'
import {
  attachPassTotals,
  meowbotCatalogConfigured,
  upsertCatalogSnapshot,
} from '../../lib/meowbotCatalogStore'

export const config = {
  runtime: 'edge',
}

async function readRequestPayload(request: Request): Promise<{
  sourceUrl?: string
  catalog?: unknown
}> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return {}
  }

  const body = (await request.json()) as {
    sourceUrl?: unknown
    catalog?: unknown
    passes?: unknown
    players?: unknown
    teams?: unknown
    rows?: unknown
    earnings?: unknown
    dailyEarnings?: unknown
  }

  const hasInlineCatalog = [
    body.catalog,
    body.passes,
    body.players,
    body.teams,
    body.rows,
    body.earnings,
    body.dailyEarnings,
  ].some((value) => value !== undefined)

  return {
    sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
    catalog: hasInlineCatalog ? (body.catalog ?? body) : undefined,
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAdminSession(request)
  if (denied) return denied

  if (!meowbotCatalogConfigured()) {
    return Response.json({ ok: false, storageConfigured: false }, { status: 503 })
  }

  const body = await readRequestPayload(request)
  const sourceUrl = body.sourceUrl ?? process.env.MEOWBOT_GLOBAL_CATALOG_URL?.trim()
  const token = process.env.MEOWBOT_GLOBAL_CATALOG_TOKEN

  if (!sourceUrl && !body.catalog) {
    return Response.json(
      {
        error:
          'Set MEOWBOT_GLOBAL_CATALOG_URL or POST a catalog payload as JSON from the admin session.',
      },
      { status: 400 },
    )
  }

  const payload = body.catalog ?? (await fetchGlobalMeowbotCatalog(sourceUrl!, token))
  const normalized = normalizeGlobalMeowbotCatalog(payload)

  if (normalized.passes.length === 0) {
    return Response.json(
      {
        error: 'No valid catalog passes were found in the Meowbot payload.',
        skipped: normalized.skipped,
      },
      { status: 400 },
    )
  }

  const passes = attachPassTotals(normalized.passes, normalized.dailyEarnings)
  const { passesUpserted, rowsUpserted } = await upsertCatalogSnapshot(
    passes,
    normalized.dailyEarnings,
  )

  return Response.json({
    ok: true,
    storageConfigured: true,
    passesScanned: normalized.passes.length,
    passesUpserted,
    rowsScanned: normalized.dailyEarnings.length,
    rowsUpserted,
    skipped: normalized.skipped,
  })
}

