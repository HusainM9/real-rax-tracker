import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealApiContext } from './realApi'

vi.mock('./meowbotCatalogStore', () => ({
  meowbotCatalogConfigured: () => true,
  fetchCatalogPassAvatars: vi.fn(),
  findCatalogAvatarForEntitySport: vi.fn(),
  upsertCatalogPasses: vi.fn(async (passes: unknown[]) => passes.length),
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
  upsertCatalogPasses,
} from './meowbotCatalogStore'
import { getRealSportEntity } from './realApi'
import { resolveCatalogAvatars } from './catalogAvatarResolve'

describe('resolveCatalogAvatars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(upsertCatalogPasses).mockImplementation(async (passes) => passes.length)
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
    expect(upsertCatalogPasses).toHaveBeenCalled()
  })

  it('fills college faces from Real player entity when catalog has no avatar', async () => {
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
    expect(result.avatars).toEqual([
      { externalKey: '461757|2024|CFB', avatar: 'b4b3c9b263b4d64b18d9280155027c33' },
    ])
    expect(result.filledFromReal).toBe(1)
    expect(getRealSportEntity).toHaveBeenCalledWith(
      { entityId: 461757, sport: 'ncaaf', entityType: 'player' },
      realContext,
    )
    expect(upsertCatalogPasses).toHaveBeenCalled()
  })

  it('fills UFC faces from Real team entity even when catalog passKind is player', async () => {
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
    expect(result.avatars).toEqual([{ externalKey: '1936|2023|UFC', avatar: 'd5985082bc' }])
    expect(result.filledFromReal).toBe(1)
    expect(getRealSportEntity).toHaveBeenCalledWith(
      { entityId: 1936, sport: 'ufc', entityType: 'team' },
      realContext,
    )
  })
})
