import { dedupeCatalogPassSummaries } from './catalogPassIdentity'
import {
  canonicalCatalogPassMetadata,
  claimDayInPassSeason,
  filterDailyRowsToPassSeason,
  normalizeSportForSeasonWindow,
} from './seasonClaimWindow'

export type CatalogPassKind = 'player' | 'team'

export type CatalogPassInput = {
  externalKey: string
  entityId: number
  passKind: CatalogPassKind
  sport: string
  seasonYear: number
  seasonLabel: string
  name: string
  rarityLabel?: string
  /** Real CDN avatar key for player faces / team badges. */
  avatar?: string
  hasEarnings?: boolean
  totalBaseRax?: number
  sourceUpdatedAt?: string
}

export type CatalogDailyEarningInput = {
  externalKey: string
  claimDay: string
  baseRaxEarned: number
  playerBoxScoreId?: number | null
}

export type CatalogSearchResult = CatalogPassInput & {
  cachedAt: string
  sourceUpdatedAt?: string
  rowCount: number
  totalBaseRax: number
  latestClaimDay?: string
  /** Sum of base RAX in an active startDate–endDate browse window. */
  rangeBaseRax?: number
}

export type CatalogImportProfile = CatalogSearchResult & {
  /** Daily rows in Supabase before season-window filtering. */
  storedRowCount?: number
  rows: {
    claimDay: string
    baseRaxEarned: number
    playerBoxScoreId?: number | null
  }[]
}

type SupabasePassRow = {
  external_key: string
  entity_id: number
  pass_kind: CatalogPassKind
  sport: string
  season_year: number
  season_label: string
  name: string
  rarity_label?: string | null
  avatar?: string | null
  has_earnings: boolean
  total_base_rax: number | string
  source_updated_at?: string | null
  cached_at: string
  meowbot_daily_earnings?: Array<{ count: number }>
}

type SupabaseDailyRow = {
  external_key: string
  claim_day: string
  base_rax_earned: number | string
  player_box_score_id?: number | null
  cached_at?: string
}

const MAX_SEARCH_LIMIT = 50
const MAX_CANDIDATES_PAGE = 200
/** Max passes per HTTP bulk request — one pass query + one daily query per request. */
export const BULK_PROFILE_KEYS_MAX_REQUEST = 80
const PASS_UPSERT_BATCH_SIZE = 250
const DAILY_UPSERT_BATCH_SIZE = 200
const UPSERT_BATCH_PAUSE_MS = 300
const SUPABASE_MAX_RETRIES = 5
const SUPABASE_RETRY_BASE_MS = 1000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatSupabaseError(status: number, detail: string): string {
  const trimmed = detail.trim()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return `Supabase catalog request failed (${status}). The database gateway is temporarily unavailable — wait a minute and retry with a smaller import batch.`
  }
  if (trimmed.includes('57014') || trimmed.includes('statement timeout')) {
    return `Supabase catalog request failed (${status}). Database statement timed out — retry with a smaller import batch.`
  }
  if (trimmed.includes('40P01') || trimmed.includes('deadlock')) {
    return `Supabase catalog request failed (${status}). Database deadlock while saving catalog rows — retrying usually succeeds.`
  }
  if (trimmed.length > 400) {
    return `Supabase catalog request failed (${status}). ${trimmed.slice(0, 400)}…`
  }
  return `Supabase catalog request failed (${status}). ${trimmed}`.trim()
}

function isRetryableSupabaseError(status: number, detail: string): boolean {
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
    return true
  }
  if (
    status === 500 &&
    (detail.includes('57014') ||
      detail.includes('statement timeout') ||
      detail.includes('40P01') ||
      detail.includes('deadlock'))
  ) {
    return true
  }
  return false
}

let catalogWriteTail: Promise<unknown> = Promise.resolve()

function withCatalogWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = catalogWriteTail.then(fn, fn)
  catalogWriteTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function sortCatalogPasses(passes: CatalogPassInput[]): CatalogPassInput[] {
  return [...passes].sort((a, b) => a.externalKey.localeCompare(b.externalKey))
}

function sortCatalogDailyEarnings(rows: CatalogDailyEarningInput[]): CatalogDailyEarningInput[] {
  return [...rows]
    .filter(
      (row) =>
        row.externalKey &&
        /^\d{4}-\d{2}-\d{2}/.test(row.claimDay) &&
        Number.isFinite(row.baseRaxEarned) &&
        row.baseRaxEarned > 0,
    )
    .sort(
      (a, b) =>
        a.externalKey.localeCompare(b.externalKey) || a.claimDay.localeCompare(b.claimDay),
    )
}

async function upsertInBatches<T>(
  items: T[],
  batchSize: number,
  upsert: (batch: T[]) => Promise<number>,
): Promise<number> {
  let count = 0
  for (let index = 0; index < items.length; index += batchSize) {
    count += await upsert(items.slice(index, index + batchSize))
    if (index + batchSize < items.length) {
      await sleep(UPSERT_BATCH_PAUSE_MS)
    }
  }
  return count
}

export function meowbotCatalogConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  )
}

function normalizeSupabaseProjectUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/$/, '')
    .replace(/\/rest\/v1$/i, '')
}

function supabaseRestUrl(path: string, params?: URLSearchParams): string {
  const baseUrl = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL ?? '')
  if (!baseUrl) throw new Error('SUPABASE_URL is not configured.')
  const url = new URL(`${baseUrl}/rest/v1/${path}`)
  if (params) {
    for (const [key, value] of params) {
      url.searchParams.append(key, value)
    }
  }
  return url.toString()
}

function supabaseHeaders(prefer?: string): HeadersInit {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.')
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  }
}

