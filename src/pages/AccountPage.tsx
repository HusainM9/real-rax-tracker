import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { ACCOUNT_PASSWORD_HELP } from '../../lib/accountPasswordRules'
import { useAccountAuth } from '../context/AccountAuthContext'

type Mode = 'login' | 'register'

export default function AccountPage() {
  const { status, login, register, continueWithLocalData } = useAccountAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isDev = import.meta.env.DEV

  const nextPath =
    searchParams.get('next') ||
    (location.state as { from?: string } | null)?.from ||
    '/'

  if (status === 'loading') {
    return (
      <div className="auth-page">
        <p className="auth-status">Checking account…</p>
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

    const message =
      mode === 'login' ? await login(username, password) : await register(username, password)
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
        <p className="eyebrow">Your account</p>
        <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
        <p className="auth-lead">
          {mode === 'login'
            ? 'Sign in with your Real @username and password. Your collection stays linked to this account.'
            : 'Use your Real @username as the account name so tracking and imports stay aligned.'}
        </p>
        {isDev ? (
          <p className="auth-hint">
            Localhost: signing in loads that account’s cloud collection (needs KV + AUTH_SESSION_SECRET
            in <code>.env.local</code>, same as Vercel). Or continue with this browser’s local data.
          </p>
        ) : null}

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Real @username</span>
            <input
              type="text"
              value={username}
              autoComplete="username"
              autoFocus
              disabled={submitting}
              placeholder="@yourname"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mode === 'register' ? <p className="auth-hint">{ACCOUNT_PASSWORD_HELP}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="button primary auth-submit" type="submit" disabled={submitting}>
            {submitting
              ? mode === 'login'
                ? 'Signing in…'
                : 'Creating…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        {isDev ? (
          <p className="auth-switch">
            <button
              type="button"
              className="linkish"
              disabled={submitting}
              onClick={() => continueWithLocalData()}
            >
              Continue with local browser data
            </button>
          </p>
        ) : null}

        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <button type="button" className="linkish" onClick={() => setMode('register')}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="linkish" onClick={() => setMode('login')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </section>
    </div>
  )
}
