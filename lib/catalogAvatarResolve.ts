import {
  getRealSportEntity,
  resolveRealApiConfig,
  type RealApiContext,
} from './realApi'
import {
  fetchCatalogPassAvatars,
  findCatalogAvatarForEntitySport,
  meowbotCatalogConfigured,
  upsertCatalogPasses,
  type CatalogPassAvatarRow,
  type CatalogPassInput,
} from './meowbotCatalogStore'
import { avatarFromRealEntity } from './realPassScan'
import { toRealShopSportSlug } from './realShopEarningsCrawl'
import { runWithConcurrency } from './runWithConcurrency'
import {
  expectedSeasonLabelFromYear,
  normalizeSportForSeasonWindow,
} from './seasonClaimWindow'
import {
  parseEntityIdFromExternalKey,
  parseSeasonYearFromExternalKey,
} from './catalogPassIdentity'

export type CatalogAvatarResolveItem = {
  externalKey: string
  avatar: string
}

export type CatalogAvatarResolveResult = {
  avatars: CatalogAvatarResolveItem[]
  storageConfigured: boolean
  filledFromReal: number
  filledFromSiblingSeason: number
}

const REAL_AVATAR_FILL_CONCURRENCY = 3

function parseExternalKeyParts(externalKey: string): {
  entityId: number
  seasonYear: number
  sport: string
} | null {
  const entityId = parseEntityIdFromExternalKey(externalKey)
  const seasonYear = parseSeasonYearFromExternalKey(externalKey)
  const sportPart = externalKey.split('|')[2]?.trim() ?? ''
  const sport = normalizeSportForSeasonWindow(sportPart)
  if (!entityId || !seasonYear || !sport || sport === 'Other') return null
  return { entityId, seasonYear, sport }
}

function passKindFromRow(pass: CatalogPassAvatarRow | undefined): 'player' | 'team' {
  return pass?.passKind === 'team' ? 'team' : 'player'
}

/** UFC shop/entity paths use `teams` even when catalog stores fighters as players. */
function realEntityTypeForResolve(
  pass: CatalogPassAvatarRow | undefined,
  sport: string,
): 'player' | 'team' {
  if (normalizeSportForSeasonWindow(sport) === 'UFC') return 'team'
  return passKindFromRow(pass)
}

async function fetchAvatarFromRealEntity(
  input: {
    entityId: number
    realSport: string
    entityType: 'player' | 'team'
  },
  realContext: RealApiContext,
): Promise<{ avatar: string; name?: string } | undefined> {
  const tryTypes: Array<'player' | 'team'> =
    input.entityType === 'team' ? ['team', 'player'] : ['player', 'team']

  for (const entityType of tryTypes) {
    try {
      const entity = await getRealSportEntity(
        {
          entityId: input.entityId,
          sport: input.realSport,
          entityType,
        },
        realContext,
      )
      const avatar = avatarFromRealEntity(entity)
      if (!avatar) continue
      return {
        avatar,
        name: entity ? entityDisplayName(entity) : undefined,
      }
    } catch {
      /* try alternate entity type */
    }
  }
  return undefined
}

function entityDisplayName(entity: {
  firstName?: string
  lastName?: string
  displayName?: string
  name?: string
}): string {
  const full = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim()
  return full || entity.displayName?.trim() || entity.name?.trim() || ''
}

/**
 * Resolve CDN avatar keys for catalog/local pass externalKeys.
 *
 * Order: exact catalog row → same entity+sport other season → Real `/players|teams/{id}/sport/{slug}`
 * (needed for college players — `/userpasses` omits their avatars). Persists Real fills when
 * catalog storage is configured.
 */
