import { upsertImportOwnershipSnapshot } from './importOwnershipStore'
import {
  normalizeRealUsername,
  trimOwnershipSnapshotEarnings,
  type ImportOwnershipEarningRow,
  type ImportOwnershipPass,
  type ImportOwnershipSnapshot,
} from './importOwnershipTypes'
import { importMeowbotUsernameToCatalog } from './meowbotServerImport'

const ADMIN_CLIENT_ID = 'admin-username-ownership'

export function meowbotPassToOwnershipPass(pass: {
  name: string
  sport: string
  seasonLabel: string
  seasonYear: number
  entityId: number
  rarityLabel?: string
  externalKey: string
  passKind: 'player' | 'team'
  earnings?: ImportOwnershipEarningRow[]
}): ImportOwnershipPass {
  return {
    name: pass.name,
    sport: pass.sport,
    season: pass.seasonLabel,
    seasonYear: pass.seasonYear,
    entityId: pass.entityId,
    rarityLabel: pass.rarityLabel,
    externalKey: pass.externalKey,
    passKind: pass.passKind,
    earnings: pass.earnings,
  }
}

export function buildUsernameOwnershipSnapshot(
  username: string,
  passes: ImportOwnershipPass[],
): ImportOwnershipSnapshot {
  const realUsername = normalizeRealUsername(username)
  return trimOwnershipSnapshotEarnings({
    realUsername,
    clientId: ADMIN_CLIENT_ID,
    importedAt: new Date().toISOString(),
    passes,
  })
}

export async function importUsernameOwnershipSnapshot(username: string): Promise<{
  passesSaved: number
  rowsSaved: number
  passesWithNoEarnings: number
  failures: string[]
  snapshot: ImportOwnershipSnapshot
}> {
  const summary = await importMeowbotUsernameToCatalog(username)
  const earningsByKey = new Map<string, ImportOwnershipEarningRow[]>()

  for (const row of summary.dailyEarnings) {
    const list = earningsByKey.get(row.externalKey) ?? []
    list.push({
      claimDay: row.claimDay,
      baseRaxEarned: row.baseRaxEarned,
      playerBoxScoreId: row.playerBoxScoreId,
    })
    earningsByKey.set(row.externalKey, list)
  }

  const passes: ImportOwnershipPass[] = summary.passes.map((pass) =>
    meowbotPassToOwnershipPass({
      name: pass.name,
      sport: pass.sport,
      seasonLabel: pass.seasonLabel,
      seasonYear: pass.seasonYear,
      entityId: pass.entityId,
      rarityLabel: pass.rarityLabel,
      externalKey: pass.externalKey,
      passKind: pass.passKind,
      earnings: earningsByKey.get(pass.externalKey),
    }),
  )

  const snapshot = buildUsernameOwnershipSnapshot(username, passes)
  if (snapshot.passes.length === 0) {
    throw new Error(`No passes found for @${snapshot.realUsername}.`)
  }

  const rowsSaved = snapshot.passes.reduce((sum, pass) => sum + (pass.earnings?.length ?? 0), 0)

  return {
    passesSaved: snapshot.passes.length,
    rowsSaved,
    passesWithNoEarnings: summary.passesWithNoEarnings,
    failures: summary.failures,
    snapshot,
  }
}

export async function persistUsernameOwnershipSnapshot(username: string): Promise<{
  passesSaved: number
  rowsSaved: number
  passesWithNoEarnings: number
  failures: string[]
  realUsername: string
}> {
  const { passesSaved, rowsSaved, passesWithNoEarnings, failures, snapshot } =
    await importUsernameOwnershipSnapshot(username)
  const stored = await upsertImportOwnershipSnapshot(snapshot)
  if (!stored) {
    throw new Error('Ownership cache is not configured (link KV in Vercel).')
  }
  return {
    passesSaved,
    rowsSaved,
    passesWithNoEarnings,
    failures,
    realUsername: snapshot.realUsername,
  }
}
