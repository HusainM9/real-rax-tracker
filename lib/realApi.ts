import Hashids from 'hashids'
import { getRealAppToolsRows } from './realAppToolsPaste'

const DEFAULT_BASE_URL = 'https://web.realapp.com'
const DEFAULT_DEVICE_TYPE = 'desktop_web'
const DEFAULT_DEVICE_NAME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const DEFAULT_VERSION = '35'
const DEFAULT_TIMEOUT_MS = 12000
/** Upstream Real calls in parallel per serverless batch. Keep low — cold imports used to hit 429s at 6. */
const DEFAULT_CONCURRENCY = 2
/** Attempts after the first try (so maxRetries=5 ⇒ up to 6 total requests). */
const DEFAULT_MAX_RETRIES = 5
const DEFAULT_RETRY_BASE_MS = 750
const DEFAULT_RETRY_MAX_MS = 20_000

/** Recovered from Real's public web bundle: Hashids('realwebapp', 16).encode(Date.now()). */
const REQUEST_TOKEN_SALT = 'realwebapp'
const REQUEST_TOKEN_MIN_LENGTH = 16

export type RealApiConfig = {
  baseUrl: string
  authInfo: string
  sessionToken: string
  deviceUuid: string
  deviceName: string
  deviceType: string
  version: string
  timeoutMs: number
  /**
   * Upstream Real calls in parallel inside one earnings (or pass-scan) batch.
   * Override with REAL_IMPORT_CONCURRENCY.
   */
  concurrency: number
  /** Extra attempts after a rate_limited / 429 response. Override with REAL_IMPORT_MAX_RETRIES. */
  maxRetries: number
  /** Base delay before the first retry; doubles each attempt (capped). REAL_IMPORT_RETRY_BASE_MS. */
  retryBaseMs: number
  /** Cap for exponential backoff. REAL_IMPORT_RETRY_MAX_MS. */
  retryMaxMs: number
}

export type RealApiErrorKind =
  | 'auth'
  | 'not_found'
  | 'rate_limited'
  | 'upstream'
  | 'timeout'
  | 'network'
  | 'invalid_response'

export class RealApiError extends Error {
  readonly kind: RealApiErrorKind
  readonly status?: number

  constructor(kind: RealApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'RealApiError'
    this.kind = kind
    this.status = status
  }
}

function readEnv(env: Record<string, string | undefined>, key: string): string {
  return env[key]?.trim() ?? ''
}