async function supabaseFetch<T>(
  path: string,
  init: RequestInit & { params?: URLSearchParams } = {},
): Promise<T> {
  if (!meowbotCatalogConfigured()) {
    throw new Error('Meowbot catalog storage is not configured.')
  }

  const url = supabaseRestUrl(path, init.params)
  const requestInit: RequestInit = {
    ...init,
    headers: {
      ...supabaseHeaders(),
      ...(init.headers ?? {}),
    },
  }

  let lastError = 'Supabase catalog request failed.'
  for (let attempt = 0; attempt <= SUPABASE_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, requestInit)
    if (response.ok) {
      if (response.status === 204) return undefined as T
      const text = await response.text()
      if (!text) return undefined as T
      return JSON.parse(text) as T
    }

    const detail = await response.text().catch(() => '')
    lastError = formatSupabaseError(response.status, detail)
    if (attempt >= SUPABASE_MAX_RETRIES || !isRetryableSupabaseError(response.status, detail)) {
      throw new Error(lastError)
    }

    const delayMs = SUPABASE_RETRY_BASE_MS * 2 ** attempt
    await sleep(delayMs)
  }

  throw new Error(lastError)
}

function normalizeCatalogPassInput(pass: CatalogPassInput): CatalogPassInput {
  const canonical = canonicalCatalogPassMetadata({
    entityId: pass.entityId,
    sport: pass.sport,
    seasonYear: pass.seasonYear,
    seasonLabel: pass.seasonLabel,
  })
  return {
    ...pass,
    sport: normalizeSportForSeasonWindow(pass.sport),
    seasonYear: canonical.seasonYear,
    seasonLabel: canonical.seasonLabel,
    externalKey: canonical.externalKey,
  }
}

function filterDailyEarningsForPasses(
  passes: CatalogPassInput[],
  rows: CatalogDailyEarningInput[],
): CatalogDailyEarningInput[] {
  const passByKey = new Map(passes.map((pass) => [pass.externalKey, pass]))
  return rows.filter((row) => {
    const pass = passByKey.get(row.externalKey)
    if (!pass) return false
    return claimDayInPassSeason(row.claimDay, pass.seasonYear, pass.sport, pass.seasonLabel)
  })
}

/**
 * Replace stored earnings for passes that receive daily rows in this import (before season
 * filtering). Keys are cleared even when every incoming day is out-of-season, so leaked
 * prior-season rows cannot linger under the pass.
 */
export function catalogDailyEarningsReplaceKeys(
  passes: CatalogPassInput[],
  dailyEarnings: CatalogDailyEarningInput[],
): string[] {
  const passKeys = new Set(passes.map((pass) => normalizeCatalogPassInput(pass).externalKey))
  const keys = new Set<string>()
  for (const row of dailyEarnings) {
    if (passKeys.has(row.externalKey)) keys.add(row.externalKey)
  }
  for (const pass of passes.map(normalizeCatalogPassInput)) {
    if (pass.hasEarnings === false) keys.add(pass.externalKey)
  }
  return [...keys]
}

type CatalogPassUpsertRow = Omit<SupabasePassRow, 'cached_at' | 'rarity_label' | 'avatar'> & {
  rarity_label?: string | null
  avatar?: string | null
}

function toPassRow(input: CatalogPassInput): CatalogPassUpsertRow {
  const pass = normalizeCatalogPassInput(input)
  const row: CatalogPassUpsertRow = {
    external_key: pass.externalKey,
    entity_id: pass.entityId,
    pass_kind: pass.passKind,
    sport: pass.sport,
    season_year: pass.seasonYear,
    season_label: pass.seasonLabel,
    name: pass.name,
    has_earnings: pass.hasEarnings !== false,
    total_base_rax: Math.max(0, Number(pass.totalBaseRax) || 0),
    source_updated_at: pass.sourceUpdatedAt ?? null,
  }
  // Omit rarity on merge-upserts when unset so shop crawls / total-only updates keep existing labels.
  if (pass.rarityLabel !== undefined) {
    row.rarity_label = pass.rarityLabel.trim() ? pass.rarityLabel.trim() : null
  }
  // Same for avatar — earnings-only updates must not wipe faces/badges already stored.
  if (pass.avatar !== undefined) {
    row.avatar = pass.avatar.trim() ? pass.avatar.trim() : null
  }
  return row
}

/**
 * PostgREST rejects JSON arrays where objects have different key sets (PGRST102).
 * Partition so each upsert body is key-homogeneous while still omitting optional
 * columns (avatar / rarity_label) when unset — preserving merge-omit semantics.
 */
export function partitionByObjectKeySignature<T extends object>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const signature = Object.keys(row).sort().join(',')
    const existing = groups.get(signature)
    if (existing) existing.push(row)
    else groups.set(signature, [row])
  }
  return [...groups.values()]
}

/** Map passes to upsert rows and split into PostgREST-safe homogeneous batches. */
export function buildCatalogPassUpsertBatches(passes: CatalogPassInput[]): CatalogPassUpsertRow[][] {
  return partitionByObjectKeySignature(passes.map(toPassRow))
}

function toDailyRow(input: CatalogDailyEarningInput): Omit<SupabaseDailyRow, 'cached_at'> {
  return {
    external_key: input.externalKey,
    claim_day: input.claimDay,
    base_rax_earned: input.baseRaxEarned,
    player_box_score_id: input.playerBoxScoreId ?? null,
  }
}

function dailyRowCount(row: SupabasePassRow): number {
  const count = row.meowbot_daily_earnings?.[0]?.count
  return Number.isFinite(count) ? Number(count) : 0
}

function fromPassRow(row: SupabasePassRow): CatalogSearchResult {
  const rowCount = dailyRowCount(row)
  const canonical = canonicalCatalogPassMetadata({
    entityId: row.entity_id,
    sport: row.sport,
    seasonYear: row.season_year,
    seasonLabel: row.season_label,
  })
  return {
    externalKey: row.external_key,
    entityId: row.entity_id,
    passKind: row.pass_kind,
    sport: row.sport,
    seasonYear: canonical.seasonYear,
    seasonLabel: canonical.seasonLabel,
    name: row.name,
    rarityLabel: row.rarity_label ?? undefined,
    avatar: row.avatar?.trim() || undefined,
    hasEarnings: row.has_earnings ?? true,
    totalBaseRax: Number(row.total_base_rax) || 0,
    cachedAt: row.cached_at,
    sourceUpdatedAt: row.source_updated_at ?? undefined,
    rowCount,
  }
}

