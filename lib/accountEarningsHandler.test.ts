import { expect, it, vi } from 'vitest'
// Retained core/error-contract coverage only; retired entry-point tests use the real flag.
vi.mock('./earningsFeature.js', async (original) => ({ ...await original<typeof import('./earningsFeature')>(), DAILY_EARNINGS_FEATURE_ENABLED: true }))
import { RequestSafetyError } from './httpFailurePolicy'
const mocks = vi.hoisted(() => ({ reconstruct: vi.fn() }))
vi.mock('./publicDailyEarnings.js', () => ({ currentRealEarningsDay: () => '2026-10-30', reconstructPublicDailyEarnings: mocks.reconstruct }))
vi.mock('./realApi.js', async (original) => ({ ...await original(), resolveRealApiConfig: () => ({}) }))
import { handleAccountEarnings } from './accountEarningsHandler'

it('keeps the original 5xx status and no-repeat rule in manual earnings responses', async () => {
  mocks.reconstruct.mockRejectedValue(new RequestSafetyError('Upstream stopped', 'upstream_5xx', 504))
  const response = await handleAccountEarnings(new Request('https://offline.invalid/api/account/earnings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gordon', day: '2026-10-30' }) }))
  expect(response.status).toBe(423)
  expect(await response.json()).toMatchObject({ upstreamStatus: 504, retryable: false })
})
