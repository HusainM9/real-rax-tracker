import {
  normalizeRealUsername,
  trimOwnershipSnapshotEarnings,
  type ImportOwnershipEarningRow,
  type ImportOwnershipPass,
  type ImportOwnershipSnapshot,
} from './importOwnershipTypes'

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
  rarities?: Record<string, string[]>,
): ImportOwnershipSnapshot {
  const realUsername = normalizeRealUsername(username)
  return trimOwnershipSnapshotEarnings({
    realUsername,
    clientId: ADMIN_CLIENT_ID,
    importedAt: new Date().toISOString(),
    passes,
    ...(rarities ? { rarities } : {}),
  })
}
