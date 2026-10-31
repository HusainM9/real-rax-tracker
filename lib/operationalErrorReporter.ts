import { waitUntil } from '@vercel/functions'
import { appendOperationalErrors } from './operationalErrorStore.js'
import { createOperationalError, type OperationalErrorInput } from './operationalErrorTypes.js'

type Observation = { operation: string; count: number }
const observations = new WeakMap<AbortSignal, Observation>()
export function observeRequestErrors(signal: AbortSignal, operation: string): Observation {
  const observation = { operation, count: 0 }; observations.set(signal, observation); return observation
}
export function inheritErrorObserver(parent: AbortSignal | undefined, child: AbortSignal): void {
  const observation = parent && observations.get(parent); if (observation) observations.set(child, observation)
}
export function reportOperationalError(input: OperationalErrorInput, signal?: AbortSignal): void {
  const observation = signal && observations.get(signal)
  if (observation) observation.count++
  const event = createOperationalError({ ...input, operation: observation?.operation ?? input.operation })
  const persist = appendOperationalErrors([event]).catch(() => { console.error('operational-error fallback', event) })
  // Lifetime extension, never an HTTP retry or admission latch. No await on the user's operation.
  waitUntil(persist)
}
export function observeProviderError(provider: string, input: Omit<OperationalErrorInput, 'source'>, signal?: AbortSignal): void {
  const source = provider === 'real' ? 'real' : provider === 'supabase-catalog' ? 'catalog' : 'notification'
  reportOperationalError({ ...input, source, operation: input.operation ?? (source === 'real' ? 'real_request' : source === 'catalog' ? 'catalog_request' : 'notification_request') }, signal)
}
