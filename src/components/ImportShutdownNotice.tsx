import { useState } from 'react'
import { Link } from 'react-router-dom'
import { realappToolsShutdownLabel, usernameImportDisabled } from '../lib/importShutdown'

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

  const closed = usernameImportDisabled()

  return (
    <section className="shutdown-notice" aria-label="Username import shutdown notice">
      <div>
        <p className="eyebrow">{closed ? 'Username import closed' : 'Username import ending'}</p>
        <h2>realapp.tools / Meowbot import is shutting down</h2>
        <p>
          Automatic username import {closed ? 'has stopped' : `will stop after ${realappToolsShutdownLabel()}`}.
          Cards and earnings already imported into this browser stay saved locally and are included
          in JSON backups. While imports still work, the tracker may cache pass metadata and player
          earnings to make future manual Entry and Potential checks faster.
        </p>
        <p>
          After shutdown, add new cards through <strong>Add card &amp; earnings</strong>, paste
          realapp.com earnings JSON, or restore from an exported backup.
        </p>
      </div>
      <div className="button-row shutdown-notice-actions">
        <Link className="button primary" to="/entry">
          Open Entry
        </Link>
        <Link className="button" to="/help">
          Read guide
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
