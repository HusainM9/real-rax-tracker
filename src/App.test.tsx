import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Outlet } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

vi.mock('./context/AuthContext', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./context/AccountAuthContext', () => ({ AccountProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./context/RaxDataContext', () => ({ RaxDataProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./components/RequireAuth', () => ({ default: () => <Outlet /> }))
vi.mock('./components/RequireAccount', () => ({ default: () => <Outlet /> }))
vi.mock('./components/RequireEarnings', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('./components/Layout', () => ({ default: () => <Outlet /> }))
vi.mock('./pages/DashboardPage', () => ({ default: () => <h1>Dashboard</h1> }))
vi.mock('./pages/EarningsPage', () => ({ default: () => <h1>Retired earnings</h1> }))
import App from './App'

it.each(['/earnings', '/earnings/access'])('redirects the retired %s bookmark to Dashboard', async (pathname) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState({}, '', pathname)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<App />) })
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'))
  } finally { await act(async () => root.unmount()) }
})
