import { useEffect, useState } from 'react'

import type { FilterControlDefinition } from './engine'

interface ParameterControlProps {
  control: FilterControlDefinition
  value: number
  onChange: (value: number) => void
}

function normalizeParameterValue(value: number, control: FilterControlDefinition): number {
  const clamped = Math.min(control.max, Math.max(control.min, value))
  const stepsFromMinimum = Math.round((clamped - control.min) / control.step)
  const snapped = control.min + stepsFromMinimum * control.step
  const precision = String(control.step).split('.')[1]?.length ?? 0
  return Number(Math.min(control.max, Math.max(control.min, snapped)).toFixed(precision))
}

export function ParameterControl({ control, value, onChange }: ParameterControlProps) {
  const [draft, setDraft] = useState(String(value))
  const inputId = `parameter-${control.key}`

  useEffect(() => {
    setDraft(String(value))
  }, [control.key, value])

  const commitDraft = () => {
    const parsed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }

    const normalized = normalizeParameterValue(parsed, control)
    setDraft(String(normalized))
    if (normalized !== value) onChange(normalized)
  }

  return (
    <div className="parameter-control">
      <div className="parameter-control-header">
        <label htmlFor={`${inputId}-slider`}>{control.label}</label>
        <div className="parameter-value">
          <label className="visually-hidden" htmlFor={`${inputId}-number`}>
            Exact {control.label.toLowerCase()} value
          </label>
          <input
            id={`${inputId}-number`}
            type="number"
            min={control.min}
            max={control.max}
            step={control.step}
            value={draft}
            onChange={(event) => {
              const nextDraft = event.currentTarget.value
              setDraft(nextDraft)
              if (nextDraft.trim() === '' || !Number.isFinite(event.currentTarget.valueAsNumber)) return
              const normalized = normalizeParameterValue(event.currentTarget.valueAsNumber, control)
              if (normalized !== event.currentTarget.valueAsNumber) setDraft(String(normalized))
              if (normalized !== value) onChange(normalized)
            }}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                setDraft(String(value))
                event.currentTarget.blur()
              }
            }}
          />
          {control.unit && <span aria-hidden="true">{control.unit.trim()}</span>}
        </div>
      </div>
      <input
        id={`${inputId}-slider`}
        className="parameter-slider"
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        onChange={(event) => onChange(normalizeParameterValue(Number(event.currentTarget.value), control))}
      />
      <div className="range-limits" aria-hidden="true">
        <span>{control.min}</span>
        <span>{control.max}</span>
      </div>
    </div>
  )
}
