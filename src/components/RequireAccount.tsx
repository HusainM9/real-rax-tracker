import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAccountAuth } from '../context/AccountAuthContext'

export default function RequireAccount() {
  const { status } = useAccountAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="auth-page">
        <p className="auth-status">Loading account…</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/account" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
