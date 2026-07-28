/** Account passwords — longer than legacy sync PINs; still accepts old PIN charset for migration. */
export const ACCOUNT_PASSWORD_MIN_LENGTH = 4
export const ACCOUNT_PASSWORD_MAX_LENGTH = 72

export const ACCOUNT_PASSWORD_HELP =
  'At least 4 characters. Use your Real @username as the account name.'

export type AccountPasswordValidation =
  | { ok: true; password: string; error?: never }
  | { ok: false; error: string; password?: never }

export function validateAccountPassword(value: string): AccountPasswordValidation {
  const password = value.trim()
  if (!password) {
    return { ok: false, error: 'Password is required.' }
  }
  if (password.length < ACCOUNT_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters.`,
    }
  }
  if (password.length > ACCOUNT_PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      error: `Password must be ${ACCOUNT_PASSWORD_MAX_LENGTH} characters or fewer.`,
    }
  }
  return { ok: true, password }
}

export type AccountUsernameValidation =
  | { ok: true; username: string; error?: never }
  | { ok: false; error: string; username?: never }

export function validateAccountUsername(value: string): AccountUsernameValidation {
  const username = value.replace(/^@/, '').trim().toLowerCase()
  if (!username) {
    return { ok: false, error: 'Enter your Real @username.' }
  }
  if (username.length > 40) {
    return { ok: false, error: 'Username is too long.' }
  }
  if (!/^[a-z0-9._-]+$/i.test(username)) {
    return {
      ok: false,
      error: 'Use letters, numbers, and . _ - only (your Real @username).',
    }
  }
  return { ok: true, username }
}
