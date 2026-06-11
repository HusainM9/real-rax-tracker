import { listAdminUsers } from '../../lib/adminEventStore'
import { listImportOwnershipUsernames } from '../../lib/importOwnershipStore'
import {
  importMeowbotUsernameToCatalog,
  importOtdTablePassesToCatalog,
  importSpecificMeowbotPassToCatalog,
  type MeowbotCatalogImportSummary,
} from '../../lib/meowbotServerImport'
import {
  attachPassTotals,
  meowbotCatalogConfigured,
  upsertCatalogSnapshot,
} from '../../lib/meowbotCatalogStore'
import { manualCatalogUpsertPayload } from '../../lib/manualCatalogUpsert'
import { requireAdminSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

type ImportMode = 'saved-usernames' | 'usernames' | 'pass' | 'otd-table' | 'manual-upsert'

type RequestBody = {
  mode?: ImportMode
  usernames?: unknown
  limit?: unknown
  entityId?: unknown
  seasonYear?: unknown
  sport?: unknown
  passKind?: unknown
  name?: unknown
  rarityLabel?: unknown
  seasonLabel?: unknown
  seasons?: unknown
  includePlayers?: unknown
  includeTeams?: unknown
  maxPasses?: unknown
  rawJson?: unknown
  externalKey?: unknown
}

type UsernameSummary = {
  username: string
  passesScanned: number
  passesUpserted: number
  rowsUpserted: number
  passesWithNoEarnings: number
  failures: string[]
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

function parseSeasons(input: unknown): number[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : []
  return [...new Set(raw.map((item) => Number(item)).filter((season) => Number.isFinite(season) && season > 0))]
}

function numberValue(input: unknown): number | null {
  const value = Number(input)
  return Number.isFinite(value) ? value : null
}

async function persistSummary(summary: MeowbotCatalogImportSummary): Promise<{
  passesUpserted: number
  rowsUpserted: number
}> {
  const passes = attachPassTotals(summary.passes, summary.dailyEarnings)
  return upsertCatalogSnapshot(passes, summary.dailyEarnings)
}

async function savedUsernames(limit: number): Promise<string[]> {
  const [{ users }, ownershipUsernames] = await Promise.all([
    listAdminUsers(),
    listImportOwnershipUsernames(),
  ])
  return [...new Set([...users.map((user) => user.realUsername), ...ownershipUsernames])]
    .filter(Boolean)
    .slice(0, limit)
}

async function importUsernames(usernames: string[]): Promise<{
  usernamesImported: UsernameSummary[]
  totals: {
    usernames: number
    passesScanned: number
    passesUpserted: number
    rowsUpserted: number
    passesWithNoEarnings: number
    failures: number
  }
}> {
  const usernamesImported: UsernameSummary[] = []
  const totals = {
    usernames: 0,
    passesScanned: 0,
    passesUpserted: 0,
    rowsUpserted: 0,
    passesWithNoEarnings: 0,
    failures: 0,
  }

  for (const username of usernames) {
    try {
      const summary = await importMeowbotUsernameToCatalog(username)
      const persisted = await persistSummary(summary)
      const entry = {
        username,
        passesScanned: summary.passesScanned,
        passesUpserted: persisted.passesUpserted,
        rowsUpserted: persisted.rowsUpserted,
        passesWithNoEarnings: summary.passesWithNoEarnings,
        failures: summary.failures,
      }
      usernamesImported.push(entry)
      totals.usernames += 1
      totals.passesScanned += entry.passesScanned
      totals.passesUpserted += entry.passesUpserted
      totals.rowsUpserted += entry.rowsUpserted
      totals.passesWithNoEarnings += entry.passesWithNoEarnings
      totals.failures += entry.failures.length
    } catch (error) {
      usernamesImported.push({
        username,
        passesScanned: 0,
        passesUpserted: 0,
        rowsUpserted: 0,
        passesWithNoEarnings: 0,
        failures: [error instanceof Error ? error.message : 'Import failed'],
      })
      totals.failures += 1
    }
  }

  return { usernamesImported, totals }
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

  if (body.mode === 'saved-usernames') {
    const limit = Math.min(Math.max(Number(body.limit ?? 25), 1), MAX_USERNAMES)
    const usernames = await savedUsernames(limit)
    const result = await importUsernames(usernames)
    return Response.json({ ok: true, mode: body.mode, ...result })
  }

  if (body.mode === 'usernames') {
    const usernames = parseUsernames(body.usernames).slice(0, MAX_USERNAMES)
    if (usernames.length === 0) {
      return Response.json({ error: 'Enter at least one username.' }, { status: 400 })
    }
    const result = await importUsernames(usernames)
    return Response.json({ ok: true, mode: body.mode, ...result })
  }

  if (body.mode === 'pass') {
    const entityId = numberValue(body.entityId)
    const seasonYear = numberValue(body.seasonYear)
    const sport = typeof body.sport === 'string' ? body.sport.trim() : ''
    const passKind = body.passKind === 'team' ? 'team' : body.passKind === 'player' ? 'player' : null
    if (!entityId || !seasonYear || !sport || !passKind) {
      return Response.json(
        { error: 'entityId, seasonYear, sport, and passKind are required.' },
        { status: 400 },
      )
    }
    const summary = await importSpecificMeowbotPassToCatalog({
      entityId,
      seasonYear,
      sport,
      passKind,
      name: typeof body.name === 'string' ? body.name : undefined,
      rarityLabel: typeof body.rarityLabel === 'string' ? body.rarityLabel : undefined,
      seasonLabel: typeof body.seasonLabel === 'string' ? body.seasonLabel : undefined,
    })
    const persisted = await persistSummary(summary)
    return Response.json({
      ok: true,
      mode: body.mode,
      passesScanned: summary.passesScanned,
      passesUpserted: persisted.passesUpserted,
      rowsUpserted: persisted.rowsUpserted,
      passesWithNoEarnings: summary.passesWithNoEarnings,
      failures: summary.failures,
    })
  }

  if (body.mode === 'otd-table') {
    const seasons = parseSeasons(body.seasons)
    const maxPasses = numberValue(body.maxPasses)
    const summary = await importOtdTablePassesToCatalog({
      seasons,
      includePlayers: body.includePlayers !== false,
      includeTeams: body.includeTeams !== false,
      sport: typeof body.sport === 'string' ? body.sport : undefined,
      limit: maxPasses && maxPasses > 0 ? Math.min(maxPasses, 10000) : 250,
    })
    const persisted = await persistSummary(summary)
    return Response.json({
      ok: true,
      mode: body.mode,
      passesScanned: summary.passesScanned,
      passesUpserted: persisted.passesUpserted,
      rowsUpserted: persisted.rowsUpserted,
      passesWithNoEarnings: summary.passesWithNoEarnings,
      failures: summary.failures,
    })
  }

  if (body.mode === 'manual-upsert') {
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

  return Response.json({ error: 'Unknown import mode.' }, { status: 400 })
}

