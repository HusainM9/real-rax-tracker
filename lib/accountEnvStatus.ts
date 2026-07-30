import { accountsConfigured } from './trackerProfileStore'
import { authConfigured, getSigningSecret } from './authCookie'
import { stripEnvQuotes } from './syncPassphrase'

export type AccountEnvStatus = {
  vercelEnv: string
  storageConfigured: boolean
  authConfigured: boolean
  sessionSecretConfigured: boolean
  trackerSyncSecretConfigured: boolean
}

/** Safe booleans for debugging Preview vs Production env scope — no secret values. */
export function getAccountEnvStatus(): AccountEnvStatus {
  return {
    vercelEnv: process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV || 'unknown',
    storageConfigured: accountsConfigured(),
    authConfigured: authConfigured(),
    sessionSecretConfigured: Boolean(getSigningSecret()),
    trackerSyncSecretConfigured: Boolean(stripEnvQuotes(process.env.TRACKER_SYNC_SECRET)),
  }
}

export function accountLoginEnvHint(status: AccountEnvStatus = getAccountEnvStatus()): string | null {
  if (status.vercelEnv !== 'preview' && status.vercelEnv !== 'development') return null
  if (!status.storageConfigured) {
    return 'This deployment is missing KV storage. In Vercel → Settings → Environment Variables, enable KV_REST_API_URL and KV_REST_API_TOKEN for Preview (not Production only), then redeploy.'
  }
  if (!status.sessionSecretConfigured) {
    return 'This deployment is missing AUTH_SESSION_SECRET / site password secret. Enable AUTH_SESSION_SECRET (or BASIC_AUTH_PASSWORD) for Preview in Vercel, then redeploy.'
  }
  // TRACKER_SYNC_SECRET is optional — only mention it when it is actually configured here
  // but login still fails (usually means Preview/local value differs from Production).
  if (status.trackerSyncSecretConfigured) {
    return 'If this password works on Production, confirm AUTH_SESSION_SECRET and TRACKER_SYNC_SECRET on this environment match Production exactly, then redeploy.'
  }
  return 'If this password works on Production, confirm AUTH_SESSION_SECRET on this environment matches Production exactly (Preview must not be Production-only), then redeploy.'
}