function readPositiveInt(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function isTruthyFlag(value: string): boolean {
  const flag = value.toLowerCase()
  return flag === 'true' || flag === '1' || flag === 'yes'
}

/**
 * Credentials come from the environment only — never hardcode or log their values.
 * Returns null when the import is disabled or any required credential is missing.
 */
export function resolveRealApiConfig(
  env: Record<string, string | undefined> = process.env,
): RealApiConfig | null {
  if (!isTruthyFlag(readEnv(env, 'REAL_IMPORT_ENABLED'))) return null

  const authInfo = readEnv(env, 'REAL_AUTH_INFO')
  const sessionToken = readEnv(env, 'REAL_SESSION_TOKEN')
  const deviceUuid = readEnv(env, 'REAL_DEVICE_UUID')
  if (!authInfo || !sessionToken || !deviceUuid) return null

  return {
    baseUrl: (readEnv(env, 'REAL_BASE_URL') || DEFAULT_BASE_URL).replace(/\/$/, ''),
    authInfo,
    sessionToken,
    deviceUuid,
    deviceName: readEnv(env, 'REAL_DEVICE_NAME') || DEFAULT_DEVICE_NAME,
    deviceType: readEnv(env, 'REAL_DEVICE_TYPE') || DEFAULT_DEVICE_TYPE,
    version: readEnv(env, 'REAL_VERSION') || DEFAULT_VERSION,
    timeoutMs: readPositiveInt(readEnv(env, 'REAL_IMPORT_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS),
    concurrency: readPositiveInt(readEnv(env, 'REAL_IMPORT_CONCURRENCY'), DEFAULT_CONCURRENCY),
    maxRetries: readPositiveInt(readEnv(env, 'REAL_IMPORT_MAX_RETRIES'), DEFAULT_MAX_RETRIES),
    retryBaseMs: readPositiveInt(readEnv(env, 'REAL_IMPORT_RETRY_BASE_MS'), DEFAULT_RETRY_BASE_MS),
    retryMaxMs: readPositiveInt(readEnv(env, 'REAL_IMPORT_RETRY_MAX_MS'), DEFAULT_RETRY_MAX_MS),
  }
}

/** Full-jitter delay for attempt `attempt` (0 = first retry after the initial failure). */
export function realApiRetryDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  return Math.min(maxMs, Math.floor(random() * (exp + 1)))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const asSeconds = Number(header)
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.floor(asSeconds * 1000)
  const asDate = Date.parse(header)
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now())
  return null
}

/** Presence-only view of the credential set — safe to log. */
export function realImportConfigStatus(
  env: Record<string, string | undefined> = process.env,
): Record<string, boolean> {
  return {
    enabled: isTruthyFlag(readEnv(env, 'REAL_IMPORT_ENABLED')),
    hasAuthInfo: readEnv(env, 'REAL_AUTH_INFO').length > 0,
    hasSessionToken: readEnv(env, 'REAL_SESSION_TOKEN').length > 0,
    hasDeviceUuid: readEnv(env, 'REAL_DEVICE_UUID').length > 0,
  }
}

export function buildRealRequestToken(now = Date.now()): string {
  return new Hashids(REQUEST_TOKEN_SALT, REQUEST_TOKEN_MIN_LENGTH).encode(now)
}

export function buildRealHeaders(config: RealApiConfig, now = Date.now()): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'real-auth-info': config.authInfo,
    'real-session-token': config.sessionToken,
    'real-device-uuid': config.deviceUuid,
    'real-device-type': config.deviceType,
    'real-device-name': config.deviceName,
    'real-version': config.version,
    'real-request-token': buildRealRequestToken(now),
  }
}

export type RealApiContext = {
  config: RealApiConfig
  signal?: AbortSignal
}

function abortableSignal(
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function buildUrl(
  config: RealApiConfig,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * Low-level authenticated GET against Real. Exported so new endpoints (for example
 * /userpassearnings/{sport}/season/{season}/entity/{entityType}/{entityId} for the
 * per-day RAX backfill) only need a typed wrapper, not new transport code.
 *
 * Rate limits (HTTP 429 / `rate_limited`) are retried with exponential backoff + full jitter
 * before the error is surfaced to the caller.
 */
export async function realGetJson<T>(
  path: string,
  context: RealApiContext,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const { config } = context
  const url = buildUrl(config, path, query)
  const maxAttempts = Math.max(1, config.maxRetries + 1)
  let lastRateLimitError: RealApiError | null = null
  let pendingDelayMs: number | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (context.signal?.aborted) {
      throw context.signal.reason instanceof Error
        ? context.signal.reason
        : new DOMException('Aborted', 'AbortError')
    }

    if (attempt > 0) {
      const delay =
        pendingDelayMs ?? realApiRetryDelayMs(attempt - 1, config.retryBaseMs, config.retryMaxMs)
      pendingDelayMs = null
      await sleep(delay, context.signal)
    }

    const timeout = abortableSignal(config.timeoutMs, context.signal)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: buildRealHeaders(config),
        signal: timeout.signal,
      })
    } catch (error) {
      if (timeout.timedOut()) {
        throw new RealApiError('timeout', `Real API request timed out after ${config.timeoutMs}ms.`)
      }
      if (context.signal?.aborted) {
        throw error
      }
      throw new RealApiError(
        'network',
        `Could not reach Real API: ${error instanceof Error ? error.message : 'unknown error'}.`,
      )
    } finally {
      timeout.dispose()
    }

    if (response.status === 401 || response.status === 403) {
      throw new RealApiError(
        'auth',
        'Real rejected the bot session (401). The bot session needs refreshing.',
        response.status,
      )
    }
    if (response.status === 404) {
      throw new RealApiError('not_found', 'Real API returned 404 for this request.', 404)
    }
    if (response.status === 429) {
      lastRateLimitError = new RealApiError(
        'rate_limited',
        'Real API rate limited this request (429).',
        429,
      )
      const fromHeader = retryAfterMs(response)
      pendingDelayMs =
        fromHeader != null
          ? Math.min(config.retryMaxMs, fromHeader)
          : null
      continue
    }
    if (!response.ok) {
      throw new RealApiError('upstream', `Real API request failed (${response.status}).`, response.status)
    }

    const text = await response.text()
    try {
      return JSON.parse(text) as T
    } catch {
      throw new RealApiError('invalid_response', 'Real API returned a non-JSON response.')
    }
  }

  throw (
    lastRateLimitError ??
    new RealApiError('rate_limited', 'Real API rate limited this request (429).', 429)
  )
}

