import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

type Status = 'loading' | 'locked' | 'authenticated'

type ProtectedFeature = 'earnings' | 'marketplace'

const FEATURE_COPY: Record<ProtectedFeature, {
  eyebrow: string
  previewTitle: string
  previewDescription: string
  dialogTitle: string
  dialogDescription: string
  buttonLabel: string
}> = {
  earnings: {
    eyebrow: 'Earnings report',
    previewTitle: 'Daily player-card earnings',
    previewDescription: 'Unlock this private report to view linked-account earnings and statistics.',
    dialogTitle: 'Unlock Earnings',
    dialogDescription: 'Enter the private access password to view linked-account reports.',
    buttonLabel: 'Open Earnings',
  },
  marketplace: {
    eyebrow: 'Marketplace alerts',
    previewTitle: 'Private listing monitor',
    previewDescription: 'Unlock this private tool to manage filters, scans, and listing alerts.',
    dialogTitle: 'Unlock Marketplace',
    dialogDescription: 'Enter the private access password to manage marketplace alerts.',
    buttonLabel: 'Open Marketplace',
  },
}

export default function RequireEarnings({
  children,
  feature = 'earnings',
}: {
  children: ReactNode
  feature?: ProtectedFeature
}) {
  const copy = FEATURE_COPY[feature]
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
        setError(data?.error || `Could not unlock ${copy.dialogTitle.replace('Unlock ', '')}.`)
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
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.previewTitle}</h1>
        <p>{copy.previewDescription}</p>
      </section>
      <div className="app-modal-backdrop earnings-access-backdrop">
        <section
          className="panel earnings-access-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="earnings-access-title"
        >
          <p className="eyebrow">Private access required</p>
          <h1 id="earnings-access-title">{copy.dialogTitle}</h1>
          <p className="auth-lead">{copy.dialogDescription}</p>
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
                {submitting ? 'Unlocking…' : copy.buttonLabel}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  )
}
