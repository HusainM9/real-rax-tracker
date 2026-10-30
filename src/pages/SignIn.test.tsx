import { act, type ComponentType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../context/AuthContext'
import { AccountProvider } from '../context/AccountAuthContext'
import { AdminProvider } from '../context/AdminAuthContext'
import LoginPage from './LoginPage'
import AccountPage from './AccountPage'
import AdminLoginPage from './AdminLoginPage'

const forms: Array<{ name: string; path: string; endpoint: string; Provider: ComponentType<{ children: ReactNode }>; Page: ComponentType }> = [
  { name: 'site', path: '/login', endpoint: '/api/auth', Provider: AuthProvider, Page: LoginPage },
  { name: 'account', path: '/account', endpoint: '/api/account', Provider: AccountProvider, Page: AccountPage },
  { name: 'admin', path: '/admin/login', endpoint: '/api/admin', Provider: AdminProvider, Page: AdminLoginPage },
]
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubEnv('DEV', false)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe.each(forms)('$name sign-in failure handling', ({ path, endpoint, Provider, Page }) => {
  async function render(loginResponse: () => Promise<Response>, authenticatedAfterLogin = false) {
    let signedIn = false
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `${endpoint}/session`) return Response.json({ ok: signedIn, username: signedIn ? 'fixture' : null })
      if (url === `${endpoint}/login` && init?.method === 'POST') {
        const response = await loginResponse()
        signedIn = authenticatedAfterLogin && response.ok
        return response
      }
      throw new Error('Unexpected offline request')
    })
    vi.stubGlobal('fetch', fetcher)
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Provider><Routes>
      <Route path={path} element={<Page />} />
      <Route path="*" element={<h1>Signed in</h1>} />
    </Routes></Provider></MemoryRouter>))
    expect(container.querySelector('form')).not.toBeNull()
    return fetcher
  }
  it('shows an internal HTTP 503 error without a spinner, permanent pause or automatic retry', async () => {
    const fetcher = await render(async () => Response.json({ error: 'Login dependency returned HTTP 503.' }, { status: 503 }))
    await submit()
    await vi.waitFor(() => expect(container.textContent).not.toContain('Signing in…'))
    expect(container.querySelector('.auth-error')?.textContent).toContain('503')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    expect(fetcher.mock.calls.filter(([url]) => url === `${endpoint}/login`)).toHaveLength(1)
  })
  it('ignores obsolete browser login bans and permits a normal successful sign-in', async () => {
    localStorage.setItem(`rax:request-safety:v2:POST:${window.location.origin}${endpoint}/login`, JSON.stringify({ upstreamStatus: 500 }))
    const fetcher = await render(async () => Response.json({ ok: true }), true)
    await submit()
    await vi.waitFor(() => expect(container.textContent).not.toContain('Signing in…'))
    expect(container.querySelector('h1')?.textContent).toBe('Signed in')
    expect(fetcher.mock.calls.filter(([url]) => url === `${endpoint}/login`)).toHaveLength(1)
  })
  it('stops a lost-response login without an automatic retry or exposing transport details', async () => {
    const fetcher = await render(async () => { throw new TypeError('private-token-and-network-detail') })
    await submit()
    await vi.waitFor(() => expect(container.textContent).not.toContain('Signing in…'))
    expect(container.querySelector('.auth-error')?.textContent).toMatch(/connection|response|connect/i)
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    expect(container.textContent).not.toContain('private-token')
    expect(fetcher.mock.calls.filter(([url]) => url === `${endpoint}/login`)).toHaveLength(1)
  })
  it('still lets the user correct ordinary rejected credentials', async () => {
    await render(async () => Response.json({ error: 'Incorrect credentials' }, { status: 401 }))
    await submit()
    await vi.waitFor(() => expect(container.textContent).toContain('Incorrect credentials'))
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  })
  it('still navigates after a successful login and refreshed session', async () => {
    const fetcher = await render(async () => Response.json({ ok: true }), true)
    await submit()
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Signed in'))
    expect(fetcher.mock.calls.filter(([url]) => url === `${endpoint}/login`)).toHaveLength(1)
  })
})
