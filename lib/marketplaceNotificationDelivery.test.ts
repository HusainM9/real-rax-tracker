import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceAlertNotification } from './marketplaceAlerts'
import {
  deliverMarketplaceNotifications,
  formatMarketplaceNotificationMessage,
} from './marketplaceNotificationDelivery'

const notification: MarketplaceAlertNotification = {
  id: 'rule-1:listing-1',
  ruleId: 'rule-1',
  ruleName: 'Cheap QB',
  listingId: 'listing-1',
  playerName: 'Trevor Lawrence',
  sport: 'nfl',
  season: 2026,
  price: 2_000,
  numBids: 0,
  rarity: 'Legendary',
  serialNumber: 42,
  endsAt: '2026-10-12T10:00:00.000Z',
  foundAt: '2026-10-12T09:50:00.000Z',
}

const originalDiscord = process.env.MARKETPLACE_DISCORD_WEBHOOK_URL
const originalDiscordBotToken = process.env.MARKETPLACE_DISCORD_BOT_TOKEN
const originalDiscordUserId = process.env.MARKETPLACE_DISCORD_USER_ID
const originalTelegramToken = process.env.MARKETPLACE_TELEGRAM_BOT_TOKEN
const originalTelegramChat = process.env.MARKETPLACE_TELEGRAM_CHAT_ID

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalDiscord === undefined) delete process.env.MARKETPLACE_DISCORD_WEBHOOK_URL
  else process.env.MARKETPLACE_DISCORD_WEBHOOK_URL = originalDiscord
  if (originalDiscordBotToken === undefined) delete process.env.MARKETPLACE_DISCORD_BOT_TOKEN
  else process.env.MARKETPLACE_DISCORD_BOT_TOKEN = originalDiscordBotToken
  if (originalDiscordUserId === undefined) delete process.env.MARKETPLACE_DISCORD_USER_ID
  else process.env.MARKETPLACE_DISCORD_USER_ID = originalDiscordUserId
  if (originalTelegramToken === undefined) delete process.env.MARKETPLACE_TELEGRAM_BOT_TOKEN
  else process.env.MARKETPLACE_TELEGRAM_BOT_TOKEN = originalTelegramToken
  if (originalTelegramChat === undefined) delete process.env.MARKETPLACE_TELEGRAM_CHAT_ID
  else process.env.MARKETPLACE_TELEGRAM_CHAT_ID = originalTelegramChat
})

