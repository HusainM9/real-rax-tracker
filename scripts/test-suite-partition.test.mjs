import { expect, it } from 'vitest'
import { verifyTestPartition } from './test-suite-partition.mjs'

const retired = { file: 'tests/safety/retired.test.ts', name: 'retired route', projectName: 'unit' }
const ordinary = { file: 'src/domain.test.ts', name: 'domain behavior', projectName: 'unit' }
const complete = { full: [retired, retired, ordinary], gate: [retired, retired], remaining: [ordinary] }

it('preserves repeated case occurrences when comparing the complete required partition', () => {
  expect(verifyTestPartition(complete)).toEqual({ total: 3, gate: 2, remaining: 1, files: 2 })
})

it('detects losing one route even when its title is identical to another route', () => {
  expect(() => verifyTestPartition({ ...complete, gate: [retired] })).toThrow(/missing case occurrences/i)
})

it('rejects overlap between the mandatory gate and its complement', () => {
  expect(() => verifyTestPartition({ ...complete, remaining: [ordinary, retired] })).toThrow(/overlap/i)
})

it('rejects selected cases absent from full discovery', () => {
  expect(() => verifyTestPartition({ ...complete, remaining: [ordinary, { ...ordinary, name: 'extra' }] })).toThrow(/extra case occurrences/i)
})

it.each(['full', 'gate', 'remaining'])('fails closed when %s discovery is empty', part => {
  expect(() => verifyTestPartition({ ...complete, [part]: [] })).toThrow(/empty/i)
})

it('rejects a mandatory filename that no longer discovers any cases', () => {
  expect(() => verifyTestPartition(complete, { requiredGateFiles: ['tests/safety/missing.test.ts'] })).toThrow(/mandatory file/i)
})

it('detects a file omitted by project configuration rather than accepting incomplete full discovery', () => {
  expect(() => verifyTestPartition(complete, { expectedFiles: ['src/unclassified.test.ts'] })).toThrow(/undiscovered file/i)
})

it('rejects running the same file in two projects even when the CI partition otherwise balances', () => {
  const duplicate = { ...ordinary, projectName: 'ui' }
  expect(() => verifyTestPartition({
    ...complete, full: [...complete.full, duplicate], remaining: [ordinary, duplicate],
  })).toThrow(/multiple projects/i)
})
