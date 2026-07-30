import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  clearLocalDevAccountPreference,
  isLocalDevAccountPreferred,
  preferLocalDevAccount,
} from '../lib/localDevAccount'

type AccountStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AccountContextValue = {
  status: AccountStatus
  username: string | null
  devBypass: boolean
  login: (username: string, password: string) => Promise<string | null>
  register: (username: string, password: string) => Promise<string | null>
  /** Localhost-only: use this browser's localStorage collection without cloud login. */
  continueWithLocalData: () => void
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AccountContext = createContext<AccountContextValue | null>(null)

async function readAccountSession(): Promise<{
  ok: boolean
  username: string | null
  devBypass: boolean
}> {
  try {
    const response = await fetch('/api/account/session', { credentials: 'include' })
    if (response.ok) {
      const data = (await response.json()) as {
        ok?: boolean
        username?: string | null
        devBypass?: boolean
      }
      if (data.ok && data.username) {
        clearLocalDevAccountPreference()
        return {
          ok: true,
          username: data.username,
          // Real signed-in account → cloud sync, even on localhost.
          devBypass: false,
        }
      }
    }
  } catch {
    // Fall through — API may be unavailable briefly in vite startup.
  }

  // Explicit local-data mode (localhost only).
  if (isLocalDevAccountPreferred()) {
    return { ok: true, username: 'dev', devBypass: true }
  }

  return { ok: false, username: null, devBypass: false }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus>('loading')
  const [username, setUsername] = useState<string | null>(null)
  const [devBypass, setDevBypass] = useState(false)

  const refresh = useCallback(async () => {
    const session = await readAccountSession()
    setDevBypass(session.devBypass)
    setUsername(session.username)
    setStatus(session.ok ? 'authenticated' : 'unauthenticated')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (accountUsername: string, password: string) => {
      const response = await fetch('/api/account/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: accountUsername, password }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string; storageConfigured?: boolean; hint?: string; env?: string }
          | null
        if (data?.hint) {
          return [data.error, data.hint].filter(Boolean).join(' ')
        }
        if (data?.storageConfigured === false) {
          return (
            data.error ??
            'Account storage is not configured. In Vercel, enable KV_REST_API_URL and KV_REST_API_TOKEN for Preview, then redeploy.'
          )
        }
        if (import.meta.env.DEV && response.status === 401 && data?.error?.includes('Incorrect')) {
          return `${data.error} If this password works on production, copy TRACKER_SYNC_SECRET from Vercel into .env.local (and match AUTH_SESSION_SECRET), then restart npm run dev.`
        }
        return data?.error ?? 'Login failed'
      }

      clearLocalDevAccountPreference()
      await refresh()
      return null
    },
    [refresh],
  )

  const register = useCallback(
    async (accountUsername: string, password: string) => {
      const response = await fetch('/api/account/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: accountUsername, password }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string; storageConfigured?: boolean }
          | null
        if (data?.storageConfigured === false && import.meta.env.DEV) {
          return (
            data.error ??
            'Account storage is not configured. Add KV_REST_API_URL, KV_REST_API_TOKEN, and AUTH_SESSION_SECRET to .env.local (same as Vercel), then restart npm run dev.'
          )
        }
        return data?.error ?? 'Could not create account'
      }

      clearLocalDevAccountPreference()
      await refresh()
      return null
    },
    [refresh],
  )

  const continueWithLocalData = useCallback(() => {
    if (!import.meta.env.DEV) return
    preferLocalDevAccount()
    setDevBypass(true)
    setUsername('dev')
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    clearLocalDevAccountPreference()
    try {
      await fetch('/api/account/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // Still clear client state if logout request fails.
    }
    setDevBypass(false)
    setUsername(null)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo(
    () => ({
      status,
      username,
      devBypass,
      login,
      register,
      continueWithLocalData,
      logout,
      refresh,
    }),
    [status, username, devBypass, login, register, continueWithLocalData, logout, refresh],
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useAccountAuth(): AccountContextValue {
  const value = useContext(AccountContext)
  if (!value) throw new Error('useAccountAuth must be used inside AccountProvider')
  return value
}