export function attachPassTotals(
  passes: CatalogPassInput[],
  dailyEarnings: CatalogDailyEarningInput[],
): CatalogPassInput[] {
  const totals = new Map<string, number>()
  for (const row of dailyEarnings) {
    totals.set(row.externalKey, (totals.get(row.externalKey) ?? 0) + row.baseRaxEarned)
  }

  return passes.map((pass) => ({
    ...pass,
    totalBaseRax: totals.get(pass.externalKey) ?? pass.totalBaseRax ?? 0,
  }))
}

/** Derive missing search-card totals from stored dailies without replacing valid pass aggregates. */
export function fillMissingCatalogSearchTotals(
  results: CatalogSearchResult[],
  dailyRows: Array<{
    external_key: string
    claim_day: string
    base_rax_earned: number | string
  }>,
): CatalogSearchResult[] {
  const rowsByKey = new Map<string, typeof dailyRows>()
  for (const row of dailyRows) {
    const bucket = rowsByKey.get(row.external_key)
    if (bucket) bucket.push(row)
    else rowsByKey.set(row.external_key, [row])
  }

  return results.map((result) => {
    if (result.totalBaseRax > 0 || result.rowCount === 0) return result
    const rows = rowsByKey.get(result.externalKey) ?? []
    const inSeason = filterDailyRowsToPassSeason(
      rows.map((row) => ({
        claimDay: row.claim_day,
        baseRaxEarned: Number(row.base_rax_earned) || 0,
      })),
      result.seasonYear,
      result.sport,
      result.seasonLabel,
    )
    const totalBaseRax = inSeason.reduce((sum, row) => sum + row.baseRaxEarned, 0)
    if (totalBaseRax <= 0) return result
    const computedLatestClaimDay = inSeason.reduce(
      (latest, row) => (row.claimDay > latest ? row.claimDay : latest),
      '',
    )

    return {
      ...result,
      totalBaseRax,
      latestClaimDay: (result.latestClaimDay ?? computedLatestClaimDay) || undefined,
    }
  })
}

function normalizeSearchQuery(query: string): string {
  return query
    .trim()
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

function quotedIn(values: string[]): string {
  return `in.(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(',')})`
}

function uniqueExternalKeys(keys: string[]): string[] {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))]
}

/** PostgREST filters live in the URL; large in.(...) lists hit HTTP 414. */
function forExternalKeyFilterBatches(keys: string[]): string[][] {
  const uniqueKeys = uniqueExternalKeys(keys)
  const batches: string[][] = []
  for (let index = 0; index < uniqueKeys.length; index += BULK_PROFILE_KEYS_MAX_REQUEST) {
    batches.push(uniqueKeys.slice(index, index + BULK_PROFILE_KEYS_MAX_REQUEST))
  }
  return batches
}

const DAILY_FETCH_PAGE_SIZE = 1000

async function fetchDailyRowsPage(
  filter: URLSearchParams,
  offset: number,
): Promise<SupabaseDailyRow[]> {
  const params = new URLSearchParams(filter)
  params.set('select', 'external_key,claim_day,base_rax_earned,player_box_score_id')
  params.set('order', 'claim_day.desc')
  params.set('limit', String(DAILY_FETCH_PAGE_SIZE))
  params.set('offset', String(offset))
  return supabaseFetch<SupabaseDailyRow[]>('meowbot_daily_earnings', { params })
}

const DAILY_FETCH_PAGE_CONCURRENCY = 4

async function fetchExactRowCount(table: string, filter: URLSearchParams): Promise<number> {
  const params = new URLSearchParams(filter)
  if (!params.has('select')) {
    params.set('select', 'external_key')
  }
  params.set('limit', '1')

  const url = supabaseRestUrl(table, params)
  let lastError = 'Supabase catalog count failed.'

  for (let attempt = 0; attempt <= SUPABASE_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, { headers: supabaseHeaders('count=exact') })
    if (response.ok) {
      const range = response.headers.get('content-range') ?? ''
      const total = Number(range.split('/')[1])
      return Number.isFinite(total) ? total : 0
    }

    const detail = await response.text().catch(() => '')
    lastError = formatSupabaseError(response.status, detail)
    if (attempt >= SUPABASE_MAX_RETRIES || !isRetryableSupabaseError(response.status, detail)) {
      throw new Error(lastError)
    }

    await sleep(SUPABASE_RETRY_BASE_MS * 2 ** attempt)
  }

  throw new Error(lastError)
}

async function fetchAllDailyRows(filter: URLSearchParams): Promise<SupabaseDailyRow[]> {
  const total = await fetchExactRowCount('meowbot_daily_earnings', filter)
  if (total === 0) return []

  const pageCount = Math.ceil(total / DAILY_FETCH_PAGE_SIZE)
  const rows: SupabaseDailyRow[] = []

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += DAILY_FETCH_PAGE_CONCURRENCY) {
    const pages = await Promise.all(
      Array.from({ length: Math.min(DAILY_FETCH_PAGE_CONCURRENCY, pageCount - pageIndex) }, (_, index) =>
        fetchDailyRowsPage(filter, (pageIndex + index) * DAILY_FETCH_PAGE_SIZE),
      ),
    )
    for (const page of pages) {
      rows.push(...page)
    }
  }

  return rows
}

async function fetchDailyRowsByExternalKeys(keys: string[]): Promise<SupabaseDailyRow[]> {
  const batches = forExternalKeyFilterBatches(keys)
  if (batches.length === 0) return []

  const rows: SupabaseDailyRow[] = []
  for (const batch of batches) {
    const filter = new URLSearchParams({ external_key: quotedIn(batch) })
    rows.push(...(await fetchAllDailyRows(filter)))
  }
  return rows
}

