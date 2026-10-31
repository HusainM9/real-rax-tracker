import { useState } from 'react'
import { safeAccountAvatarUrl, type AccountProfile } from '../lib/dailyPacks'

export function AccountAvatar({ username, profile }: { username: string; profile?: AccountProfile }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const url = profile?.username === username.trim().replace(/^@/, '').toLowerCase() ? safeAccountAvatarUrl(profile.avatarUrl) : undefined
  return <span className="pack-sync-account-avatar" aria-hidden="true">
    {url && url !== failedUrl
      ? <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      : username.replace(/^@/, '').slice(0, 1).toUpperCase()}
  </span>
}
