/** Server-side bounded-concurrency worker pool (the browser copy lives in src/lib/meowbotApi.ts). */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  let stopped = false
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (!stopped && nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      try {
        if (item !== undefined) await worker(item, index)
      } catch (error) {
        stopped = true
        throw error
      }
    }
  })
  await Promise.all(workers)
}