export type RealUser = {
  id: string
  userName: string
}

export type RealBoostInfo = {
  rarityLabel?: string
  /** Real returns the OTD multiplier per pass, e.g. "150x". Unused for now. */
  multiplier?: string
  level?: number
  /** Play-rating progress toward the next rarity tier (from Real `boostInfo.progress`). */
  progress?: number
  /** Play rating still needed for the next tier. */
  required?: number
  progressDisplay?: string
  progressQualifier?: string
}

/** Nested player/team entity on a Real pass (avatar key → media.realapp.com CDN). */
export type RealPassEntity = {
  id?: number | string
  avatar?: string
  [key: string]: unknown
}

export type RealPass = {
  /** Pass instance id — distinct per owned copy of the same entity/season. */
  id?: string | number
  entityType?: string
  entityId?: number | string
  sport?: string
  season?: number | string
  label?: string
  seasonDisplay?: string
  /** Lifetime RAX aggregate, not per-day. */
  earned?: number
  serialNumber?: number
  isRefunded?: boolean
  isActive?: boolean
  /** Play rating for this copy (unlocks rarity). Not an earnings multiplier. */
  boostValue?: number | string | null
  boostValueDisplay?: string | null
  boosterCardId?: number | string | null
  boosterCardInfo?: unknown
  boostInfo?: RealBoostInfo | null
  /** Nested entity — source of player face / team badge avatar keys. */
  entity?: RealPassEntity | null
  /** Club/franchise id for the player; team passes use entityId instead. */
  teamId?: number | string | null
}

export type RealCollectingInfo = {
  sportSeasonMap: Record<string, unknown[]>
  sportEntityTypeMap: Record<string, unknown[]>
}

/** Omit every filter to fetch the whole collection in one request. */
export type RealPassQuery = {
  userId: string
  entityType?: string
  season?: number
  sport?: string
}

export function normalizeRealUsernameInput(username: string): string {
  return username.replace(/^@/, '').trim()
}

export async function getUserByUsername(username: string, context: RealApiContext): Promise<RealUser> {
  const trimmed = normalizeRealUsernameInput(username)
  if (!trimmed) {
    throw new RealApiError('not_found', 'Enter a Real username.')
  }

  const data = await realGetJson<{ user?: { id?: unknown; userName?: unknown } }>(
    `/user/${encodeURIComponent(trimmed)}`,
    context,
  )
  const id = typeof data.user?.id === 'string' ? data.user.id.trim() : ''
  if (!id) {
    throw new RealApiError('not_found', `No Real user found for @${trimmed}.`)
  }
  return {
    id,
    userName: typeof data.user?.userName === 'string' ? data.user.userName : trimmed,
  }
}

/**
 * Sport/season/entity-type availability for a user. The default scan does not need this
 * (one unfiltered /userpasses call returns everything) — it is kept for targeted refreshes
 * and diagnostics.
 */
export async function getCollectingInfo(
  userId: string,
  context: RealApiContext,
): Promise<RealCollectingInfo> {
  const data = await realGetJson<{ info?: Partial<RealCollectingInfo> }>(
    `/collecting/${encodeURIComponent(userId)}/info`,
    context,
  )
  return {
    sportSeasonMap: (data.info?.sportSeasonMap ?? {}) as Record<string, unknown[]>,
    sportEntityTypeMap: (data.info?.sportEntityTypeMap ?? {}) as Record<string, unknown[]>,
  }
}

/** Row shape of Real's per-pass earnings response, matching `RealAppToolsRow`. */
export type RealEarningsRow = {
  day?: unknown
  earnings?: unknown
  player_box_score_id?: unknown
  playerBoxScoreIds?: unknown
}

