import { describe, expect, it } from 'vitest'
import snapshotEarnings from './snapshot-earnings'
import afterSixSummer from './snapshot-earnings-after-six-summer'
import afterSixWinter from './snapshot-earnings-after-six-winter'
import fallback from './snapshot-earnings-fallback'
import finalCheck from './snapshot-earnings-final-check'
import golfFinalSummer from './snapshot-earnings-golf-final-summer'
import golfFinalWinter from './snapshot-earnings-golf-final-winter'
import summer from './snapshot-earnings-summer'
import winter from './snapshot-earnings-winter'

describe('snapshot earnings route aliases', () => {
  it.each([
    ['after-six summer', afterSixSummer],
    ['after-six winter', afterSixWinter],
    ['fallback', fallback],
    ['final check', finalCheck],
    ['golf final summer', golfFinalSummer],
    ['golf final winter', golfFinalWinter],
    ['summer', summer],
    ['winter', winter],
  ])('%s delegates to the canonical handler', (_name, handler) => {
    expect(handler).toBe(snapshotEarnings)
  })
})
