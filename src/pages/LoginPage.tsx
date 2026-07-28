import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { status, login } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const nextPath =
    searchParams.get('next') ||
    (location.state as { from?: string } | null)?.from ||
    '/account'

  if (status === 'loading') {
    return (
      <div className="auth-page">
        <p className="auth-status">Checking session…</p>
      </div>
    )
  }

  if (status === 'authenticated') {
    return <Navigate to={nextPath} replace />
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    const message = await login(password)
    if (message) {
      setError(message)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
  }

  return (
    <div className="auth-page">
      <section className="auth-card panel">
        <p className="eyebrow">Private access</p>
        <h1>RAX OTD Tracker</h1>
        <p className="auth-lead">Enter the shared site password to continue.</p>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              autoFocus
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="button primary auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  )
}
