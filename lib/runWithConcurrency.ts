/** Server-side bounded-concurrency worker pool (the browser copy lives in src/lib/meowbotApi.ts). */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      if (item !== undefined) await worker(item, index)
    }
  })
  await Promise.all(workers)
}
