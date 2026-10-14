export type MarketplaceAuctionCountdown = {
  label: string
  ended: boolean
}

export function marketplaceAuctionCountdown(
  endsAt: string | null,
  now = Date.now(),
): MarketplaceAuctionCountdown | null {
  if (!endsAt) return null
  const endTime = Date.parse(endsAt)
  if (!Number.isFinite(endTime)) return null

  const remainingMs = endTime - now
  if (remainingMs <= 0) return { label: 'Auction ended', ended: true }

  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return { label: `${days}d ${hours}h remaining`, ended: false }
  if (hours > 0) return { label: `${hours}h ${minutes}m remaining`, ended: false }
  return { label: `${minutes}m ${seconds}s remaining`, ended: false }
}
