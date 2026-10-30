import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealApiContext } from './realApi'

vi.mock('./meowbotCatalogStore', () => ({
  meowbotCatalogConfigured: () => true,
  fetchCatalogPassAvatars: vi.fn(),
  findCatalogAvatarForEntitySport: vi.fn(),
  updateCatalogPassAvatars: vi.fn(),
  insertCatalogPassesIfMissing: vi.fn(),
}))

vi.mock('./realApi', async () => {
  const actual = await vi.importActual<typeof import('./realApi')>('./realApi')
  return {
    ...actual,
    resolveRealApiConfig: () => null,
    getRealSportEntity: vi.fn(),
  }
})

import {
  fetchCatalogPassAvatars,
  findCatalogAvatarForEntitySport,
  updateCatalogPassAvatars,
} from './meowbotCatalogStore'
import { getRealSportEntity } from './realApi'
import { resolveCatalogAvatars } from './catalogAvatarResolve'

describe('resolveCatalogAvatars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('returns exact catalog avatars when present', async () => {
    vi.mocked(fetchCatalogPassAvatars).mockResolvedValue({
      storageConfigured: true,
      passes: [
        {
          externalKey: '4600663|2024|CBB',
          entityId: 4600663,
          passKind: 'player',
          sport: 'CBB',
          seasonYear: 2024,
          seasonLabel: '2023-24',
          name: 'Zach Edey',
          avatar: '248a479ac84b6273e2267b52c9f7198e',
        },
      ],
    })
    vi.mocked(findCatalogAvatarForEntitySport).mockResolvedValue(undefined)

    const result = await resolveCatalogAvatars(['4600663|2024|CBB'], { realContext: null })
    expect(result.avatars).toEqual([
      { externalKey: '4600663|2024|CBB', avatar: '248a479ac84b6273e2267b52c9f7198e' },
    ])
    expect(result.filledFromReal).toBe(0)
    expect(getRealSportEntity).not.toHaveBeenCalled()
  })

  it('leaves unresolved faces empty without probing Real and accepts a later saved image', async () => {
    const pass = { externalKey: '98765|2026|NBA', entityId: 98765, passKind: 'player' as const, sport: 'NBA', seasonYear: 2026, seasonLabel: '2026-27', name: 'Missing face' }
    vi.mocked(fetchCatalogPassAvatars).mockResolvedValue({ storageConfigured: true, passes: [pass] })
    vi.mocked(findCatalogAvatarForEntitySport).mockResolvedValue(undefined)
    vi.mocked(getRealSportEntity).mockResolvedValue({ id: 98765 })
    const realContext = { config: {} } as RealApiContext
    await resolveCatalogAvatars([pass.externalKey], { realContext })
    await resolveCatalogAvatars([pass.externalKey], { realContext })
    expect(getRealSportEntity).not.toHaveBeenCalled()
    vi.mocked(fetchCatalogPassAvatars).mockResolvedValue({ storageConfigured: true, passes: [{ ...pass, avatar: 'now-available' }] })
    expect((await resolveCatalogAvatars([pass.externalKey], { realContext })).avatars).toEqual([{ externalKey: pass.externalKey, avatar: 'now-available' }])
  })

  it('fills from a sibling season when the owned key has no avatar', async () => {
    vi.mocked(fetchCatalogPassAvatars).mockResolvedValue({
      storageConfigured: true,
      passes: [
        {
          externalKey: '4600663|2025|CBB',
          entityId: 4600663,
          passKind: 'player',
          sport: 'CBB',
          seasonYear: 2025,
          seasonLabel: '2024-25',
          name: 'Zach Edey',
          avatar: undefined,
        },
      ],
    })
    vi.mocked(findCatalogAvatarForEntitySport).mockResolvedValue('sibling-face')

    const result = await resolveCatalogAvatars(['4600663|2025|CBB'], { realContext: null })
    expect(result.avatars).toEqual([{ externalKey: '4600663|2025|CBB', avatar: 'sibling-face' }])
    expect(result.filledFromSiblingSeason).toBe(1)
    expect(updateCatalogPassAvatars).toHaveBeenCalledWith([{ externalKey: '4600663|2025|CBB', avatar: 'sibling-face' }])
  })

  it('does not fill college faces from Real even when a context is supplied', async () => {
    vi.mocked(fetchCatalogPassAvatars).mockResolvedValue({
      storageConfigured: true,
      passes: [
        {
          externalKey: '461757|2024|CFB',
          entityId: 461757,
          passKind: 'player',
          sport: 'CFB',
          seasonYear: 2024,
          seasonLabel: '2024-25',
          name: 'Ashton Jeanty',
          avatar: undefined,
        },
      ],
    })
    vi.mocked(findCatalogAvatarForEntitySport).mockResolvedValue(undefined)
    vi.mocked(getRealSportEntity).mockResolvedValue({
      id: 461757,
      avatar: 'b4b3c9b263b4d64b18d9280155027c33',
      firstName: 'Ashton',
      lastName: 'Jeanty',
    })

    const realContext = {
      config: {
        baseUrl: 'https://web.realapp.com',
        authInfo: 'x',
        sessionToken: 'x',
        deviceUuid: 'x',
        deviceName: 'x',
        deviceType: 'desktop_web',
        version: '35',
        timeoutMs: 1000,
        concurrency: 1,
        maxRetries: 0,
        retryBaseMs: 1,
        retryMaxMs: 1,
      },
    } as RealApiContext

    const result = await resolveCatalogAvatars(['461757|2024|CFB'], { realContext })
    expect(result.avatars).toEqual([])
    expect(result.filledFromReal).toBe(0)
    expect(getRealSportEntity).not.toHaveBeenCalled()
    expect(updateCatalogPassAvatars).not.toHaveBeenCalled()
  })

  it('does not probe UFC teams or players for a missing face', async () => {
    vi.mocked(fetchCatalogPassAvatars).mockResolvedValue({
      storageConfigured: true,
      passes: [
        {
          externalKey: '1936|2023|UFC',
          entityId: 1936,
          passKind: 'player',
          sport: 'UFC',
          seasonYear: 2023,
          seasonLabel: 'All-time',
          name: 'Max Holloway',
          avatar: undefined,
        },
      ],
    })
    vi.mocked(findCatalogAvatarForEntitySport).mockResolvedValue(undefined)
    vi.mocked(getRealSportEntity).mockImplementation(async (query) => {
      if (query.entityType === 'team') {
        return { id: 1936, avatar: 'd5985082bc', name: 'Max Holloway' }
      }
      return { id: 1936 }
    })

    const realContext = {
      config: {
        baseUrl: 'https://web.realapp.com',
        authInfo: 'x',
        sessionToken: 'x',
        deviceUuid: 'x',
        deviceName: 'x',
        deviceType: 'desktop_web',
        version: '35',
        timeoutMs: 1000,
        concurrency: 1,
        maxRetries: 0,
        retryBaseMs: 1,
        retryMaxMs: 1,
      },
    } as RealApiContext

    const result = await resolveCatalogAvatars(['1936|2023|UFC'], { realContext })
    expect(result.avatars).toEqual([])
    expect(result.filledFromReal).toBe(0)
    expect(getRealSportEntity).not.toHaveBeenCalled()
  })
})
