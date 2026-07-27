import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type ChecklistOption = {
  value: string
  label: string
}

export type ChecklistMultiSelectProps = {
  options: ChecklistOption[]
  /** Empty means “all” (no filter). Non-empty means only these values. */
  selectedValues: string[]
  onSelectedValuesChange: (selectedValues: string[]) => void
  disabled?: boolean
  label?: string
  menuTitle?: string
  allOptionLabel?: string
  emptyTriggerLabel?: string
  countUnit?: string
}

function checklistTriggerLabel(
  options: ChecklistOption[],
  selectedValues: string[],
  emptyTriggerLabel: string,
  allOptionLabel: string,
  countUnit: string,
): string {
  if (options.length === 0) return allOptionLabel.replace(/^All /, '')
  if (selectedValues.length === 0) return allOptionLabel
  const selected = options.filter((option) => selectedValues.includes(option.value))
  if (selected.length === 0) return emptyTriggerLabel
  if (selected.length === options.length) return allOptionLabel
  if (selected.length <= 3) return selected.map((option) => option.label).join(', ')
  return `${selected.length} ${countUnit}`
}

export function ChecklistMultiSelect({
  options,
  selectedValues,
  onSelectedValuesChange,
  disabled = false,
  label = 'Filter',
  menuTitle = 'Options',
  allOptionLabel = 'All',
  emptyTriggerLabel = 'None',
  countUnit = 'selected',
}: ChecklistMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const triggerLabel = useMemo(
    () =>
      checklistTriggerLabel(
        options,
        selectedValues,
        emptyTriggerLabel,
        allOptionLabel,
        countUnit,
      ),
    [allOptionLabel, countUnit, emptyTriggerLabel, options, selectedValues],
  )
  const allSelected = selectedValues.length === 0 || selectedValues.length === options.length

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

  const selectAll = () => {
    onSelectedValuesChange([])
  }

  const toggleValue = (value: string) => {
    if (selectedValues.length === 0) {
      // Was “all” — narrow to everything except this value toggled off… better: select only this.
      // From all → clicking one option selects only that option.
      onSelectedValuesChange([value])
      return
    }

    if (selectedValues.includes(value)) {
      const next = selectedValues.filter((item) => item !== value)
      onSelectedValuesChange(next.length === options.length ? [] : next)
      return
    }

    const next = [...selectedValues, value]
    onSelectedValuesChange(next.length >= options.length ? [] : next)
  }

  const optionSelected = (value: string) =>
    selectedValues.length === 0 || selectedValues.includes(value)

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
          <div className="season-multi-select-menu-title">{menuTitle}</div>
          <button
            type="button"
            className={`season-multi-select-option${allSelected ? ' is-selected' : ''}`}
            role="option"
            aria-selected={allSelected}
            onClick={selectAll}
          >
            <span className="season-multi-select-check" aria-hidden="true">
              {allSelected ? '✓' : ''}
            </span>
            <span>{allOptionLabel}</span>
          </button>
          {options.map((option) => {
            const selected = optionSelected(option.value)
            return (
              <button
                type="button"
                key={option.value}
                className={`season-multi-select-option${selected ? ' is-selected' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => toggleValue(option.value)}
              >
                <span className="season-multi-select-check" aria-hidden="true">
                  {selected ? '✓' : ''}
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
