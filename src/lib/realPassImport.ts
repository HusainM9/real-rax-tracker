import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'
import type { MeowbotPlayerPass } from './meowbotApi'

export type RealPassImportResult = {
  playerPasses: MeowbotPlayerPass[]
  teamPasses: MeowbotPlayerPass[]
  rarities: Record<string, string[]>
}

type RealPassesResponse = {
  ok?: boolean
  error?: string
  code?: string
  username?: string
  playerPasses?: MeowbotPlayerPass[]
  teamPasses?: MeowbotPlayerPass[]
  rarities?: Record<string, string[]>
  passesEncoding?: 'gzip-base64'
  passesPayload?: string
}

export const REAL_PASSES_ENDPOINT = '/api/import/real-passes'

function emptyResult(): RealPassImportResult {
  return { playerPasses: [], teamPasses: [], rarities: {} }
}

/**
 * Reads a user's owned pass list from Real via the server-side route. The browser cannot call
 * Real directly — the app's CSP blocks it and preflight rejects Real's custom headers.
 */
export async function fetchRealUserPasses(
  username: string,
  signal?: AbortSignal,
): Promise<RealPassImportResult> {
  const trimmed = username.replace(/^@/, '').trim()
  if (!trimmed) {
    throw new Error('Enter a Real username.')
  }

  const response = await fetch(REAL_PASSES_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: trimmed }),
    signal,
  })

  const text = await response.text()
  let body: RealPassesResponse | null = null
  if (text.trim()) {
    try {
      body = JSON.parse(text) as RealPassesResponse
    } catch {
      const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 160)
      throw new Error(
        response.ok
          ? `Real pass import returned invalid JSON: ${snippet}`
          : `Real pass import failed (${response.status}): ${snippet}`,
      )
    }
  }

  if (!response.ok) {
    throw new Error(body?.error || `Real pass import failed (${response.status}).`)
  }
  if (!body) {
    throw new Error(`Real pass import returned an empty response (${response.status}).`)
  }

  let payload: RealPassImportResult = {
    playerPasses: Array.isArray(body.playerPasses) ? body.playerPasses : [],
    teamPasses: Array.isArray(body.teamPasses) ? body.teamPasses : [],
    rarities: body.rarities ?? {},
  }

  if (
    payload.playerPasses.length === 0 &&
    payload.teamPasses.length === 0 &&
    body.passesEncoding === 'gzip-base64' &&
    typeof body.passesPayload === 'string'
  ) {
    const decoded = (await gunzipBase64ToJson(body.passesPayload)) as RealPassImportResult | null
    payload = {
      ...emptyResult(),
      ...(decoded ?? {}),
    }
  }

  if (payload.playerPasses.length === 0 && payload.teamPasses.length === 0) {
    throw new Error(`No passes found for @${trimmed}.`)
  }

  return payload
}