export async function searchCatalogPasses(options: {
  query: string
  limit?: number
}): Promise<{ results: CatalogSearchResult[]; storageConfigured: boolean }> {
  if (!meowbotCatalogConfigured()) {
    return { results: [], storageConfigured: false }
  }

  const query = normalizeSearchQuery(options.query)
  if (query.length < 2) {
    return { results: [], storageConfigured: true }
  }

  const limit = Math.min(Math.max(options.limit ?? 24, 1), MAX_SEARCH_LIMIT)
  const search = `*${query.replace(/\*/g, ' ')}*`
  const params = new URLSearchParams({
    select:
      'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,avatar,has_earnings,total_base_rax,source_updated_at,cached_at,meowbot_daily_earnings(count)',
    or: `(name.ilike.${search},sport.ilike.${search},season_label.ilike.${search})`,
    order: 'name.asc',
    limit: String(limit),
  })

  const passRows = await supabaseFetch<SupabasePassRow[]>('meowbot_passes', { params })
  const { items } = dedupeCatalogPassSummaries(passRows.map(fromPassRow))
  const missingTotalKeys = items
    .filter((item) => item.rowCount > 0 && item.totalBaseRax <= 0)
    .map((item) => item.externalKey)
  const results =
    missingTotalKeys.length > 0
      ? fillMissingCatalogSearchTotals(
          items,
          await fetchDailyRowsByExternalKeys(missingTotalKeys),
        )
      : items
  return {
    results,
    storageConfigured: true,
  }
}

function groupDailyRowsByKey(dailyRows: SupabaseDailyRow[]): Map<string, SupabaseDailyRow[]> {
  const byKey = new Map<string, SupabaseDailyRow[]>()
  for (const row of dailyRows) {
    const bucket = byKey.get(row.external_key)
    if (bucket) {
      bucket.push(row)
    } else {
      byKey.set(row.external_key, [row])
    }
  }
  return byKey
}

function buildImportProfileFromPass(
  pass: SupabasePassRow,
  dailyRowsForPass: SupabaseDailyRow[],
): CatalogImportProfile {
  const canonical = canonicalCatalogPassMetadata({
    entityId: pass.entity_id,
    sport: pass.sport,
    seasonYear: pass.season_year,
    seasonLabel: pass.season_label,
  })
  const allMappedRows = dailyRowsForPass
    .map((row) => ({
      claimDay: row.claim_day,
      baseRaxEarned: Number(row.base_rax_earned),
      playerBoxScoreId: row.player_box_score_id ?? undefined,
    }))
    .sort((a, b) => a.claimDay.localeCompare(b.claimDay))
  const mappedRows = filterDailyRowsToPassSeason(
    allMappedRows,
    canonical.seasonYear,
    pass.sport,
    canonical.seasonLabel,
  )
  const filteredOutOfSeason = mappedRows.length < allMappedRows.length
  // Prefer season-trimmed rows when prior-season days leaked into the key (NFL end→start
  // reclassification). Otherwise scale to stored total_base_rax if dailies still drift.
  const { rows, totalBaseRax } = filteredOutOfSeason
    ? {
        rows: mappedRows,
        totalBaseRax: mappedRows.reduce((sum, row) => sum + row.baseRaxEarned, 0),
      }
    : reconcileDailyRowsToPassTotal(Number(pass.total_base_rax) || 0, mappedRows)
  const base = fromPassRow(pass)
  const latestClaimDay = rows.length > 0 ? rows[rows.length - 1]?.claimDay : undefined
  return {
    ...base,
    rowCount: rows.length,
    storedRowCount: allMappedRows.length,
    totalBaseRax,
    latestClaimDay,
    rows,
  }
}

/** When daily rows disagree with pass metadata (NFL/NHL imports), scale rows to the stored total. */
export function reconcileDailyRowsToPassTotal(
  storedTotalBaseRax: number,
  rows: Array<{
    claimDay: string
    baseRaxEarned: number
    playerBoxScoreId?: number | null
  }>,
): {
  rows: Array<{
    claimDay: string
    baseRaxEarned: number
    playerBoxScoreId?: number | null
  }>
  totalBaseRax: number
} {
  if (rows.length === 0) {
    return { rows, totalBaseRax: storedTotalBaseRax }
  }

  const computedSum = rows.reduce((sum, row) => sum + row.baseRaxEarned, 0)
  if (storedTotalBaseRax <= 0 || computedSum <= 0) {
    return { rows, totalBaseRax: computedSum || storedTotalBaseRax }
  }

  const drift = Math.abs(computedSum - storedTotalBaseRax) / storedTotalBaseRax
  if (drift <= 0.01) {
    return { rows, totalBaseRax: computedSum }
  }

  const factor = storedTotalBaseRax / computedSum
  const scaledRows = rows.map((row) => ({
    ...row,
    baseRaxEarned: row.baseRaxEarned * factor,
  }))
  return { rows: scaledRows, totalBaseRax: storedTotalBaseRax }
}

