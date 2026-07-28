import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type AccountStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AccountContextValue = {
  status: AccountStatus
  username: string | null
  devBypass: boolean
  login: (username: string, password: string) => Promise<string | null>
  register: (username: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AccountContext = createContext<AccountContextValue | null>(null)

async function readAccountSession(): Promise<{
  ok: boolean
  username: string | null
  devBypass: boolean
}> {
  if (import.meta.env.DEV) {
    try {
      const response = await fetch('/api/account/session', { credentials: 'include' })
      if (response.ok) {
        const data = (await response.json()) as {
          ok?: boolean
          username?: string | null
          devBypass?: boolean
        }
        if (data.ok && data.username) {
          return { ok: true, username: data.username, devBypass: Boolean(data.devBypass) }
        }
      }
    } catch {
      // Fall through to local bypass when the API is unavailable in dev.
    }
    return { ok: true, username: 'dev', devBypass: true }
  }

  try {
    const response = await fetch('/api/account/session', { credentials: 'include' })
    if (!response.ok) return { ok: false, username: null, devBypass: false }
    const data = (await response.json()) as { ok?: boolean; username?: string | null }
    return {
      ok: Boolean(data.ok && data.username),
      username: data.username ?? null,
      devBypass: false,
    }
  } catch {
    return { ok: false, username: null, devBypass: false }
  }
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
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        return data?.error ?? 'Login failed'
      }

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
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        return data?.error ?? 'Could not create account'
      }

      await refresh()
      return null
    },
    [refresh],
  )

  const logout = useCallback(async () => {
    await fetch('/api/account/logout', { method: 'POST', credentials: 'include' })
    setUsername(null)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo(
    () => ({ status, username, devBypass, login, register, logout, refresh }),
    [status, username, devBypass, login, register, logout, refresh],
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useAccountAuth(): AccountContextValue {
  const value = useContext(AccountContext)
  if (!value) throw new Error('useAccountAuth must be used inside AccountProvider')
  return value
}