export type RealPassEarningsQuery = {
  /** Real's own sport slug (`soccer`, not the canonical `fc`). */
  sport: string
  season: number
  entityType: string
  entityId: number
  /**
   * Query params recovered from Real's web bundle. Their semantics are unverified against live
   * data, so the backfill leaves them unset and fetches the full series (upserts are idempotent).
   */
  before?: string
  level?: number
  playerBoxScoreId?: number
}

export type RealPassEarnings = {
  rows: RealEarningsRow[]
  /** Response `info` block, kept opaque until its fields are confirmed. */
  info: Record<string, unknown> | null
}

export async function getPassEarnings(
  query: RealPassEarningsQuery,
  context: RealApiContext,
): Promise<RealPassEarnings> {
  const path = `/userpassearnings/${encodeURIComponent(query.sport)}/season/${
    query.season
  }/entity/${encodeURIComponent(query.entityType)}/${query.entityId}`

  const data = await realGetJson<{ earnings?: unknown; rows?: unknown; info?: unknown }>(
    path,
    context,
    {
      before: query.before,
      level: query.level,
      playerBoxScoreId: query.playerBoxScoreId,
    },
  )

  return {
    // Accepts `{ earnings: [...] }`, `{ rows: [...] }` and a bare array.
    rows: getRealAppToolsRows(data) as RealEarningsRow[],
    info:
      typeof data.info === 'object' && data.info !== null
        ? (data.info as Record<string, unknown>)
        : null,
  }
}

export async function listPasses(query: RealPassQuery, context: RealApiContext): Promise<RealPass[]> {
  const data = await realGetJson<{ passes?: unknown }>(
    `/userpasses/${encodeURIComponent(query.userId)}/passes`,
    context,
    {
      entityType: query.entityType,
      season: query.season,
      sport: query.sport,
    },
  )
  return Array.isArray(data.passes) ? (data.passes as RealPass[]) : []
}

/** One row from Real's shop `earningstotal` section (base lifetime RAX, ranked). */
export type RealShopEarningsTotalItem = {
  id?: number | string
  value?: string | number
  entityType?: string
  /** Entity id, or nested entity object (shop pages include `entity.avatar`). */
  entity?: number | string | RealPassEntity | null
  type?: string
  sport?: string
  label?: string
  [key: string]: unknown
}

/** Player (or team) payload from `/players|teams/{id}/sport/{sport}` — includes CDN avatar. */
export type RealSportEntity = RealPassEntity & {
  firstName?: string
  lastName?: string
  displayName?: string
  name?: string
  sport?: string
}

export type RealShopEarningsTotalQuery = {
  /** Real path slug (`ncaam`, `soccer`, …) — not app display names. */
  sport: string
  season: number
  entityType: string
  /** 0-based offset; Real returns ~20 items per page (`0`, `20`, `40`, …). */
  before?: number
}

export type RealShopEarningsTotalPage = {
  items: RealShopEarningsTotalItem[]
}

/**
 * Paginated shop leaderboard of base total RAX per entity. Empty `items` means the sport /
 * season / entityType combination is exhausted.
 */
export async function getShopEarningsTotal(
  query: RealShopEarningsTotalQuery,
  context: RealApiContext,
): Promise<RealShopEarningsTotalPage> {
  const path = `/userpassshop/${encodeURIComponent(query.sport)}/season/${
    query.season
  }/entity/${encodeURIComponent(query.entityType)}/section/earningstotal`

  const data = await realGetJson<{ items?: unknown }>(path, context, {
    before: query.before ?? 0,
  })

  return {
    items: Array.isArray(data.items) ? (data.items as RealShopEarningsTotalItem[]) : [],
  }
}

export type RealSportEntityQuery = {
  entityId: number
  /** Real path slug (`ncaam`, `ncaaf`, `nba`, …). */
  sport: string
  entityType?: 'player' | 'team'
}

/**
 * Fetch a single Real player/team entity (includes `avatar` even when `/userpasses` omits it
 * for college players).
 */