export async function resolveCatalogAvatars(
  externalKeys: string[],
  options?: {
    signal?: AbortSignal
    realContext?: RealApiContext | null
    /** Cap Real upstream fills in one request (edge time budget). */
    maxRealFills?: number
  },
): Promise<CatalogAvatarResolveResult> {
  const keys = [...new Set(externalKeys.map((key) => key.trim()).filter(Boolean))]
  if (keys.length === 0) {
    return {
      avatars: [],
      storageConfigured: meowbotCatalogConfigured(),
      filledFromReal: 0,
      filledFromSiblingSeason: 0,
    }
  }

  const { passes, storageConfigured } = await fetchCatalogPassAvatars(keys)
  const passByKey = new Map(passes.map((pass) => [pass.externalKey, pass]))
  const resolved = new Map<string, string>()
  let filledFromSiblingSeason = 0
  let filledFromReal = 0

  for (const key of keys) {
    const avatar = passByKey.get(key)?.avatar?.trim()
    if (avatar) resolved.set(key, avatar)
  }

  const missingAfterExact = keys.filter((key) => !resolved.has(key))
  const siblingUpserts: CatalogPassInput[] = []
  for (const key of missingAfterExact) {
    if (options?.signal?.aborted) break
    const parts = parseExternalKeyParts(key)
    const pass = passByKey.get(key)
    const entityId = pass?.entityId ?? parts?.entityId
    const sport = pass?.sport ?? parts?.sport
    if (!entityId || !sport) continue
    const sibling = await findCatalogAvatarForEntitySport({
      entityId,
      sport,
      excludeExternalKey: key,
    })
    if (!sibling) continue
    resolved.set(key, sibling)
    filledFromSiblingSeason += 1
    if (pass && storageConfigured) {
      siblingUpserts.push({ ...passToInput(pass), avatar: sibling })
    }
  }
  if (siblingUpserts.length > 0) {
    await upsertCatalogPasses(siblingUpserts)
  }

  const stillMissing = keys.filter((key) => !resolved.has(key))
  const realConfig = options?.realContext?.config ?? resolveRealApiConfig()
  const realContext =
    options?.realContext ?? (realConfig ? { config: realConfig, signal: options?.signal } : null)
  const maxRealFills = Math.max(0, options?.maxRealFills ?? 40)
  const toFill = stillMissing.slice(0, maxRealFills)

  if (realContext && toFill.length > 0) {
    const upserts: CatalogPassInput[] = []
    await runWithConcurrency(toFill, REAL_AVATAR_FILL_CONCURRENCY, async (key) => {
      if (options?.signal?.aborted) return
      const pass = passByKey.get(key)
      const parts = parseExternalKeyParts(key)
      const entityId = pass?.entityId ?? parts?.entityId
      const sport = pass?.sport ?? parts?.sport
      const seasonYear = pass?.seasonYear ?? parts?.seasonYear
      if (!entityId || !sport || !seasonYear) return

      const realSport = toRealShopSportSlug(sport)
      if (!realSport) return

      try {
        const filled = await fetchAvatarFromRealEntity(
          {
            entityId,
            realSport,
            entityType: realEntityTypeForResolve(pass, sport),
          },
          realContext,
        )
        if (!filled) return

        resolved.set(key, filled.avatar)
        filledFromReal += 1

        if (storageConfigured) {
          if (pass) {
            upserts.push({ ...passToInput(pass), avatar: filled.avatar })
          } else {
            upserts.push({
              externalKey: key,
              entityId,
              passKind: passKindFromRow(pass),
              sport: normalizeSportForSeasonWindow(sport),
              seasonYear,
              seasonLabel: expectedSeasonLabelFromYear(seasonYear, sport),
              name: filled.name || `Entity ${entityId}`,
              avatar: filled.avatar,
              hasEarnings: false,
              totalBaseRax: 0,
            })
          }
        }
      } catch {
        /* Real optional — leave unresolved */
      }
    })

    if (upserts.length > 0) {
      await upsertCatalogPasses(upserts)
    }
  }

  return {
    avatars: keys
      .map((externalKey) => {
        const avatar = resolved.get(externalKey)
        return avatar ? { externalKey, avatar } : null
      })
      .filter((item): item is CatalogAvatarResolveItem => item != null),
    storageConfigured,
    filledFromReal,
    filledFromSiblingSeason,
  }
}

function passToInput(pass: CatalogPassAvatarRow): CatalogPassInput {
  return {
    externalKey: pass.externalKey,
    entityId: pass.entityId,
    passKind: pass.passKind,
    sport: pass.sport,
    seasonYear: pass.seasonYear,
    seasonLabel: pass.seasonLabel,
    name: pass.name,
    avatar: pass.avatar,
  }
}
