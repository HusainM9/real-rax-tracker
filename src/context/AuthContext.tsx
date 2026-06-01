import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  status: AuthStatus
  devBypass: boolean
  login: (username: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function readSession(): Promise<{ ok: boolean; devBypass: boolean }> {
  if (import.meta.env.DEV) {
    return { ok: true, devBypass: true }
  }

  try {
    const response = await fetch('/api/auth/session', { credentials: 'include' })
    if (!response.ok) return { ok: false, devBypass: false }
    const data = (await response.json()) as { ok?: boolean; devBypass?: boolean }
    return { ok: Boolean(data.ok), devBypass: Boolean(data.devBypass) }
  } catch {
    return { ok: false, devBypass: false }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [devBypass, setDevBypass] = useState(false)

  const refresh = useCallback(async () => {
    const session = await readSession()
    setDevBypass(session.devBypass)
    setStatus(session.ok ? 'authenticated' : 'unauthenticated')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      return data?.error ?? 'Login failed'
    }

    await refresh()
    return null
  }, [refresh])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setStatus('unauthenticated')
  }, [])

  const value = useMemo(
    () => ({ status, devBypass, login, logout, refresh }),
    [status, devBypass, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