export async function getRealSportEntity(
  query: RealSportEntityQuery,
  context: RealApiContext,
): Promise<RealSportEntity | null> {
  const entityType = query.entityType === 'team' ? 'teams' : 'players'
  const path = `/${entityType}/${query.entityId}/sport/${encodeURIComponent(query.sport)}`
  const data = await realGetJson<Record<string, unknown>>(path, context)
  const nested =
    query.entityType === 'team'
      ? data.team ?? data.entity ?? data
      : data.player ?? data.entity ?? data
  if (!nested || typeof nested !== 'object') return null
  return nested as RealSportEntity
}

/** One Real play event from `/players/.../plays/{recent|top}` (rating is string `value`). */
export type RealPlayerPlay = {
  id?: number | string
  value?: string | number
  day?: string
  season?: number | string
  primaryPlayerId?: number | string
  secondaryPlayerId?: number | string
  [key: string]: unknown
}

export type RealPlayerPlaysQuery = {
  /** Real entity id for the player. */
  entityId: number
  /** Real path slug (`mlb`, `nfl`, `soccer`, …). */
  sport: string
  season: number
  /** Page size (Real accepts up to at least 1000). */
  limit?: number
  /** Exclusive upper bound on play `day` (YYYY-MM-DD) for pagination. */
  beforeDay?: string
  viewFrame?: string
}

/** Recent plays for a team entity (`/teams/{id}/sport/{sport}/plays/recent`). */
export async function listTeamRecentPlays(
  query: RealPlayerPlaysQuery,
  context: RealApiContext,
): Promise<RealPlayerPlay[]> {
  const path = `/teams/${query.entityId}/sport/${encodeURIComponent(query.sport)}/plays/recent`
  try {
    const data = await realGetJson<{ plays?: unknown }>(path, context, {
      limit: query.limit ?? 1000,
      season: query.season,
      viewFrame: query.viewFrame ?? 'default',
      beforeDay: query.beforeDay,
    })
    return Array.isArray(data.plays) ? (data.plays as RealPlayerPlay[]) : []
  } catch (error) {
    if (error instanceof RealApiError && (error.kind === 'not_found' || error.kind === 'upstream')) {
      return []
    }
    throw error
  }
}

/**
 * Recent plays for a player. Empty for many MLB pitchers who never bat;
 * prefer {@link listPlayerTopPlays} for season pack averages.
 * Paginate with `beforeDay` set to the oldest `day` from the previous page.
 */
export async function listPlayerRecentPlays(
  query: RealPlayerPlaysQuery,
  context: RealApiContext,
): Promise<RealPlayerPlay[]> {
  const path = `/players/${query.entityId}/sport/${encodeURIComponent(query.sport)}/plays/recent`
  const data = await realGetJson<{ plays?: unknown }>(path, context, {
    limit: query.limit ?? 1000,
    season: query.season,
    viewFrame: query.viewFrame ?? 'default',
    beforeDay: query.beforeDay,
  })
  return Array.isArray(data.plays) ? (data.plays as RealPlayerPlay[]) : []
}

/**
 * Season play sample for pack averages. Use `viewFrame=season` (required — `default` 500s).
 * Returns pitcher-involved plays (player as secondary) that `/plays/recent` often omits.
 */
export async function listPlayerTopPlays(
  query: RealPlayerPlaysQuery,
  context: RealApiContext,
): Promise<RealPlayerPlay[]> {
  const path = `/players/${query.entityId}/sport/${encodeURIComponent(query.sport)}/plays/top`
  const data = await realGetJson<{ plays?: unknown }>(path, context, {
    limit: query.limit ?? 1000,
    season: query.season,
    viewFrame: query.viewFrame ?? 'season',
    beforeDay: query.beforeDay,
  })
  return Array.isArray(data.plays) ? (data.plays as RealPlayerPlay[]) : []
}

export type PlayerPlaysForPackAverage = {
  plays: RealPlayerPlay[]
  /** `top` = `/plays/top?viewFrame=season`; `recent` = fallback for sports/seasons where top is empty. */
  source: 'top' | 'recent'
}

/**
 * Pack-average play sample that works across sports:
 * 1. Prefer `/plays/top?viewFrame=season` (needed for MLB pitchers; good season sample elsewhere).
 * 2. If top is empty or errors, fall back to `/plays/recent` so NBA/NFL/NHL seasons that
 *    lack a top sample still get averages (prior behavior).
 */