export async function listCatalogPassSummaries(options: {
  sport: string
  passKind?: CatalogPassKind
  seasonYear?: number
  hasEarnings?: boolean
  /** Stop after this many passes (ordered by total_base_rax desc). */
  limit?: number
}): Promise<{ results: CatalogSearchResult[]; storageConfigured: boolean }> {
  if (!meowbotCatalogConfigured()) {
    return { results: [], storageConfigured: false }
  }

  const sport = options.sport.trim()
  if (!sport) {
    return { results: [], storageConfigured: true }
  }

  const passKind = options.passKind ?? 'player'
  const hasEarnings = options.hasEarnings !== false
  const maxResults =
    options.limit !== undefined
      ? Math.max(1, Math.min(Math.floor(options.limit), 10_000))
      : undefined
  const results: CatalogSearchResult[] = []

  for (let offset = 0; ; offset += MAX_CANDIDATES_PAGE) {
    if (maxResults !== undefined && results.length >= maxResults) break

    const pageLimit =
      maxResults !== undefined
        ? Math.min(MAX_CANDIDATES_PAGE, maxResults - results.length)
        : MAX_CANDIDATES_PAGE

    const params = new URLSearchParams({
      select:
        'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,avatar,has_earnings,total_base_rax,source_updated_at,cached_at,meowbot_daily_earnings(count)',
      sport: `eq.${sport}`,
      pass_kind: `eq.${passKind}`,
      has_earnings: `eq.${hasEarnings}`,
      order: 'total_base_rax.desc,name.asc',
      limit: String(pageLimit),
      offset: String(offset),
    })
    if (options.seasonYear !== undefined && Number.isFinite(options.seasonYear)) {
      params.set('season_year', `eq.${options.seasonYear}`)
    }

    const passRows = await supabaseFetch<SupabasePassRow[]>('meowbot_passes', { params })
    results.push(...passRows.map(fromPassRow))
    if (passRows.length < pageLimit) break
  }

  const { items } = dedupeCatalogPassSummaries(results)
  return { results: items, storageConfigured: true }
}

const MAX_BROWSE_LIMIT = 100
const DEFAULT_BROWSE_LIMIT = 50
const BROWSE_MONTH_DAY_YEAR_WINDOW = 12
const MAX_DATE_RANGE_DAYS = 62
const RANGE_DAILY_PAGE_SIZE = 1000
const MAX_RANGE_DAILY_PAGES = 80

function normalizeMonthDayFilter(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!/^\d{2}-\d{2}$/.test(trimmed)) return null
  const month = Number(trimmed.slice(0, 2))
  const day = Number(trimmed.slice(3, 5))
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  return trimmed
}

function normalizeOtdMonthFilter(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!/^\d{2}$/.test(trimmed)) return null
  const month = Number(trimmed)
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  return trimmed
}

function normalizeIsoDate(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const time = Date.parse(`${trimmed}T00:00:00Z`)
  if (!Number.isFinite(time)) return null
  return trimmed
}

function inclusiveDaySpan(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return -1
  return Math.floor((end - start) / 86_400_000) + 1
}

function lastDayOfMonth(year: number, month: string): string {
  const monthNum = Number(month)
  const day = new Date(Date.UTC(year, monthNum, 0)).getUTCDate()
  return String(day).padStart(2, '0')
}

function expandMonthDayClaimDays(monthDay: string, seasonYears: number[]): string[] {
  const years =
    seasonYears.length > 0
      ? [...new Set(seasonYears.filter((year) => Number.isFinite(year)))]
      : Array.from({ length: BROWSE_MONTH_DAY_YEAR_WINDOW }, (_, index) => {
          const now = new Date()
          return now.getUTCFullYear() - index
        })
  return years
    .sort((a, b) => b - a)
    .map((year) => `${year}-${monthDay}`)
}

function expandOtdMonthRanges(month: string, seasonYears: number[]): Array<{ start: string; end: string }> {
  const years =
    seasonYears.length > 0
      ? [...new Set(seasonYears.filter((year) => Number.isFinite(year)))]
      : Array.from({ length: BROWSE_MONTH_DAY_YEAR_WINDOW }, (_, index) => {
          const now = new Date()
          return now.getUTCFullYear() - index
        })
  return years
    .sort((a, b) => b - a)
    .map((year) => ({
      start: `${year}-${month}-01`,
      end: `${year}-${month}-${lastDayOfMonth(year, month)}`,
    }))
}

function expandOtdMonthClaimDays(month: string, seasonYears: number[]): string[] {
  const days: string[] = []
  for (const range of expandOtdMonthRanges(month, seasonYears)) {
    const start = Date.parse(`${range.start}T00:00:00Z`)
    const end = Date.parse(`${range.end}T00:00:00Z`)
    for (let time = start; time <= end; time += 86_400_000) {
      days.push(new Date(time).toISOString().slice(0, 10))
    }
  }
  return days
}

function quotedNumericIn(values: number[]): string {
  return `in.(${values.join(',')})`
}

function applyPassBrowseFilters(
  params: URLSearchParams,
  options: {
    sports: string[]
    seasonYears: number[]
    passKind?: CatalogPassKind
    query: string
    /** Prefix for embedded pass filters, e.g. `meowbot_passes.` */
    embedPrefix?: string
  },
): void {
  const prefix = options.embedPrefix ?? ''
  if (options.sports.length === 1) {
    params.set(`${prefix}sport`, `eq.${options.sports[0]}`)
  } else if (options.sports.length > 1) {
    params.set(`${prefix}sport`, quotedIn(options.sports))
  }

  if (options.seasonYears.length === 1) {
    params.set(`${prefix}season_year`, `eq.${options.seasonYears[0]}`)
  } else if (options.seasonYears.length > 1) {
    params.set(`${prefix}season_year`, quotedNumericIn(options.seasonYears))
  }

  if (options.passKind) {
    params.set(`${prefix}pass_kind`, `eq.${options.passKind}`)
  }

  if (options.query.length >= 2) {
    const search = `*${options.query.replace(/\*/g, ' ')}*`
    params.set(`${prefix}name`, `ilike.${search}`)
  }
}

type RangeDailyJoinRow = {
  external_key: string
  claim_day: string
  base_rax_earned: number | string
  meowbot_passes: SupabasePassRow | SupabasePassRow[] | null
}

function unwrapPassEmbed(
  value: SupabasePassRow | SupabasePassRow[] | null | undefined,
): SupabasePassRow | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

