import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

type Status = 'loading' | 'locked' | 'authenticated'

export default function EarningsAccessPage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<Status>(import.meta.env.DEV ? 'authenticated' : 'loading')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const requestedNext = searchParams.get('next')
  const nextPath = requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/earnings'

  useEffect(() => {
    if (import.meta.env.DEV) return
    void fetch('/api/earnings/session', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return false
        const data = (await response.json()) as { ok?: boolean }
        return Boolean(data.ok)
      })
      .then((ok) => setStatus(ok ? 'authenticated' : 'locked'))
      .catch(() => setStatus('locked'))
  }, [])

  if (status === 'authenticated') return <Navigate to={nextPath} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/earnings/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(data?.error || 'Could not unlock Earnings.')
        return
      }
      setStatus('authenticated')
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page earnings-access-page">
      <section className="auth-card panel">
        <p className="eyebrow">Earnings access</p>
        <h1>Daily RAX reports</h1>
        <p className="auth-lead">Enter the Earnings password to view linked-account reports.</p>
        {status === 'loading' ? (
          <p className="auth-status">Checking access…</p>
        ) : (
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
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
              {submitting ? 'Unlocking…' : 'Open Earnings'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
