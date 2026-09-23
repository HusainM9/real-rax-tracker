import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import StorageWarningBanner from './StorageWarningBanner'
import { useAccountAuth } from '../context/AccountAuthContext'
import { useAuth } from '../context/AuthContext'

const MOBILE_NAV_QUERY = '(max-width: 1024px)'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/entry', label: 'Entry' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/otd', label: 'OTD' },
  { to: '/overlaps', label: 'Overlaps' },
  { to: '/potential', label: 'Potential' },
  { to: '/plan', label: 'Plan' },
  { to: '/packs', label: 'Packs' },
  { to: '/cards', label: 'Cards' },
  { to: '/sell', label: 'If sold' },
]

function ProfileIcon() {
  return (
    <svg
      className="nav-profile-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="8" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M5.5 19.25c1.6-3.1 3.9-4.6 6.5-4.6s4.9 1.5 6.5 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

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

          <div className="header-end">
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

            <NavLink
              to="/profile"
              className={({ isActive }) => `nav-profile-link${isActive ? ' active' : ''}`}
              aria-label="Profile"
              title="Profile"
              onClick={() => setMenuOpen(false)}
            >
              <ProfileIcon />
            </NavLink>
          </div>
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

      <StorageWarningBanner />

      <main className="page-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>
          {accountDevBypass ? (
            <>
              Local browser data (not signed into a cloud account).
            </>
          ) : username ? (
            <>
              Signed in as{' '}
              <NavLink className="footer-profile-link" to="/profile">
                @{username}
              </NavLink>
              . Collection saves to your account.
            </>
          ) : (
            <>Collection saves to your account.</>
          )}{' '}
          Not affiliated with Real Sports.
        </p>
        <div className="footer-actions">
          <NavLink className="footer-help-link" to="/help">
            Help
          </NavLink>
          <button
            className="button auth-sign-out"
            type="button"
            onClick={() => void signOutAccount()}
          >
            {accountDevBypass ? 'Sign in to account' : 'Switch account'}
          </button>
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
