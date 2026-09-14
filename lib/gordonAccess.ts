import { normalizeRealUsername } from './importOwnershipTypes'

/** Personal tools for this Real account only — not an admin role. */
export const GORDON_ACCOUNT_USERNAME = 'gordon'

/** Localhost “continue with local browser data” username. */
export const LOCAL_DEV_ACCOUNT_USERNAME = 'dev'

export function isGordonAccountUsername(username: string | null | undefined): boolean {
  return normalizeRealUsername(username ?? '') === GORDON_ACCOUNT_USERNAME
}

/**
 * Daily tools: @gordon in any environment, or localhost local-browser data.
 * Do not treat a registered `dev` account in production as Gordon.
 */
export function canUseGordonTools(
  username: string | null | undefined,
  localDevBypass = false,
): boolean {
  return Boolean(localDevBypass) || isGordonAccountUsername(username)
}

export function isGordonToolsDevelopment(): boolean {
  return process.env.NODE_ENV === 'development'
}
