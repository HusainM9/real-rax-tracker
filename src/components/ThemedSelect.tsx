import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type ThemedSelectOption = {
  value: string
  label: string
}

export type ThemedSelectProps = {
  /** Optional visible label above the control. */
  label?: string
  value: string
  options: ThemedSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  menuTitle?: string
  ariaLabel?: string
}

export function ThemedSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  menuTitle,
  ariaLabel,
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )
  const triggerLabel = selected?.label ?? 'Select…'

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div
      className={`themed-select${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      ref={rootRef}
    >
      {label ? <span className="themed-select-label">{label}</span> : null}
      <button
        type="button"
        className="themed-select-trigger"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel ?? label ?? 'Select option'}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="themed-select-value">{triggerLabel}</span>
        <span className="themed-select-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="themed-select-menu"
          id={listboxId}
          role="listbox"
          aria-label={menuTitle ?? label ?? 'Options'}
        >
          {menuTitle ? <div className="themed-select-menu-title">{menuTitle}</div> : null}
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                type="button"
                key={option.value}
                className={`themed-select-option${isSelected ? ' is-selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="themed-select-check" aria-hidden="true">
                  {isSelected ? '✓' : ''}
                </span>
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
