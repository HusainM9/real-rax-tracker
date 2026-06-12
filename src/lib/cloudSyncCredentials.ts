const CREDENTIALS_KEY = 'real-rax-tracker:cloud-sync:v1'

export type CloudSyncCredentials = {
  username: string
  passphrase: string
}

export function loadCloudSyncCredentials(): CloudSyncCredentials | null {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CloudSyncCredentials>
    if (!parsed.username?.trim() || !parsed.passphrase) return null
    return {
      username: parsed.username.trim(),
      passphrase: parsed.passphrase,
    }
  } catch {
    return null
  }
}

export function saveCloudSyncCredentials(credentials: CloudSyncCredentials | null): void {
  try {
    if (!credentials?.username.trim() || !credentials.passphrase) {
      localStorage.removeItem(CREDENTIALS_KEY)
      return
    }
    localStorage.setItem(
      CREDENTIALS_KEY,
      JSON.stringify({
        username: credentials.username.trim(),
        passphrase: credentials.passphrase,
      }),
    )
  } catch {
    // Ignore private-mode and quota failures.
  }
}