describe('marketplace notification delivery', () => {
  it('formats an owner-scoped alert without mentioning users', () => {
    expect(formatMarketplaceNotificationMessage(
      'husain',
      [notification],
      Date.parse('2026-10-12T09:50:00.000Z'),
    )).toBe(
      'Marketplace match for husain\n' +
      '• Trevor Lawrence — Bulk rating auction · 2,000 RAX · 0 bids · Legendary · #42 · 10m 0s remaining (Cheap QB)',
    )
  })

  it('includes bulk rating and price per rating when available', () => {
    expect(formatMarketplaceNotificationMessage('husain', [{
      ...notification,
      playerName: 'Kenneth Walker',
      price: 280,
      rating: 8,
      pricePerRating: 35,
      serialNumber: null,
      ruleName: 'NFL owned players',
    }])).toContain(
      '• Kenneth Walker — Bulk rating auction · 280 RAX · 8 rating · 35 RAX/rating · 0 bids · Legendary · Auction ended (NFL owned players)',
    )
  })

  it('shows the tolerated maximum auction price for a decimal bulk rating', () => {
    const message = formatMarketplaceNotificationMessage('husain', [{
      ...notification,
      playerName: 'Bijan Robinson',
      price: 3000,
      rating: 89.7,
      pricePerRating: 3000 / 89.7,
      maxPricePerRating: 35,
      maxAuctionPrice: 3200,
      serialNumber: null,
      ruleName: 'NFL owned players',
    }])
    expect(message).toContain(
      'Bijan Robinson — Bulk rating auction · 3,000 RAX · 89.7 rating · 33.44 RAX/rating',
    )
    expect(message).toContain('Max auction: 3,200 RAX (35 + 1 allowance per rating)')
  })

  it('shows the configured target used for a target-price match', () => {
    const message = formatMarketplaceNotificationMessage('husain', [{
      ...notification,
      price: 3000,
      rating: 100,
      pricePerRating: 30,
      targetPrice: 4000,
      targetPricePerRating: 40,
      startPrice: 3000,
      maxPricePerRating: 35,
    }])
    expect(message).toContain('3,000 RAX · 100 rating · 30 RAX/rating')
    expect(message).toContain(
      '4,000 RAX target (1,000 above start; 5 RAX/rating above 35 limit) · 40 target RAX/rating',
    )
  })

  it('labels a target below both the start and configured price limit', () => {
    const message = formatMarketplaceNotificationMessage('husain', [{
      ...notification,
      price: 3000,
      startPrice: 3000,
      rating: 100,
      targetPrice: 2500,
      targetPricePerRating: 25,
      maxPricePerRating: 30,
    }])
    expect(message).toContain(
      '2,500 RAX target (500 below start; 5 RAX/rating below 30 limit)',
    )
  })

  it('labels Iconic player overrides without showing an inapplicable price ceiling', () => {
    const message = formatMarketplaceNotificationMessage('husain', [{
      ...notification,
      rarity: 'Iconic',
      iconicPriceOverride: true,
      maxPricePerRating: 35,
      maxAuctionPrice: null,
    }])
    expect(message).toContain('Iconic · Iconic price override')
    expect(message).not.toContain('Max auction:')
  })

  it('labels Mystic player overrides without showing an inapplicable price ceiling', () => {
    const message = formatMarketplaceNotificationMessage('husain', [{
      ...notification,
      rarity: 'Mystic',
      mysticPriceOverride: true,
      maxPricePerRating: 35,
      maxAuctionPrice: null,
    }])
    expect(message).toContain('Mystic · Mystic price override')
    expect(message).not.toContain('Max auction:')
  })

  it('includes a one-click Real auction link for a live numeric listing', () => {
    expect(formatMarketplaceNotificationMessage('husain', [{
      ...notification,
      listingId: '787338515',
    }])).toContain('https://www.realapp.com/5ltjF5FGOb2eg')
  })

  it('caps the visible list at ten and reports remaining matches', () => {
    const notifications = Array.from({ length: 12 }, (_, index) => ({
      ...notification,
      id: `rule-1:listing-${index}`,
      listingId: `listing-${index}`,
      playerName: `Player ${index}`,
    }))
    const message = formatMarketplaceNotificationMessage('husain', notifications)
    expect(message).toContain('Player 9')
    expect(message).not.toContain('Player 10')
    expect(message).toContain('…and 2 more.')
  })

  it('keeps notifications pending when no delivery channel is configured', async () => {
    delete process.env.MARKETPLACE_DISCORD_WEBHOOK_URL
    delete process.env.MARKETPLACE_DISCORD_BOT_TOKEN
    delete process.env.MARKETPLACE_DISCORD_USER_ID
    delete process.env.MARKETPLACE_TELEGRAM_BOT_TOKEN
    delete process.env.MARKETPLACE_TELEGRAM_CHAT_ID
    await expect(deliverMarketplaceNotifications({ owner: 'husain', notifications: [notification] }))
      .resolves.toEqual({ configured: false, channel: null, delivered: 0 })
  })

  it('sends a Discord payload with mentions disabled', async () => {
    delete process.env.MARKETPLACE_DISCORD_BOT_TOKEN
    delete process.env.MARKETPLACE_DISCORD_USER_ID
    process.env.MARKETPLACE_DISCORD_WEBHOOK_URL = 'https://discord.example/webhook'
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deliverMarketplaceNotifications({ owner: 'husain', notifications: [notification] }))
      .resolves.toEqual({ configured: true, channel: 'discord', delivered: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.example/webhook',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Trevor Lawrence'),
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      allowed_mentions: { parse: [] },
    })
  })

  it('opens a Discord DM and sends the alert with the bot token', async () => {
    process.env.MARKETPLACE_DISCORD_BOT_TOKEN = 'discord-bot-token'
    process.env.MARKETPLACE_DISCORD_USER_ID = '123456789012345678'
    process.env.MARKETPLACE_DISCORD_WEBHOOK_URL = 'https://discord.example/webhook'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'dm-channel-1' }))
      .mockResolvedValueOnce(Response.json({ id: 'message-1' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deliverMarketplaceNotifications({ owner: 'husain', notifications: [notification] }))
      .resolves.toEqual({ configured: true, channel: 'discord_dm', delivered: 1 })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://discord.com/api/v10/users/@me/channels',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bot discord-bot-token' }),
        body: JSON.stringify({ recipient_id: '123456789012345678' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://discord.com/api/v10/channels/dm-channel-1/messages',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Trevor Lawrence'),
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      allowed_mentions: { parse: [] },
    })
  })

  it('routes an account to its explicit Discord recipient instead of the legacy user', async () => {
    process.env.MARKETPLACE_DISCORD_BOT_TOKEN = 'discord-bot-token'
    process.env.MARKETPLACE_DISCORD_USER_ID = '111111111111111111'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'dm-channel-2' }))
      .mockResolvedValueOnce(Response.json({ id: 'message-2' }))
    vi.stubGlobal('fetch', fetchMock)

    await deliverMarketplaceNotifications({
      owner: 'another-user',
      notifications: [notification],
      discordUserId: '222222222222222222',
      allowLegacyDiscordUserId: false,
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      recipient_id: '222222222222222222',
    })
  })

  it('does not leak alerts to the legacy recipient after account routing is enabled', async () => {
    process.env.MARKETPLACE_DISCORD_BOT_TOKEN = 'discord-bot-token'
    process.env.MARKETPLACE_DISCORD_USER_ID = '111111111111111111'
    delete process.env.MARKETPLACE_DISCORD_WEBHOOK_URL
    delete process.env.MARKETPLACE_TELEGRAM_BOT_TOKEN
    delete process.env.MARKETPLACE_TELEGRAM_CHAT_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(deliverMarketplaceNotifications({
      owner: 'unlinked-user',
      notifications: [notification],
      discordUserId: null,
      allowLegacyDiscordUserId: false,
    })).resolves.toEqual({ configured: false, channel: null, delivered: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid Discord user ID before calling Discord', async () => {
    process.env.MARKETPLACE_DISCORD_BOT_TOKEN = 'discord-bot-token'
    process.env.MARKETPLACE_DISCORD_USER_ID = 'not-a-user-id'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(deliverMarketplaceNotifications({ owner: 'husain', notifications: [notification] }))
      .rejects.toThrow('invalid user ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces Discord DM permission errors so the pending queue can retry', async () => {
    process.env.MARKETPLACE_DISCORD_BOT_TOKEN = 'discord-bot-token'
    process.env.MARKETPLACE_DISCORD_USER_ID = '123456789012345678'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))

    await expect(deliverMarketplaceNotifications({ owner: 'husain', notifications: [notification] }))
      .rejects.toThrow('Discord DM delivery failed (403).')
  })

  it('uses Telegram when Discord is not configured', async () => {
    delete process.env.MARKETPLACE_DISCORD_WEBHOOK_URL
    delete process.env.MARKETPLACE_DISCORD_BOT_TOKEN
    delete process.env.MARKETPLACE_DISCORD_USER_ID
    process.env.MARKETPLACE_TELEGRAM_BOT_TOKEN = 'bot-token'
    process.env.MARKETPLACE_TELEGRAM_CHAT_ID = 'chat-id'
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deliverMarketplaceNotifications({ owner: 'husain', notifications: [notification] }))
      .resolves.toEqual({ configured: true, channel: 'telegram', delivered: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({ body: expect.stringContaining('"chat_id":"chat-id"') }),
    )
  })

  it('surfaces delivery errors so the pending queue can retry', async () => {
    delete process.env.MARKETPLACE_DISCORD_BOT_TOKEN
    delete process.env.MARKETPLACE_DISCORD_USER_ID
    process.env.MARKETPLACE_DISCORD_WEBHOOK_URL = 'https://discord.example/webhook'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429 })))
    await expect(deliverMarketplaceNotifications({ owner: 'husain', notifications: [notification] }))
      .rejects.toThrow('Notification delivery failed (429).')
  })
})
