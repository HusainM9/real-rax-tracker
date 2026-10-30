import { expect, it } from 'vitest'
import { runWithConcurrency } from './runWithConcurrency'
import { RequestSafetyError } from './httpFailurePolicy'
import { runWithConcurrency as browserPool } from '../src/lib/meowbotApi'

const pools: Array<[string, (items: number[], limit: number, worker: (item: number) => Promise<void>) => Promise<unknown>]> = [
  ['server', runWithConcurrency], ['browser', browserPool],
]
for (const [name, run] of pools) {
  it(`${name} pool stops queuing after a terminal failure in another worker`, async () => {
    const started: number[] = []
    let release!: () => void
    const sibling = new Promise<void>((resolve) => { release = resolve })
    const work = run([1, 2, 3, 4], 2, async (item) => {
      started.push(item)
      if (item === 1) throw new RequestSafetyError('Stopped after HTTP 500', 'upstream_5xx', 500)
      await sibling
    })
    await expect(work).rejects.toMatchObject({ retryable: false })
    release()
    await sibling
    await Promise.resolve()
    expect(started).toEqual([1, 2])
  })
}
