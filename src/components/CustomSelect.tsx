import { useEffect, useMemo, useRef, useState } from 'react'

type SelectOption = {
  label: string
  value: string
  description?: string
}

type CustomSelectProps = {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  buttonClassName?: string
  menuClassName?: string
  disabled?: boolean
}

export default function CustomSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  className = '',
  buttonClassName = '',
  menuClassName = '',
  disabled = false,
}: CustomSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown, { passive: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleToggle = () => {
    if (disabled) return
    setOpen((prev) => !prev)
  }

  return (
    <div
      ref={rootRef}
      className={`custom-select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        className={`custom-select-trigger ${buttonClassName}`.trim()}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className={`custom-select-value ${selectedOption ? '' : 'placeholder'}`.trim()}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span className="custom-select-chevron" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="16" height="16">
            <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className={`custom-select-menu ${menuClassName}`.trim()} role="listbox">
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`custom-select-option ${selected ? 'selected' : ''}`.trim()}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="custom-select-option-main">{option.label}</span>
                {option.description ? (
                  <span className="custom-select-option-desc">{option.description}</span>
                ) : null}
                {selected ? <span className="custom-select-check">✓</span> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
