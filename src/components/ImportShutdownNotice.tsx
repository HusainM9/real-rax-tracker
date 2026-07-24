import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  realProviderImportEnabled,
  realappToolsShutdownLabel,
  usernameImportDisabled,
} from '../lib/importShutdown'

const DISMISS_KEY = 'real-rax-tracker:import-shutdown-dismissed'

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'true'
  } catch {
    return false
  }
}

function dismissNotice(): void {
  try {
    localStorage.setItem(DISMISS_KEY, 'true')
  } catch {
    // Ignore private-mode storage failures.
  }
}

export default function ImportShutdownNotice() {
  const [visible, setVisible] = useState(() => !isDismissed())
  if (!visible) return null

  // Real username import is live — no shutdown banner needed.
  if (realProviderImportEnabled()) return null

  const closed = usernameImportDisabled()

  return (
    <section className="shutdown-notice" aria-label="Username import notice">
      <div>
        <p className="eyebrow">{closed ? 'Username import closed' : 'Username import ending'}</p>
        <h2>{closed ? 'Automatic username import is closed' : 'Username import ending soon'}</h2>
        <p>
          {closed
            ? `Automatic import stopped after ${realappToolsShutdownLabel()}. Cards already in this browser stay saved.`
            : `Automatic import stops after ${realappToolsShutdownLabel()}. Cards already in this browser stay saved.`}{' '}
          Use catalog quick add, Manual add on Entry, or restore a backup.
        </p>
      </div>
      <div className="button-row shutdown-notice-actions">
        <Link className="button primary" to="/entry">
          Open Entry
        </Link>
        <Link className="button" to="/help">
          Help
        </Link>
        <button
          className="button"
          type="button"
          onClick={() => {
            dismissNotice()
            setVisible(false)
          }}
        >
          Dismiss
        </button>
      </div>
    </section>
  )
}
