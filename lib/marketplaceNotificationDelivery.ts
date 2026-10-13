import {
  marketplaceListingUrl,
  type MarketplaceAlertNotification,
} from './marketplaceAlerts.js'

export type MarketplaceDeliveryResult = {
  configured: boolean
  channel: 'discord_dm' | 'discord' | 'telegram' | null
  delivered: number
}

function describeNotification(notification: MarketplaceAlertNotification): string {
  const details = [
    'Bulk rating auction',
    `${notification.price.toLocaleString('en-US')} RAX`,
    notification.rating != null ? `${notification.rating} rating` : null,
    notification.pricePerRating != null
      ? `${notification.pricePerRating.toLocaleString('en-US', { maximumFractionDigits: 2 })} RAX/rating`
      : null,
    `${notification.numBids} bid${notification.numBids === 1 ? '' : 's'}`,
    notification.rarity || null,
    notification.iconicPriceOverride ? 'Iconic price override' : null,
    notification.mysticPriceOverride ? 'Mystic price override' : null,
    notification.serialNumber ? `#${notification.serialNumber}` : null,
  ].filter(Boolean)
  const auctionUrl = marketplaceListingUrl(notification.listingId)
  const summary = `• ${notification.playerName} — ${details.join(' · ')} (${notification.ruleName})`
  const maximum = notification.maxAuctionPrice != null && notification.maxPricePerRating != null
    ? `\n  Max auction: ${notification.maxAuctionPrice.toLocaleString('en-US')} RAX ` +
      `(${notification.maxPricePerRating.toLocaleString('en-US')} + 1 allowance per rating)`
    : ''
  return auctionUrl ? `${summary}${maximum}\n  ${auctionUrl}` : `${summary}${maximum}`
}

export function formatMarketplaceNotificationMessage(
  owner: string,
  notifications: MarketplaceAlertNotification[],
): string {
  const visible = notifications.slice(0, 10)
  const remaining = notifications.length - visible.length
  const lines = [
    `Marketplace match${notifications.length === 1 ? '' : 'es'} for ${owner}`,
    ...visible.map(describeNotification),
  ]
  if (remaining > 0) lines.push(`…and ${remaining} more. Open the Marketplace page for the full feed.`)
  return lines.join('\n')
}

function discordRecipient(options: {
  discordUserId?: string | null
  allowLegacyDiscordUserId?: boolean
}): string | null {
  if (options.discordUserId) return options.discordUserId.trim()
  if (options.allowLegacyDiscordUserId === false) return null
  return process.env.MARKETPLACE_DISCORD_USER_ID?.trim() || null
}

function deliveryChannel(options: {
  discordUserId?: string | null
  allowLegacyDiscordUserId?: boolean
}): MarketplaceDeliveryResult['channel'] {
  if (
    process.env.MARKETPLACE_DISCORD_BOT_TOKEN?.trim() &&
    discordRecipient(options)
  ) return 'discord_dm'
  if (process.env.MARKETPLACE_DISCORD_WEBHOOK_URL?.trim()) return 'discord'
  if (
    process.env.MARKETPLACE_TELEGRAM_BOT_TOKEN?.trim() &&
    process.env.MARKETPLACE_TELEGRAM_CHAT_ID?.trim()
  ) return 'telegram'
  return null
}

async function postDiscordBotJson<T>(
  path: string,
  token: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Discord DM delivery failed (${response.status}).`)
  }
  return await response.json() as T
}

async function sendDiscordDirectMessage(
  message: string,
  recipientId: string,
  signal?: AbortSignal,
): Promise<void> {
  const token = process.env.MARKETPLACE_DISCORD_BOT_TOKEN!.trim()
  if (!/^\d{15,22}$/.test(recipientId)) {
    throw new Error('Discord DM delivery is configured with an invalid user ID.')
  }

  const channel = await postDiscordBotJson<{ id?: unknown }>(
    '/users/@me/channels',
    token,
    { recipient_id: recipientId },
    signal,
  )
  if (typeof channel.id !== 'string' || !channel.id) {
    throw new Error('Discord did not return a DM channel ID.')
  }

  await postDiscordBotJson(
    `/channels/${encodeURIComponent(channel.id)}/messages`,
    token,
    {
      content: message.slice(0, 2_000),
      allowed_mentions: { parse: [] },
    },
    signal,
  )
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Notification delivery failed (${response.status}).`)
  }
}

export async function deliverMarketplaceNotifications(options: {
  owner: string
  notifications: MarketplaceAlertNotification[]
  discordUserId?: string | null
  allowLegacyDiscordUserId?: boolean
  signal?: AbortSignal
}): Promise<MarketplaceDeliveryResult> {
  const channel = deliveryChannel(options)
  if (options.notifications.length === 0) {
    return { configured: channel !== null, channel, delivered: 0 }
  }

  if (!channel) return { configured: false, channel: null, delivered: 0 }
  const message = formatMarketplaceNotificationMessage(options.owner, options.notifications)

  if (channel === 'discord_dm') {
    const recipientId = discordRecipient(options)
    if (!recipientId) return { configured: false, channel: null, delivered: 0 }
    await sendDiscordDirectMessage(message, recipientId, options.signal)
  } else if (channel === 'discord') {
    await postJson(process.env.MARKETPLACE_DISCORD_WEBHOOK_URL!.trim(), {
      content: message.slice(0, 2_000),
      allowed_mentions: { parse: [] },
    }, options.signal)
  } else {
    const token = process.env.MARKETPLACE_TELEGRAM_BOT_TOKEN!.trim()
    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: process.env.MARKETPLACE_TELEGRAM_CHAT_ID!.trim(),
      text: message.slice(0, 4_096),
      disable_web_page_preview: true,
    }, options.signal)
  }

  return {
    configured: true,
    channel,
    delivered: options.notifications.length,
  }
}
