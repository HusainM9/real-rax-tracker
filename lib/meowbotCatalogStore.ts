import { dedupeCatalogPassSummaries } from './catalogPassIdentity'
import {
  canonicalCatalogPassMetadata,
  claimDayInPassSeason,
  filterDailyRowsToPassSeason,
  normalizeSportForSeasonWindow,
  resolveCatalogPassSeasonYear,
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

/** Only replace stored earnings for passes that receive new daily rows in this import. */
export function catalogDailyEarningsReplaceKeys(
  passes: CatalogPassInput[],
  dailyEarnings: CatalogDailyEarningInput[],
): string[] {
  const normalizedPasses = passes.map(normalizeCatalogPassInput)
  const filteredEarnings = filterDailyEarningsForPasses(normalizedPasses, dailyEarnings)
  return [...new Set(filteredEarnings.map((row) => row.externalKey))]
}

function toPassRow(input: CatalogPassInput): Omit<SupabasePassRow, 'cached_at'> {
  const pass = normalizeCatalogPassInput(input)
  return {
    external_key: pass.externalKey,
    entity_id: pass.entityId,
    pass_kind: pass.passKind,
    sport: pass.sport,
    season_year: pass.seasonYear,
    season_label: pass.seasonLabel,
    name: pass.name,
    rarity_label: pass.rarityLabel ?? null,
    has_earnings: pass.hasEarnings !== false,
    total_base_rax: Math.max(0, Number(pass.totalBaseRax) || 0),
    source_updated_at: pass.sourceUpdatedAt ?? null,
  }
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
  const seasonYear = resolveCatalogPassSeasonYear(row.season_year, row.season_label, row.sport)
  return {
    externalKey: row.external_key,
    entityId: row.entity_id,
    passKind: row.pass_kind,
    sport: row.sport,
    seasonYear,
    seasonLabel: row.season_label,
    name: row.name,
    rarityLabel: row.rarity_label ?? undefined,
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
  params.set('select', 'external_key')
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
      'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,has_earnings,total_base_rax,source_updated_at,cached_at,meowbot_daily_earnings(count)',
    or: `(name.ilike.${search},sport.ilike.${search},season_label.ilike.${search})`,
    order: 'name.asc',
    limit: String(limit),
  })

  const passRows = await supabaseFetch<SupabasePassRow[]>('meowbot_passes', { params })
  const { items } = dedupeCatalogPassSummaries(passRows.map(fromPassRow))
  return {
    results: items,
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
  const allMappedRows = dailyRowsForPass.map((row) => ({
    claimDay: row.claim_day,
    baseRaxEarned: Number(row.base_rax_earned),
    playerBoxScoreId: row.player_box_score_id ?? undefined,
  }))
  const mappedRows = filterDailyRowsToPassSeason(
    allMappedRows,
    pass.season_year,
    pass.sport,
    pass.season_label,
  ).sort((a, b) => a.claimDay.localeCompare(b.claimDay))
  const filteredOutOfSeason = mappedRows.length < allMappedRows.length
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
        'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,has_earnings,total_base_rax,source_updated_at,cached_at,meowbot_daily_earnings(count)',
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

async function fetchCatalogImportProfilesChunk(
  keys: string[],
): Promise<CatalogImportProfile[]> {
  if (keys.length === 0) return []

  const passParams = new URLSearchParams({
    select:
      'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,has_earnings,total_base_rax,source_updated_at,cached_at',
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
      const seasonLabel = row.season_label.trim() || String(row.season_year)
      byLabel.set(seasonLabel, Math.max(byLabel.get(seasonLabel) ?? 0, row.season_year))
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
      'external_key,entity_id,pass_kind,sport,season_year,season_label,name,rarity_label,has_earnings,total_base_rax,source_updated_at,cached_at',
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
  await supabaseFetch<void>('meowbot_passes', {
    method: 'POST',
    params: new URLSearchParams({ on_conflict: 'external_key' }),
    headers: supabaseHeaders('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(passes.map(toPassRow)),
  })
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

export async function upsertCatalogDailyEarnings(rows: CatalogDailyEarningInput[]): Promise<number> {
  const validRows = sortCatalogDailyEarnings(rows)
  if (validRows.length === 0) return 0
  return withCatalogWriteLock(() =>
    upsertInBatches(validRows, DAILY_UPSERT_BATCH_SIZE, upsertCatalogDailyEarningBatch),
  )
}

