import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

type Status = 'loading' | 'locked' | 'authenticated'

export default function RequireEarnings({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/earnings/session', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return false
        const data = (await response.json()) as { ok?: boolean }
        return Boolean(data.ok)
      })
      .then((ok) => setStatus(ok ? 'authenticated' : 'locked'))
      .catch((sessionError) => {
        if (!(sessionError instanceof DOMException && sessionError.name === 'AbortError')) {
          setStatus('locked')
        }
      })
    return () => controller.abort()
  }, [])

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

  if (status === 'authenticated') return children

  return (
    <div className="earnings-lock-shell">
      <section className="earnings-lock-preview" aria-hidden="true">
        <p className="eyebrow">Earnings report</p>
        <h1>Daily player-card earnings</h1>
        <p>Unlock this private report to view linked-account earnings and statistics.</p>
      </section>
      <div className="app-modal-backdrop earnings-access-backdrop">
        <section
          className="panel earnings-access-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="earnings-access-title"
        >
          <p className="eyebrow">Earnings access required</p>
          <h1 id="earnings-access-title">Unlock Earnings</h1>
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
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button className="button primary auth-submit" type="submit" disabled={submitting || !password}>
                {submitting ? 'Unlocking…' : 'Open Earnings'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  )
}
