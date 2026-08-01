import { compactTrackerProfileForCloudSync } from './cloudSyncPayload'
import { gzipJsonToBytes } from './cloudSyncCompression'

/** Build a gzip-compressed JSON PUT body for account / cloud profile sync. */
export async function buildGzipSyncPutBody(input: {
  data: unknown
  ifUnmodifiedSince?: string
  username?: string
  passphrase?: string
}): Promise<{ body: Uint8Array; headers: Record<string, string> }> {
  const payload: Record<string, unknown> = {
    data: compactTrackerProfileForCloudSync(input.data),
  }
  if (input.ifUnmodifiedSince) {
    payload.ifUnmodifiedSince = input.ifUnmodifiedSince
  }
  if (input.username !== undefined) {
    payload.username = input.username
  }
  if (input.passphrase !== undefined) {
    payload.passphrase = input.passphrase
  }

  return {
    body: await gzipJsonToBytes(payload),
    headers: {
      'Content-Type': 'application/json',
      // Custom header — browsers/proxies may strip or mishandle Content-Encoding on requests.
      'X-Rax-Content-Encoding': 'gzip',
    },
  }
}
