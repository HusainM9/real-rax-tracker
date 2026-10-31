/** Accept a supplied CDN URL only; never guess a location from an opaque key. */
export function safeAccountAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && url.hostname === 'media.realapp.com' && !url.port && !url.username && !url.password) return url.href
  } catch { /* Missing/unresolved metadata uses initials. */ }
  return undefined
}
