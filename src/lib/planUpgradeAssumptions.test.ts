import { describe, expect, it } from 'vitest'
import type { PlannedPass } from '../types/rax'
import { assumeAllPlanUpgrades, setPlanUpgradeAssumed } from './planUpgradeAssumptions'

const pass = { id: 'one', externalKey: 'nba:2026:1', name: 'Plan player', sport: 'NBA', season: '2026-27', passKind: 'player', simulatedRarityLabel: 'Rare' } as PlannedPass

describe('Plan upgrade assumptions', () => {
  it('selects and deselects a Plan card without editing the original pass', () => {
    const original = { ...pass }
    const selected = setPlanUpgradeAssumed([], pass, true)
    expect(selected).toHaveLength(1)
    expect(selected[0]).toMatchObject({ externalKey: pass.externalKey, mode: 'assume-iconic-1' })
    expect(setPlanUpgradeAssumed(selected, pass, false)).toEqual([])
    expect(pass).toEqual(original)
  })
  it('is idempotent, replaces exclusions, and preserves other assumptions', () => {
    const other = { ...pass, id: 'two', externalKey: 'nba:2026:2' }
    const previous = [{ ...setPlanUpgradeAssumed([], pass, true)[0]!, mode: 'exclude' as const }, ...setPlanUpgradeAssumed([], other, true)]
    const selected = setPlanUpgradeAssumed(previous, pass, true)
    expect(selected).toHaveLength(2)
    expect(selected.find((item) => item.externalKey === pass.externalKey)?.mode).toBe('assume-iconic-1')
    expect(setPlanUpgradeAssumed(selected, pass, true)).toEqual(selected)
    expect(setPlanUpgradeAssumed(selected, pass, false)).toEqual(setPlanUpgradeAssumed([], other, true))
  })
  it('selects all eligible plan cards and skips missing catalog links', () => {
    const second = { ...pass, id: 'two', externalKey: 'nba:2026:2' }
    expect(assumeAllPlanUpgrades([], [pass, second, { ...pass, externalKey: '' }])).toHaveLength(2)
  })
})
