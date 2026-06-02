import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'

export default function AdminLoginPage() {
  const { status, login } = useAdminAuth()
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const nextPath = searchParams.get('next') || '/admin'

  if (status === 'loading') {
    return (
      <div className="auth-page">
        <p className="auth-status">Checking admin session…</p>
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
        <p className="eyebrow">Operator access</p>
        <h1>Admin</h1>
        <p className="auth-lead">Enter the admin password to view import logs and user activity.</p>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Admin password</span>
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
            {submitting ? 'Signing in…' : 'Open admin'}
          </button>
        </form>

        <p className="import-hint">
          <Link to="/">Back to tracker</Link>
        </p>
      </section>
    </div>
  )
}
