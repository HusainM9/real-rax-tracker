import { useEffect, type ReactNode } from 'react'

type ConfirmDialogProps = {
  title: string
  titleId: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  confirmClassName?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  titleId,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmClassName = 'button primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  return (
    <div
      className="app-modal-backdrop"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="panel confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="confirm-dialog-title">
          {title}
        </h2>
        <div className="confirm-dialog-body">{children}</div>
        <div className="button-row confirm-dialog-actions">
          <button className="button" type="button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={confirmClassName}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
