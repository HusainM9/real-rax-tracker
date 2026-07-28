import { realProviderImportEnabled } from './importShutdown'
import { resolveUserPasses, type MeowbotPlayerPass } from './meowbotApi'
import { fetchRealUserPasses } from './realPassImport'

export type ImportPassProvider = 'real' | 'meowbot'

export type ResolvedImportPasses = {
  playerPasses: MeowbotPlayerPass[]
  teamPasses: MeowbotPlayerPass[]
  rarities: Record<string, string[]>
  provider: ImportPassProvider
  /** Real returns authoritative entityType/label/seasonDisplay, so no name or passKind guessing. */
  metadataAuthoritative: boolean
  /** Meowbot served per-day rows alongside the pass list; Real's `earned` is a lifetime aggregate. */
  dailyEarningsAvailable: boolean
  /** Real exposes per-pass earnings through the batched, cache-first backfill route instead. */
  earningsBackfillAvailable: boolean
}

export function activeImportPassProvider(): ImportPassProvider {
  return realProviderImportEnabled() ? 'real' : 'meowbot'
}

export async function resolveImportUserPasses(
  username: string,
  signal?: AbortSignal,
): Promise<ResolvedImportPasses> {
  if (activeImportPassProvider() === 'real') {
    const resolved = await fetchRealUserPasses(username, signal)
    return {
      ...resolved,
      provider: 'real',
      metadataAuthoritative: true,
      dailyEarningsAvailable: false,
      earningsBackfillAvailable: true,
    }
  }

  const resolved = await resolveUserPasses(username, signal)
  return {
    playerPasses: resolved.playerPasses,
    teamPasses: resolved.teamPasses,
    rarities: resolved.rarities,
    provider: 'meowbot',
    metadataAuthoritative: false,
    dailyEarningsAvailable: true,
    earningsBackfillAvailable: false,
  }
}