async function browseCatalogPassesByDateRange(options: {
  query: string
  sports: string[]
  seasonYears: number[]
  passKind?: CatalogPassKind
  startDate: string
  endDate: string
  limit: number
  offset: number
}): Promise<{ results: CatalogSearchResult[]; total: number; storageConfigured: boolean }> {
  const daySpan = inclusiveDaySpan(options.startDate, options.endDate)
  if (daySpan < 1) {
    return { results: [], total: 0, storageConfigured: true }
  }
  if (daySpan > MAX_DATE_RANGE_DAYS) {
    throw new Error(
      `Date range can be at most ${MAX_DATE_RANGE_DAYS} days. Narrow the range and try again.`,
    )
  }

  const passSelect =
    'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,avatar,has_earnings,total_base_rax,source_updated_at,cached_at'
  const params = new URLSearchParams({
    select: `external_key,claim_day,base_rax_earned,meowbot_passes!inner(${passSelect})`,
    and: `(claim_day.gte.${options.startDate},claim_day.lte.${options.endDate})`,
    order: 'external_key.asc,claim_day.asc',
  })
  applyPassBrowseFilters(params, {
    sports: options.sports,
    seasonYears: options.seasonYears,
    passKind: options.passKind,
    query: options.query,
    embedPrefix: 'meowbot_passes.',
  })

  const rangeTotals = new Map<string, { rax: number; pass: SupabasePassRow; days: number }>()

  for (let page = 0; page < MAX_RANGE_DAILY_PAGES; page += 1) {
    const pageParams = new URLSearchParams(params)
    pageParams.set('limit', String(RANGE_DAILY_PAGE_SIZE))
    pageParams.set('offset', String(page * RANGE_DAILY_PAGE_SIZE))
    const rows = await supabaseFetch<RangeDailyJoinRow[]>('meowbot_daily_earnings', {
      params: pageParams,
    })
    if (rows.length === 0) break

    for (const row of rows) {
      const pass = unwrapPassEmbed(row.meowbot_passes)
      if (!pass) continue
      const earned = Number(row.base_rax_earned) || 0
      if (earned <= 0) continue
      const existing = rangeTotals.get(row.external_key)
      if (existing) {
        existing.rax += earned
        existing.days += 1
      } else {
        rangeTotals.set(row.external_key, { rax: earned, pass, days: 1 })
      }
    }

    if (rows.length < RANGE_DAILY_PAGE_SIZE) break
  }

  const ranked = [...rangeTotals.values()].sort(
    (a, b) =>
      b.rax - a.rax ||
      a.pass.name.localeCompare(b.pass.name) ||
      a.pass.external_key.localeCompare(b.pass.external_key),
  )

  const pageSlice = ranked.slice(options.offset, options.offset + options.limit)
  const results = pageSlice.map((entry) => {
    const base = fromPassRow(entry.pass)
    return {
      ...base,
      rowCount: entry.days,
      rangeBaseRax: entry.rax,
    }
  })

  return { results, total: ranked.length, storageConfigured: true }
}

export async function browseCatalogPasses(options: {
  query?: string
  sports?: string[]
  seasonYears?: number[]
  passKind?: CatalogPassKind | 'all'
  monthDay?: string
  /** OTD month only (MM). Kept when no date range is set. */
  otdMonth?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}): Promise<{ results: CatalogSearchResult[]; total: number; storageConfigured: boolean }> {
  if (!meowbotCatalogConfigured()) {
    return { results: [], total: 0, storageConfigured: false }
  }

  const limit = Math.min(
    Math.max(Math.floor(options.limit ?? DEFAULT_BROWSE_LIMIT), 1),
    MAX_BROWSE_LIMIT,
  )
  const offset = Math.max(Math.floor(options.offset ?? 0), 0)
  const sports = [...new Set((options.sports ?? []).map((sport) => sport.trim()).filter(Boolean))]
  const seasonYears = [
    ...new Set(
      (options.seasonYears ?? []).filter((year) => Number.isFinite(year)).map((year) => Math.floor(year)),
    ),
  ]
  const query = normalizeSearchQuery(options.query ?? '')
  const monthDay = normalizeMonthDayFilter(options.monthDay)
  const otdMonth = normalizeOtdMonthFilter(options.otdMonth)
  const startDate = normalizeIsoDate(options.startDate)
  const endDate = normalizeIsoDate(options.endDate)
  const passKind =
    options.passKind === 'player' || options.passKind === 'team' ? options.passKind : undefined

  if (startDate && endDate) {
    return browseCatalogPassesByDateRange({
      query,
      sports,
      seasonYears,
      passKind,
      startDate: startDate <= endDate ? startDate : endDate,
      endDate: startDate <= endDate ? endDate : startDate,
      limit,
      offset,
    })
  }

  const monthClaimDays =
    !monthDay && otdMonth ? expandOtdMonthClaimDays(otdMonth, seasonYears) : null
  const useDailyJoin = Boolean(monthDay || (monthClaimDays && monthClaimDays.length > 0))
  const select = useDailyJoin
    ? 'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,avatar,has_earnings,total_base_rax,source_updated_at,cached_at,meowbot_daily_earnings!inner(claim_day)'
    : 'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,avatar,has_earnings,total_base_rax,source_updated_at,cached_at,meowbot_daily_earnings(count)'

  const params = new URLSearchParams({
    select,
    has_earnings: 'eq.true',
    order: 'total_base_rax.desc,name.asc',
    limit: String(limit),
    offset: String(offset),
  })

  applyPassBrowseFilters(params, { sports, seasonYears, passKind, query })

  if (monthDay) {
    const claimDays = expandMonthDayClaimDays(monthDay, seasonYears)
    if (claimDays.length === 0) {
      return { results: [], total: 0, storageConfigured: true }
    }
    params.set('meowbot_daily_earnings.claim_day', quotedIn(claimDays))
  } else if (monthClaimDays && monthClaimDays.length > 0) {
    params.set('meowbot_daily_earnings.claim_day', quotedIn(monthClaimDays))
  }

  const countFilter = new URLSearchParams(params)
  countFilter.delete('order')
  countFilter.delete('limit')
  countFilter.delete('offset')
  // Keep !inner embed in select so claim_day filters still apply to the count.
  countFilter.set(
    'select',
    useDailyJoin ? 'external_key,meowbot_daily_earnings!inner(claim_day)' : 'external_key',
  )

  const [total, passRows] = await Promise.all([
    fetchExactRowCount('meowbot_passes', countFilter),
    supabaseFetch<SupabasePassRow[]>('meowbot_passes', { params }),
  ])

  const { items } = dedupeCatalogPassSummaries(passRows.map(fromPassRow))
  return { results: items, total, storageConfigured: true }
}

