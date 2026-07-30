/** sessionStorage flag: use browser-local data instead of a cloud account (localhost only). */
export const LOCAL_DEV_ACCOUNT_KEY = 'rax_local_dev_account'

export function isLocalDevAccountPreferred(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return sessionStorage.getItem(LOCAL_DEV_ACCOUNT_KEY) === '1'
  } catch {
    return false
  }
}

export function preferLocalDevAccount(): void {
  try {
    sessionStorage.setItem(LOCAL_DEV_ACCOUNT_KEY, '1')
  } catch {
    // Ignore private-mode / blocked storage.
  }
}

export function clearLocalDevAccountPreference(): void {
  try {
    sessionStorage.removeItem(LOCAL_DEV_ACCOUNT_KEY)
  } catch {
    // Ignore private-mode / blocked storage.
  }
}
