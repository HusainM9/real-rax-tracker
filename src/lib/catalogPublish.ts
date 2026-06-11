import type { CachedPlayerEarningsProfile } from '../types/rax'

const PUBLISHED_CACHE_SIGNATURE_KEY = 'rax-shared-catalog-published-signature'

let publishInFlight: Promise<{ published: boolean; storageConfigured: boolean }> | null = null

function profileSignature(profiles: CachedPlayerEarningsProfile[]): string {
  return profiles
    .map((profile) => `${profile.cacheKey}:${profile.updatedAt}:${profile.rows.length}`)
    .sort()
    .join('|')
}

export async function publishCachedProfilesToCatalog(
  profiles: CachedPlayerEarningsProfile[],
  options: { rememberSignature?: boolean } = {},
): Promise<{ published: boolean; storageConfigured: boolean }> {
  if (publishInFlight) {
    return publishInFlight
  }

  publishInFlight = publishCachedProfilesToCatalogInner(profiles, options).finally(() => {
    publishInFlight = null
  })
  return publishInFlight
}

async function publishCachedProfilesToCatalogInner(
  profiles: CachedPlayerEarningsProfile[],
  options: { rememberSignature?: boolean } = {},
): Promise<{ published: boolean; storageConfigured: boolean }> {
  const validProfiles = profiles.filter((profile) => profile.rows.length > 0)
  if (validProfiles.length === 0) return { published: false, storageConfigured: true }

  const signature = profileSignature(validProfiles)
  if (options.rememberSignature) {
    try {
      if (localStorage.getItem(PUBLISHED_CACHE_SIGNATURE_KEY) === signature) {
        return { published: false, storageConfigured: true }
      }
    } catch {
      // localStorage may be unavailable; publishing remains safe because upserts are idempotent.
    }
  }

  const response = await fetch('/api/catalog/cache', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles: validProfiles }),
  })
  const data = (await response.json()) as { storageConfigured?: boolean; error?: string }

  if (!response.ok) {
    throw new Error(data.error || `Shared catalog publish failed (${response.status}).`)
  }

  if (options.rememberSignature) {
    try {
      localStorage.setItem(PUBLISHED_CACHE_SIGNATURE_KEY, signature)
    } catch {
      // Best effort only.
    }
  }

  return { published: true, storageConfigured: data.storageConfigured !== false }
}

export async function reportCachedProfilesToCatalog(
  profiles: CachedPlayerEarningsProfile[],
  options: { rememberSignature?: boolean } = {},
): Promise<void> {
  try {
    await publishCachedProfilesToCatalog(profiles, options)
  } catch {
    // Fire-and-forget. A failed shared-cache upload should never break local imports.
  }
}

