import { upsertImportOwnershipSnapshot } from './importOwnershipStore'
import {
  normalizeRealUsername,
  type ImportOwnershipPass,
  type ImportOwnershipSnapshot,
} from './importOwnershipTypes'
import { fetchMeowbotUsernamePasses } from './meowbotServerImport'

const ADMIN_CLIENT_ID = 'admin-username-ownership'

type MeowbotImportPass = Awaited<ReturnType<typeof fetchMeowbotUsernamePasses>>[number]

export function meowbotPassToOwnershipPass(pass: MeowbotImportPass): ImportOwnershipPass {
  return {
    name: pass.name,
    sport: pass.sport,
    season: pass.seasonLabel,
    seasonYear: pass.seasonYear,
    entityId: pass.entityId,
    rarityLabel: pass.rarityLabel,
    externalKey: pass.externalKey,
    passKind: pass.passKind,
  }
}

export function buildUsernameOwnershipSnapshot(username: string, passes: MeowbotImportPass[]): ImportOwnershipSnapshot {
  const realUsername = normalizeRealUsername(username)
  return {
    realUsername,
    clientId: ADMIN_CLIENT_ID,
    importedAt: new Date().toISOString(),
    passes: passes.map(meowbotPassToOwnershipPass),
  }
}

export async function importUsernameOwnershipSnapshot(username: string): Promise<{
  passesSaved: number
  snapshot: ImportOwnershipSnapshot
}> {
  const passes = await fetchMeowbotUsernamePasses(username)
  const snapshot = buildUsernameOwnershipSnapshot(username, passes)
  if (snapshot.passes.length === 0) {
    throw new Error(`No passes found for @${snapshot.realUsername}.`)
  }
  return { passesSaved: snapshot.passes.length, snapshot }
}

export async function persistUsernameOwnershipSnapshot(username: string): Promise<{
  passesSaved: number
  realUsername: string
}> {
  const { passesSaved, snapshot } = await importUsernameOwnershipSnapshot(username)
  const stored = await upsertImportOwnershipSnapshot(snapshot)
  if (!stored) {
    throw new Error('Ownership cache is not configured (link KV in Vercel).')
  }
  return { passesSaved, realUsername: snapshot.realUsername }
}
