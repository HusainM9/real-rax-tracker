import { describe, expect, it } from 'vitest'
import { canonicalizeImportPass } from './meowbotServerImport'

describe('canonicalizeImportPass', () => {
  it('keeps NHL 2023-24 on season_year 2024 (end-year encoding)', () => {
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

  it('keeps Seth Jarvis 2025-26 on NHL season_year 2026', () => {
    expect(
      canonicalizeImportPass({
        entityId: 950,
        seasonYear: 2026,
        sportRaw: 'nhl',
        sport: 'NHL',
        seasonLabel: '2025-26',
        name: 'Seth Jarvis',
        passKind: 'player',
        externalKey: '950|2026|NHL',
      }),
    ).toMatchObject({
      seasonYear: 2026,
      seasonLabel: '2025-26',
      externalKey: '950|2026|NHL',
    })
  })

  // FC is start-year encoded: a live Real pass carries season 2025 with seasonDisplay "2025-26".
  it('keeps 2025-26 on FC season_year 2025', () => {
    expect(
      canonicalizeImportPass({
        entityId: 123,
        seasonYear: 2025,
        sportRaw: 'fc',
        sport: 'FC',
        seasonLabel: '2025-26',
        name: 'Player',
        passKind: 'player',
        externalKey: '123|2025|FC',
      }),
    ).toMatchObject({
      seasonYear: 2025,
      seasonLabel: '2025-26',
      externalKey: '123|2025|FC',
    })
  })

  it('repairs bare calendar FC labels to the canonical split season', () => {
    expect(
      canonicalizeImportPass({
        entityId: 123,
        seasonYear: 2025,
        sportRaw: 'fc',
        sport: 'FC',
        seasonLabel: '2025',
        name: 'Player',
        passKind: 'player',
        externalKey: '123|2025|FC',
      }),
    ).toMatchObject({
      seasonYear: 2025,
      seasonLabel: '2025-26',
    })
  })
})
