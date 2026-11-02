import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'

export function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="group">
      {title && <h3 className="group-title">{title}</h3>}
      <div className="group-card">{children}</div>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  )
}

export function Row({
  title,
  subtitle,
  children,
  below,
  disabled
}: {
  title: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
  /** Put the control under the label instead of beside it. */
  below?: boolean
  disabled?: boolean
}) {
  return (
    <div className={`row${below ? ' row-below' : ''}${disabled ? ' row-disabled' : ''}`}>
      <div className="row-text">
        <div className="row-title">{title}</div>
        {subtitle && <div className="row-sub">{subtitle}</div>}
      </div>
      {children !== undefined && <div className="row-control">{children}</div>}
    </div>
  )
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange(v: T): void
  disabled?: boolean
  label?: string
}) {
  return (
    <select
      className="select"
      aria-label={label}
      disabled={disabled}
      value={String(value)}
      onChange={(e) => {
        const picked = options.find((o) => String(o.value) === e.target.value)
        if (picked) onChange(picked.value)
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Button({
  children,
  onClick,
  kind = 'default',
  disabled,
  style
}: {
  children: ReactNode
  onClick(): void
  kind?: 'default' | 'primary' | 'danger'
  disabled?: boolean
  style?: CSSProperties
}) {
  return (
    <button type="button" className={`btn btn-${kind}`} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  )
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
  width,
  onCommit,
  disabled,
  label
}: {
  value: string
  onChange(v: string): void
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  width?: number
  onCommit?(): void
  disabled?: boolean
  label?: string
}) {
  return (
    <input
      className="field"
      aria-label={label}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      style={{ width }}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit?.()
      }}
    />
  )
}

/** A masked field with an eye button, as the key field of an API account. */
export function SecretField({
  value,
  onChange,
  placeholder,
  showLabel,
  hideLabel,
  onCommit
}: {
  value: string
  onChange(v: string): void
  placeholder: string
  showLabel: string
  hideLabel: string
  onCommit(): void
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="secret">
      <TextField value={value} onChange={onChange} placeholder={placeholder} type={shown ? 'text' : 'password'} width={220} onCommit={onCommit} />
      <button type="button" className="btn btn-ghost" onClick={() => setShown(!shown)} aria-label={shown ? hideLabel : showLabel}>
        {shown ? hideLabel : showLabel}
      </button>
    </div>
  )
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return <div className={`banner banner-${tone}`}>{children}</div>
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'good' | 'muted' }) {
  return <span className={`pill${tone ? ` pill-${tone}` : ''}`}>{children}</span>
}