async function fetchCatalogImportProfilesChunk(
  keys: string[],
): Promise<CatalogImportProfile[]> {
  if (keys.length === 0) return []

  const passParams = new URLSearchParams({
    select:
      'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,avatar,has_earnings,total_base_rax,source_updated_at,cached_at',
    external_key: quotedIn(keys),
  })
  const [passRows, dailyRows] = await Promise.all([
    supabaseFetch<SupabasePassRow[]>('meowbot_passes', { params: passParams }),
    fetchDailyRowsByExternalKeys(keys),
  ])
  const passByKey = new Map(passRows.map((row) => [row.external_key, row]))
  const dailyByKey = groupDailyRowsByKey(dailyRows)

  const profiles: CatalogImportProfile[] = []
  for (const key of keys) {
    const pass = passByKey.get(key)
    if (!pass) continue
    profiles.push(buildImportProfileFromPass(pass, dailyByKey.get(key) ?? []))
  }
  return profiles
}

export async function fetchCatalogImportProfilesBulk(
  externalKeys: string[],
): Promise<{ profiles: CatalogImportProfile[]; storageConfigured: boolean }> {
  if (!meowbotCatalogConfigured()) {
    return { profiles: [], storageConfigured: false }
  }

  const keys = [...new Set(externalKeys.map((key) => key.trim()).filter(Boolean))]
  if (keys.length === 0) {
    return { profiles: [], storageConfigured: true }
  }

  const profiles: CatalogImportProfile[] = []
  for (let index = 0; index < keys.length; index += BULK_PROFILE_KEYS_MAX_REQUEST) {
    const chunkKeys = keys.slice(index, index + BULK_PROFILE_KEYS_MAX_REQUEST)
    profiles.push(...(await fetchCatalogImportProfilesChunk(chunkKeys)))
  }

  return { profiles, storageConfigured: true }
}

export type CatalogPassAvatarRow = {
  externalKey: string
  entityId: number
  passKind: CatalogPassKind
  sport: string
  seasonYear: number
  seasonLabel: string
  name: string
  avatar?: string
}

function fromPassRowAvatar(row: SupabasePassRow): CatalogPassAvatarRow {
  const base = fromPassRow(row)
  return {
    externalKey: base.externalKey,
    entityId: base.entityId,
    passKind: base.passKind,
    sport: base.sport,
    seasonYear: base.seasonYear,
    seasonLabel: base.seasonLabel,
    name: base.name,
    avatar: base.avatar,
  }
}

/** Lightweight pass metadata + avatar lookup (no daily earnings). */
export async function fetchCatalogPassAvatars(
  externalKeys: string[],
): Promise<{ passes: CatalogPassAvatarRow[]; storageConfigured: boolean }> {
  if (!meowbotCatalogConfigured()) {
    return { passes: [], storageConfigured: false }
  }

  const keys = [...new Set(externalKeys.map((key) => key.trim()).filter(Boolean))]
  if (keys.length === 0) {
    return { passes: [], storageConfigured: true }
  }

  const passes: CatalogPassAvatarRow[] = []
  for (const batch of forExternalKeyFilterBatches(keys)) {
    const params = new URLSearchParams({
      select:
        'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,avatar,has_earnings,total_base_rax,source_updated_at,cached_at',
      external_key: quotedIn(batch),
    })
    const rows = await supabaseFetch<SupabasePassRow[]>('meowbot_passes', { params })
    const byKey = new Map(rows.map((row) => [row.external_key, row]))
    for (const key of batch) {
      const row = byKey.get(key)
      if (row) passes.push(fromPassRowAvatar(row))
    }
  }

  return { passes, storageConfigured: true }
}

/**
 * Find any stored avatar for the same entity+sport (other seasons), e.g. after an
 * avatars-only crawl filled one season but the owned card is a different year.
 */
export async function findCatalogAvatarForEntitySport(input: {
  entityId: number
  sport: string
  excludeExternalKey?: string
}): Promise<string | undefined> {
  if (!meowbotCatalogConfigured()) return undefined
  const sport = normalizeSportForSeasonWindow(input.sport)
  if (!input.entityId || !sport) return undefined

  const params = new URLSearchParams({
    select: 'avatar,external_key',
    entity_id: `eq.${input.entityId}`,
    sport: `eq.${sport}`,
    avatar: 'not.is.null',
    limit: '5',
  })
  const rows = await supabaseFetch<Array<{ avatar?: string | null; external_key: string }>>(
    'meowbot_passes',
    { params },
  )
  for (const row of rows) {
    if (input.excludeExternalKey && row.external_key === input.excludeExternalKey) continue
    const avatar = row.avatar?.trim()
    if (avatar) return avatar
  }
  return undefined
}

export type CatalogSeasonYearOption = {
  seasonYear: number
  seasonLabel: string
}

