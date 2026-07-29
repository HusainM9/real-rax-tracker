import { useEffect, useState, type ReactNode } from 'react'
import { isUfcCatalogSport } from '../lib/passKind'
import {
  buildRealEntityImageUrl,
  resolvePassAvatar,
  resolveRealEntityImageKind,
  type RealEntityImageKind,
} from '../lib/realMedia'

export type PassIdentityProps = {
  name: string
  passKind?: RealEntityImageKind
  /** When set (esp. UFC), picks the correct CDN folder independent of passKind. */
  sport?: string | null
  avatar?: string | null
  /** Extra avatar keys to try (e.g. catalog profile when local card is missing one). */
  avatarFallbacks?: Array<string | null | undefined>
  meta?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

function alternateImageKind(kind: RealEntityImageKind): RealEntityImageKind {
  return kind === 'team' ? 'player' : 'team'
}

export function PassIdentity({
  name,
  passKind = 'player',
  sport,
  avatar,
  avatarFallbacks,
  meta,
  size = 'sm',
  className,
}: PassIdentityProps) {
  const preferredImageKind = resolveRealEntityImageKind(passKind, sport)
  const [imageKind, setImageKind] = useState(preferredImageKind)
  const [failed, setFailed] = useState(false)
  const key = resolvePassAvatar(avatar, ...(avatarFallbacks ?? []))
  const mediaSize = size === 'md' ? 'large' : 'medium'
  const src = key && !failed ? buildRealEntityImageUrl(imageKind, key, mediaSize) : null
  // UFC faces use the teams CDN folder but should not get team-badge chrome.
  const showBadgeChrome = passKind === 'team' && !(sport && isUfcCatalogSport(sport))

  useEffect(() => {
    setImageKind(preferredImageKind)
    setFailed(false)
  }, [key, preferredImageKind])

  return (
    <span className={`pass-identity pass-identity--${size}${className ? ` ${className}` : ''}`}>
      <span
        className={`pass-identity-media${showBadgeChrome ? ' pass-identity-media--badge' : ''}`}
        aria-hidden="true"
      >
        {src ? (
          <img
            className="pass-identity-img"
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              // UFC (and mis-labeled rows) may 403 on the wrong CDN folder — try the other once.
              if (imageKind === preferredImageKind) {
                setImageKind(alternateImageKind(imageKind))
                return
              }
              setFailed(true)
            }}
          />
        ) : (
          <span className="pass-identity-fallback">{initialsFromName(name)}</span>
        )}
      </span>
      <span className="pass-identity-text">
        <strong className="pass-identity-name">{name}</strong>
        {meta ? <small className="pass-identity-meta">{meta}</small> : null}
      </span>
    </span>
  )
}
