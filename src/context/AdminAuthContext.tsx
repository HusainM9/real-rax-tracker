import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type AdminStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AdminContextValue = {
  status: AdminStatus
  devBypass: boolean
  login: (password: string) => Promise<string | null>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AdminContext = createContext<AdminContextValue | null>(null)

async function readAdminSession(): Promise<{ ok: boolean; devBypass: boolean }> {
  if (import.meta.env.DEV) {
    return { ok: true, devBypass: true }
  }

  try {
    const response = await fetch('/api/admin/session', { credentials: 'include' })
    if (!response.ok) return { ok: false, devBypass: false }
    const data = (await response.json()) as { ok?: boolean; devBypass?: boolean }
    return { ok: Boolean(data.ok), devBypass: Boolean(data.devBypass) }
  } catch {
    return { ok: false, devBypass: false }
  }
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminStatus>('loading')
  const [devBypass, setDevBypass] = useState(false)

  const refresh = useCallback(async () => {
    const session = await readAdminSession()
    setDevBypass(session.devBypass)
    setStatus(session.ok ? 'authenticated' : 'unauthenticated')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (password: string) => {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      return data?.error ?? 'Admin login failed'
    }

    await refresh()
    return null
  }, [refresh])

  const logout = useCallback(async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' })
    setStatus('unauthenticated')
  }, [])

  const value = useMemo(
    () => ({ status, devBypass, login, logout, refresh }),
    [status, devBypass, login, logout, refresh],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdminAuth(): AdminContextValue {
  const value = useContext(AdminContext)
  if (!value) throw new Error('useAdminAuth must be used inside AdminProvider')
  return value
}
