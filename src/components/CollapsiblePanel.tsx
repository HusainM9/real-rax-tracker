import { useState, type ReactNode } from 'react'

type CollapsiblePanelProps = {
  id?: string
  title: string
  description?: string
  badge?: string
  defaultOpen?: boolean
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
  actions,
  className = '',
  children,
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen)

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
