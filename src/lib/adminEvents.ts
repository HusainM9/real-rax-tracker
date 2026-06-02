import { createId } from './id'
import type { UsernameImportResult } from './usernameImport'

const CLIENT_ID_KEY = 'rax-client-id'

export type AdminEventPayload = {
  type: 'import_complete' | 'pass_no_earnings' | 'pass_fetch_error'
  realUsername: string
  clientId: string
  passName?: string
  sport?: string
  season?: string
  rarityLabel?: string
  passKind?: 'player' | 'team'
  externalKey?: string
  message?: string
}

export function getAdminClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing
    const created = createId('client')
    localStorage.setItem(CLIENT_ID_KEY, created)
    return created
  } catch {
    return 'anonymous-client'
  }
}

export async function postAdminEvents(events: AdminEventPayload[]): Promise<void> {
  if (events.length === 0 || import.meta.env.DEV) return

  try {
    await fetch('/api/admin/events', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    })
  } catch {
    // Fire-and-forget — never block import UX.
  }
}

export function buildImportAdminEvents(
  realUsername: string,
  result: UsernameImportResult,
): AdminEventPayload[] {
  const clientId = getAdminClientId()
  const normalizedUsername = realUsername.replace(/^@/, '').trim().toLowerCase()
  const events: AdminEventPayload[] = [
    {
      type: 'import_complete',
      realUsername: normalizedUsername,
      clientId,
      message: `Imported ${result.rowsImported} rows from ${result.passesFetched} passes (${result.passesWithNoEarnings.length} with no earnings, ${result.passFetchErrors.length} fetch errors).`,
    },
  ]

  for (const pass of result.passesWithNoEarnings) {
    if (pass.passKind !== 'player') continue
    events.push({
      type: 'pass_no_earnings',
      realUsername: normalizedUsername,
      clientId,
      passName: pass.name,
      sport: pass.sport,
      season: pass.season,
      rarityLabel: pass.rarityLabel,
      passKind: pass.passKind,
      externalKey: pass.externalKey,
      message: 'No daily earnings returned from realapp.tools',
    })
  }

  for (const pass of result.passFetchErrors) {
    if (pass.passKind !== 'player') continue
    events.push({
      type: 'pass_fetch_error',
      realUsername: normalizedUsername,
      clientId,
      passName: pass.name,
      sport: pass.sport,
      season: pass.season,
      rarityLabel: pass.rarityLabel,
      passKind: pass.passKind,
      externalKey: pass.externalKey,
      message: pass.message,
    })
  }

  return events
}

export async function reportImportAdminEvents(
  realUsername: string,
  result: UsernameImportResult,
): Promise<void> {
  await postAdminEvents(buildImportAdminEvents(realUsername, result))
}
