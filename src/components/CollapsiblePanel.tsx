import { useState, type ReactNode } from 'react'

type CollapsiblePanelProps = {
  id?: string
  title: ReactNode
  description?: string
  badge?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  actions?: ReactNode
  className?: string
  children: ReactNode
}

export default function CollapsiblePanel({
  id,
  title,
  description,
  badge,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  actions,
  className = '',
  children,
}: CollapsiblePanelProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = controlledOpen ?? internalOpen

  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(open) : next
    if (controlledOpen === undefined) {
      setInternalOpen(resolved)
    }
    onOpenChange?.(resolved)
  }

  return (
    <section
      id={id}
      className={`panel collapsible-panel${open ? ' is-open' : ''} ${className}`.trim()}
    >
      <div className="collapsible-header">
        <button
          type="button"
          className="collapsible-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="collapsible-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="collapsible-heading-text">
            <span className="collapsible-title">{title}</span>
            {description ? <span className="collapsible-description">{description}</span> : null}
          </span>
        </button>
        {actions ? <div className="section-actions">{actions}</div> : null}
        {badge ? <span className="badge">{badge}</span> : null}
      </div>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </section>
  )
}
