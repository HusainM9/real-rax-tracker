import { describe, expect, it } from 'vitest'
import { canonicalizeImportPass } from './meowbotServerImport'

describe('canonicalizeImportPass', () => {
  it('keeps NHL 2023-24 on season_year 2024 even if Meowbot would say 2024-25', () => {
    expect(
      canonicalizeImportPass({
        entityId: 8476389,
        seasonYear: 2024,
        sportRaw: 'nhl',
        sport: 'NHL',
        seasonLabel: '2023-24',
        name: 'Vincent Trocheck',
        passKind: 'player',
        externalKey: '8476389|2024|NHL',
      }),
    ).toEqual({
      entityId: 8476389,
      seasonYear: 2024,
      sportRaw: 'nhl',
      sport: 'NHL',
      seasonLabel: '2023-24',
      name: 'Vincent Trocheck',
      passKind: 'player',
      externalKey: '8476389|2024|NHL',
    })
  })

  it('repairs a Meowbot-style 2024-25 label on NHL season_year 2024 to 2023-24', () => {
    expect(
      canonicalizeImportPass({
        entityId: 8476389,
        seasonYear: 2024,
        sportRaw: 'nhl',
        sport: 'NHL',
        seasonLabel: '2024-25',
        name: 'Vincent Trocheck',
        passKind: 'player',
        externalKey: '8476389|2024|NHL',
      }),
    ).toMatchObject({
      seasonYear: 2024,
      seasonLabel: '2023-24',
      externalKey: '8476389|2024|NHL',
    })
  })

  it('uses 2025-26 on FC season_year 2026', () => {
    expect(
      canonicalizeImportPass({
        entityId: 123,
        seasonYear: 2026,
        sportRaw: 'fc',
        sport: 'FC',
        seasonLabel: '2025-26',
        name: 'Player',
        passKind: 'player',
        externalKey: '123|2026|FC',
      }),
    ).toMatchObject({
      seasonYear: 2026,
      seasonLabel: '2025-26',
      externalKey: '123|2026|FC',
    })
  })

  it('repairs bare calendar FC labels to the canonical split season', () => {
    expect(
      canonicalizeImportPass({
        entityId: 123,
        seasonYear: 2026,
        sportRaw: 'fc',
        sport: 'FC',
        seasonLabel: '2026',
        name: 'Player',
        passKind: 'player',
        externalKey: '123|2026|FC',
      }),
    ).toMatchObject({
      seasonYear: 2026,
      seasonLabel: '2025-26',
    })
  })
})
