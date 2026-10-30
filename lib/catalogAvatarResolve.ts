import type { RealApiContext } from './realApi.js'
import { fetchCatalogPassAvatars, findCatalogAvatarForEntitySport, meowbotCatalogConfigured, updateCatalogPassAvatars } from './meowbotCatalogStore.js'
import { runWithConcurrency } from './runWithConcurrency.js'
import { normalizeSportForSeasonWindow } from './seasonClaimWindow.js'
import { parseEntityIdFromExternalKey } from './catalogPassIdentity.js'

export type CatalogAvatarResolveItem = { externalKey: string; avatar: string }
export type CatalogAvatarResolveResult = {
  avatars: CatalogAvatarResolveItem[]
  storageConfigured: boolean
  filledFromReal: number
  filledFromSiblingSeason: number
}

/** Saved exact/sibling-season images only. A miss deliberately remains a placeholder. */
export async function resolveCatalogAvatars(
  externalKeys: string[],
  options?: {
    signal?: AbortSignal
    /** Legacy compatibility only: cannot enable provider requests. */
    realContext?: RealApiContext | null
    maxRealFills?: number
  },
): Promise<CatalogAvatarResolveResult> {
  const keys = [...new Set(externalKeys.map((key) => key.trim()).filter(Boolean))]
  if (!keys.length) return { avatars: [], storageConfigured: meowbotCatalogConfigured(), filledFromReal: 0, filledFromSiblingSeason: 0 }
  const { passes, storageConfigured } = await fetchCatalogPassAvatars(keys)
  const passByKey = new Map(passes.map((pass) => [pass.externalKey, pass]))
  const resolved = new Map<string, string>()
  const siblingUpdates: CatalogAvatarResolveItem[] = []
  let filledFromSiblingSeason = 0
  for (const pass of passes) if (pass.avatar?.trim()) resolved.set(pass.externalKey, pass.avatar.trim())
  await runWithConcurrency(keys.filter((key) => !resolved.has(key)), 4, async (key) => {
    if (options?.signal?.aborted) return
    const pass = passByKey.get(key)
    const entityId = pass?.entityId ?? parseEntityIdFromExternalKey(key)
    const sport = pass?.sport ?? normalizeSportForSeasonWindow(key.split('|')[2] ?? '')
    if (!entityId || !sport || sport === 'Other') return
    const avatar = await findCatalogAvatarForEntitySport({ entityId, sport, excludeExternalKey: key })
    if (!avatar) return
    resolved.set(key, avatar)
    filledFromSiblingSeason += 1
    if (pass && storageConfigured) siblingUpdates.push({ externalKey: key, avatar })
  })
  if (siblingUpdates.length) await updateCatalogPassAvatars(siblingUpdates)
  return {
    avatars: keys.flatMap((externalKey) => {
      const avatar = resolved.get(externalKey)
      return avatar ? [{ externalKey, avatar }] : []
    }),
    storageConfigured,
    filledFromReal: 0,
    filledFromSiblingSeason,
  }
}
