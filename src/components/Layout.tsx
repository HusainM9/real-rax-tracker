import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import ImportShutdownNotice from './ImportShutdownNotice'
import StorageWarningBanner from './StorageWarningBanner'
import { useAccountAuth } from '../context/AccountAuthContext'
import { useAuth } from '../context/AuthContext'

const MOBILE_NAV_QUERY = '(max-width: 1024px)'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/entry', label: 'Entry' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/overlaps', label: 'Overlaps' },
  { to: '/potential', label: 'Potential' },
  { to: '/plan', label: 'Plan' },
  { to: '/packs', label: 'Packs' },
  { to: '/cards', label: 'Cards' },
  { to: '/sell', label: 'If sold' },
  { to: '/help', label: 'Help' },
]

export default function Layout() {
  const { logout: siteLogout, devBypass } = useAuth()
  const { username, logout: accountLogout, devBypass: accountDevBypass } = useAccountAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  const signOut = async () => {
    await accountLogout()
    await siteLogout()
    navigate('/login', { replace: true })
  }

  const signOutAccount = async () => {
    await accountLogout()
    navigate('/account', { replace: true })
  }

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAV_QUERY)
    const syncMenu = () => {
      if (!media.matches) setMenuOpen(false)
    }
    syncMenu()
    media.addEventListener('change', syncMenu)
    return () => media.removeEventListener('change', syncMenu)
  }, [])

  useEffect(() => {
    if (!menuOpen) {
      document.body.style.overflow = ''
      return
    }

    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <div className="app-shell">
      <header className={`site-header${menuOpen ? ' menu-open' : ''}`}>
        <div className="site-header-inner">
          <NavLink className="brand" to="/" end onClick={() => setMenuOpen(false)}>
            RAX OTD Tracker
          </NavLink>

          <button
            type="button"
            className="nav-menu-button"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="nav-menu-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="nav-menu-label">{menuOpen ? 'Close' : 'Menu'}</span>
          </button>

          <nav
            id="main-nav"
            className={`main-nav${menuOpen ? ' open' : ''}`}
            aria-label="Main navigation"
          >
            <ul className="nav-list">
              {links.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      {menuOpen ? (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <ImportShutdownNotice />
      <StorageWarningBanner />

      <main className="page-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>
          {username ? (
            <>
              Signed in as <strong>@{username}</strong>. Collection saves to your account.
            </>
          ) : (
            <>Collection saves to your account.</>
          )}{' '}
          Not affiliated with Real Sports or Meowbot.
        </p>
        <div className="footer-actions">
          {!accountDevBypass ? (
            <button
              className="button auth-sign-out"
              type="button"
              onClick={() => void signOutAccount()}
            >
              Switch account
            </button>
          ) : null}
          {!devBypass ? (
            <button className="button auth-sign-out" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  )
}
