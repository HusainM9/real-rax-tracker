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
})
