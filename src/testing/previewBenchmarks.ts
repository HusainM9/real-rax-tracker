import { fetchPackRatings } from '../lib/packRatingsImport'

export async function benchmarkHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type PackProbeSample = { mode: 'forced-fresh' | 'reuse'; ms: number; passCount: number; source?: string; fetchedAt?: string; hash: string }

/** Preview-only transport probe. No tracker context, account PUT, or persistence. */
export async function probePackRatings(username: string, signal?: AbortSignal, onSample?: (samples: PackProbeSample[]) => void) {
  const samples: PackProbeSample[] = []
  for (const forceRefresh of [true, false]) {
    for (let index = 0; index < 5; index++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const start = performance.now()
      const result = await fetchPackRatings(username, signal, { forceRefresh })
      const ms = performance.now() - start
      const passes = [...result.passes].sort((a, b) => a.externalKey.localeCompare(b.externalKey))
      samples.push({ mode: forceRefresh ? 'forced-fresh' : 'reuse', ms, passCount: result.passCount, source: result.source, fetchedAt: result.fetchedAt, hash: await benchmarkHash(passes) })
      onSample?.([...samples])
    }
  }
  return samples
}