export async function listCatalogSeasonYears(options: {
  sport: string
  passKind?: CatalogPassKind
}): Promise<{ seasonYears: CatalogSeasonYearOption[]; storageConfigured: boolean }> {
  if (!meowbotCatalogConfigured()) {
    return { seasonYears: [], storageConfigured: false }
  }

  const sport = options.sport.trim()
  if (!sport) {
    return { seasonYears: [], storageConfigured: true }
  }

  const passKind = options.passKind ?? 'player'
  const byLabel = new Map<string, number>()

  for (let offset = 0; ; offset += MAX_CANDIDATES_PAGE) {
    const params = new URLSearchParams({
      select: 'season_year,season_label',
      sport: `eq.${sport}`,
      pass_kind: `eq.${passKind}`,
      order: 'season_year.desc',
      limit: String(MAX_CANDIDATES_PAGE),
      offset: String(offset),
    })

    const rows = await supabaseFetch<Array<{ season_year: number; season_label: string }>>(
      'meowbot_passes',
      { params },
    )

    for (const row of rows) {
      const canonical = canonicalCatalogPassMetadata({
        entityId: 0,
        sport,
        seasonYear: row.season_year,
        seasonLabel: row.season_label.trim() || String(row.season_year),
      })
      byLabel.set(
        canonical.seasonLabel,
        Math.max(byLabel.get(canonical.seasonLabel) ?? 0, canonical.seasonYear),
      )
    }

    if (rows.length < MAX_CANDIDATES_PAGE) break
  }

  const seasonYears = [...byLabel.entries()]
    .map(([seasonLabel, seasonYear]) => ({ seasonYear, seasonLabel }))
    .sort((a, b) => b.seasonYear - a.seasonYear || b.seasonLabel.localeCompare(a.seasonLabel))

  return { seasonYears, storageConfigured: true }
}

export async function getCatalogImportProfile(
  externalKey: string,
): Promise<{ profile: CatalogImportProfile | null; storageConfigured: boolean }> {
  if (!meowbotCatalogConfigured()) {
    return { profile: null, storageConfigured: false }
  }

  const passParams = new URLSearchParams({
    select:
      'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,avatar,has_earnings,total_base_rax,source_updated_at,cached_at',
    external_key: `eq.${externalKey}`,
    limit: '1',
  })
  const passRows = await supabaseFetch<SupabasePassRow[]>('meowbot_passes', { params: passParams })
  const pass = passRows[0]
  if (!pass) return { profile: null, storageConfigured: true }

  const dailyRows = await fetchDailyRowsByExternalKeys([externalKey])
  return {
    profile: buildImportProfileFromPass(pass, dailyRows),
    storageConfigured: true,
  }
}

async function deleteDailyEarningsByExternalKeys(keys: string[]): Promise<void> {
  for (const batch of forExternalKeyFilterBatches(keys)) {
    await supabaseFetch<void>('meowbot_daily_earnings', {
      method: 'DELETE',
      params: new URLSearchParams({ external_key: quotedIn(batch) }),
      headers: supabaseHeaders('return=minimal'),
    })
  }
}

async function upsertCatalogPassBatch(passes: CatalogPassInput[]): Promise<number> {
  if (passes.length === 0) return 0
  // Split by key signature so PostgREST does not reject mixed avatar/rarity omit rows (PGRST102).
  for (const rows of buildCatalogPassUpsertBatches(passes)) {
    await supabaseFetch<void>('meowbot_passes', {
      method: 'POST',
      params: new URLSearchParams({ on_conflict: 'external_key' }),
      headers: supabaseHeaders('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(rows),
    })
  }
  return passes.length
}

async function upsertCatalogDailyEarningBatch(rows: CatalogDailyEarningInput[]): Promise<number> {
  if (rows.length === 0) return 0
  await supabaseFetch<void>('meowbot_daily_earnings', {
    method: 'POST',
    params: new URLSearchParams({ on_conflict: 'external_key,claim_day' }),
    headers: supabaseHeaders('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(rows.map(toDailyRow)),
  })
  return rows.length
}

export async function upsertCatalogSnapshot(
  passes: CatalogPassInput[],
  dailyEarnings: CatalogDailyEarningInput[],
): Promise<{ passesUpserted: number; rowsUpserted: number }> {
  return withCatalogWriteLock(async () => {
    const normalizedPasses = sortCatalogPasses(passes.map(normalizeCatalogPassInput))
    const filteredEarnings = sortCatalogDailyEarnings(
      filterDailyEarningsForPasses(normalizedPasses, dailyEarnings),
    )
    const replaceKeys = catalogDailyEarningsReplaceKeys(normalizedPasses, dailyEarnings)

    const passesUpserted = await upsertInBatches(
      normalizedPasses,
      PASS_UPSERT_BATCH_SIZE,
      upsertCatalogPassBatch,
    )
    if (replaceKeys.length > 0) {
      await deleteDailyEarningsByExternalKeys(replaceKeys)
    }
    const rowsUpserted = await upsertInBatches(
      filteredEarnings,
      DAILY_UPSERT_BATCH_SIZE,
      upsertCatalogDailyEarningBatch,
    )
    return { passesUpserted, rowsUpserted }
  })
}

export async function upsertCatalogPasses(passes: CatalogPassInput[]): Promise<number> {
  return withCatalogWriteLock(() =>
    upsertInBatches(sortCatalogPasses(passes), PASS_UPSERT_BATCH_SIZE, upsertCatalogPassBatch),
  )
}

/**
 * Upsert daily earnings. When `replaceExternalKeys` is set, those keys are cleared first so
 * prior-season days cannot accumulate across re-imports (merge-only upserts caused NFL totals
 * like CMC 2022+2023 = 1033 under a 2023-24 key).
 */
export async function upsertCatalogDailyEarnings(
  rows: CatalogDailyEarningInput[],
  options?: { replaceExternalKeys?: string[] },
): Promise<number> {
  const validRows = sortCatalogDailyEarnings(rows)
  const replaceKeys = [
    ...new Set([
      ...(options?.replaceExternalKeys ?? []),
      ...validRows.map((row) => row.externalKey),
    ]),
  ]
  if (validRows.length === 0 && replaceKeys.length === 0) return 0
  return withCatalogWriteLock(async () => {
    if (replaceKeys.length > 0) {
      await deleteDailyEarningsByExternalKeys(replaceKeys)
    }
    if (validRows.length === 0) return 0
    return upsertInBatches(validRows, DAILY_UPSERT_BATCH_SIZE, upsertCatalogDailyEarningBatch)
  })
}

