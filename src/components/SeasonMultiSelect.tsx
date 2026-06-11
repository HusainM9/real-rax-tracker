import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type SeasonOption = {
  value: string
  label: string
}

export type SeasonMultiSelectProps = {
  options: SeasonOption[]
  excludedValues: string[]
  onExcludedValuesChange: (excludedValues: string[]) => void
  disabled?: boolean
  label?: string
}

function seasonTriggerLabel(options: SeasonOption[], excludedValues: string[]): string {
  if (options.length === 0) return 'Seasons'
  const included = options.filter((option) => !excludedValues.includes(option.value))
  if (included.length === 0) return 'No seasons'
  if (included.length === options.length) return 'All seasons'
  if (included.length <= 3) return included.map((option) => option.label).join(', ')
  return `${included.length} seasons`
}

export function SeasonMultiSelect({
  options,
  excludedValues,
  onExcludedValuesChange,
  disabled = false,
  label = 'Seasons',
}: SeasonMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const triggerLabel = useMemo(
    () => seasonTriggerLabel(options, excludedValues),
    [options, excludedValues],
  )
  const allIncluded = options.length > 0 && excludedValues.length === 0

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

  const toggleAllSeasons = () => {
    onExcludedValuesChange([])
  }

  const toggleSeason = (value: string) => {
    if (excludedValues.includes(value)) {
      onExcludedValuesChange(excludedValues.filter((item) => item !== value))
      return
    }
    onExcludedValuesChange([...excludedValues, value])
  }

  return (
    <div className={`season-multi-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <span className="field-label">{label}</span>
      <button
        type="button"
        className="season-multi-select-trigger"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{triggerLabel}</span>
        <span className="season-multi-select-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="season-multi-select-menu" id={listboxId} role="listbox" aria-label={label}>
          <div className="season-multi-select-menu-title">Season labels</div>
          <button
            type="button"
            className={`season-multi-select-option${allIncluded ? ' is-selected' : ''}`}
            role="option"
            aria-selected={allIncluded}
            onClick={toggleAllSeasons}
          >
            <span className="season-multi-select-check" aria-hidden="true">
              {allIncluded ? '✓' : ''}
            </span>
            <span>All seasons</span>
          </button>
          {options.map((option) => {
            const included = !excludedValues.includes(option.value)
            return (
              <button
                type="button"
                key={option.value}
                className={`season-multi-select-option${included ? ' is-selected' : ''}`}
                role="option"
                aria-selected={included}
                onClick={() => toggleSeason(option.value)}
              >
                <span className="season-multi-select-check" aria-hidden="true">
                  {included ? '✓' : ''}
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
