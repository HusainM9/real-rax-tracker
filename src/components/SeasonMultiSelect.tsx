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
  menuTitle?: string
  allOptionLabel?: string
  emptyTriggerLabel?: string
  countUnit?: string
}

function seasonTriggerLabel(
  options: SeasonOption[],
  excludedValues: string[],
  emptyTriggerLabel: string,
  allOptionLabel: string,
  countUnit: string,
): string {
  if (options.length === 0) return allOptionLabel.replace(/^All /, '')
  const included = options.filter((option) => !excludedValues.includes(option.value))
  if (included.length === 0) return emptyTriggerLabel
  if (included.length === options.length) return allOptionLabel
  if (included.length <= 3) return included.map((option) => option.label).join(', ')
  return `${included.length} ${countUnit}`
}

export function SeasonMultiSelect({
  options,
  excludedValues,
  onExcludedValuesChange,
  disabled = false,
  label = 'Seasons',
  menuTitle = 'Season labels',
  allOptionLabel = 'All seasons',
  emptyTriggerLabel = 'No seasons',
  countUnit = 'seasons',
}: SeasonMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const triggerLabel = useMemo(
    () =>
      seasonTriggerLabel(
        options,
        excludedValues,
        emptyTriggerLabel,
        allOptionLabel,
        countUnit,
      ),
    [allOptionLabel, countUnit, emptyTriggerLabel, options, excludedValues],
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
    <div className={`themed-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <span className="themed-select-label">{label}</span>
      <button
        type="button"
        className="themed-select-trigger"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="themed-select-value">{triggerLabel}</span>
        <span className="themed-select-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="themed-select-menu" id={listboxId} role="listbox" aria-label={label}>
          <div className="themed-select-menu-title">{menuTitle}</div>
          <button
            type="button"
            className={`themed-select-option${allIncluded ? ' is-selected' : ''}`}
            role="option"
            aria-selected={allIncluded}
            onClick={toggleAllSeasons}
          >
            <span className="themed-select-check" aria-hidden="true">
              {allIncluded ? '✓' : ''}
            </span>
            <span>{allOptionLabel}</span>
          </button>
          {options.map((option) => {
            const included = !excludedValues.includes(option.value)
            return (
              <button
                type="button"
                key={option.value}
                className={`themed-select-option${included ? ' is-selected' : ''}`}
                role="option"
                aria-selected={included}
                onClick={() => toggleSeason(option.value)}
              >
                <span className="themed-select-check" aria-hidden="true">
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
