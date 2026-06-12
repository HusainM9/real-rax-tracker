/** Letters, numbers, and common symbols — no spaces. */
export const SYNC_PIN_MIN_LENGTH = 4
export const SYNC_PIN_MAX_LENGTH = 12
export const SYNC_PIN_PATTERN = /^[A-Za-z0-9._@#\-!$%&*+=?]{4,12}$/

export const SYNC_PIN_HELP =
  '4–12 characters: letters, numbers, and . _ - @ # ! $ % & * + = ? (no spaces).'

export type SyncPinValidation =
  | { ok: true; pin: string; error?: never }
  | { ok: false; error: string; pin?: never }

export function validateSyncPin(value: string): SyncPinValidation {
  if (/\s/.test(value)) {
    return { ok: false, error: 'Sync PIN cannot contain spaces.' }
  }

  const pin = value.trim()
  if (pin.length < SYNC_PIN_MIN_LENGTH) {
    return { ok: false, error: `Sync PIN must be at least ${SYNC_PIN_MIN_LENGTH} characters.` }
  }
  if (pin.length > SYNC_PIN_MAX_LENGTH) {
    return { ok: false, error: `Sync PIN must be ${SYNC_PIN_MAX_LENGTH} characters or fewer.` }
  }
  if (!SYNC_PIN_PATTERN.test(pin)) {
    return {
      ok: false,
      error: 'Use letters, numbers, and . _ - @ # ! $ % & * + = ? only.',
    }
  }

  return { ok: true, pin }
}

export function stripSpacesFromSyncPinInput(value: string): string {
  return value.replace(/\s/g, '').slice(0, SYNC_PIN_MAX_LENGTH)
}