export async function listPlayerPlaysForPackAverage(
  query: Omit<RealPlayerPlaysQuery, 'beforeDay' | 'viewFrame'>,
  context: RealApiContext,
): Promise<PlayerPlaysForPackAverage> {
  try {
    const topPlays = await listPlayerTopPlays(
      { ...query, viewFrame: 'season' },
      context,
    )
    if (topPlays.length > 0) {
      return { plays: topPlays, source: 'top' }
    }
  } catch {
    // Top can 500 with viewFrame=default; season usually works, but never block recent fallback.
  }

  const recentPlays = await listPlayerRecentPlays(
    { ...query, viewFrame: 'default' },
    context,
  )
  return { plays: recentPlays, source: 'recent' }
}

/**
 * Walk `beforeDay` pages until exhausted (or maxPages). Dedupes by play id.
 * Default page size is 1000 — most seasons fit in one Real request.
 */
export async function listAllPlayerRecentPlays(
  query: Omit<RealPlayerPlaysQuery, 'beforeDay'>,
  context: RealApiContext,
  options?: { maxPages?: number; pageSize?: number },
): Promise<RealPlayerPlay[]> {
  const pageSize = options?.pageSize ?? 1000
  const maxPages = options?.maxPages ?? 40
  const byId = new Map<string, RealPlayerPlay>()
  let beforeDay: string | undefined

  for (let page = 0; page < maxPages; page += 1) {
    const plays = await listPlayerRecentPlays(
      { ...query, limit: pageSize, beforeDay },
      context,
    )
    if (plays.length === 0) break

    let oldestDay: string | undefined
    let added = 0
    for (const play of plays) {
      const id = play.id != null ? String(play.id) : ''
      if (id && byId.has(id)) continue
      if (id) byId.set(id, play)
      else byId.set(`anon-${byId.size}`, play)
      added += 1
      const day = typeof play.day === 'string' ? play.day : ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (!oldestDay || day < oldestDay)) {
        oldestDay = day
      }
    }

    if (added === 0 || !oldestDay || oldestDay === beforeDay) break
    beforeDay = oldestDay
    if (plays.length < pageSize) break
  }

  return [...byId.values()]
}

export type RealDayGame = {
  id?: number | string
  sport?: string
  day?: string
  status?: string
  homeTeamId?: number | string
  awayTeamId?: number | string
  scorers?: unknown
  [key: string]: unknown
}

/** Today's (or any day's) games for a Real sport slug (`soccer`, `mlb`, …). */
export async function listGamesByDay(
  sport: string,
  day: string,
  context: RealApiContext,
): Promise<RealDayGame[]> {
  const path = `/games/${encodeURIComponent(sport)}/day/${encodeURIComponent(day)}`
  try {
    const data = await realGetJson<{ games?: unknown }>(path, context)
    return Array.isArray(data.games) ? (data.games as RealDayGame[]) : []
  } catch (error) {
    if (error instanceof RealApiError && (error.kind === 'not_found' || error.kind === 'upstream')) {
      return []
    }
    throw error
  }
}

export type RealPlayerBoxScorePayload = {
  playerBoxScore?: {
    id?: number
    playerId?: number
    gameId?: number
    day?: string
    played?: boolean
    minutes?: number
    value?: string | number
    [key: string]: unknown
  } | null
  advancedStats?: {
    raxEarnings?: number
    earningsConfirmed?: boolean
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

/** Live player-link box score. `advancedStats.raxEarnings` is today's RAX before the 7am series drop. */
export async function getPlayerBoxScore(
  boxScoreId: number,
  context: RealApiContext,
): Promise<RealPlayerBoxScorePayload | null> {
  if (!Number.isInteger(boxScoreId) || boxScoreId <= 0) return null
  try {
    return await realGetJson<RealPlayerBoxScorePayload>(`/playerboxscores/${boxScoreId}`, context)
  } catch (error) {
    if (error instanceof RealApiError && (error.kind === 'not_found' || error.kind === 'upstream')) {
      return null
    }
    throw error
  }
}
