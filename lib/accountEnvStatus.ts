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
    return 'This deployment is missing AUTH_SESSION_SECRET. Enable it for Preview in Vercel, then redeploy.'
  }
  if (!status.trackerSyncSecretConfigured) {
    return 'TRACKER_SYNC_SECRET is not set on this deployment. If account passwords were created in Production with that secret, enable TRACKER_SYNC_SECRET for Preview in Vercel (same value as Production), then redeploy.'
  }
  return 'If this password works on Production, confirm AUTH_SESSION_SECRET and TRACKER_SYNC_SECRET on Preview match Production exactly, then redeploy.'
}
