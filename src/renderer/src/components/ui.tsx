import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { band, fmtPct } from '../lib/format'
import type { ModuleColour } from '../../../shared/types'
import { Icon, type IconName } from './Icon'

// ---------------------------------------------------------------------------
// Dialog (native <dialog>: focus is trapped and Escape closes it)

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  labelledBy
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  labelledBy?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog-wide' : 'dialog'}
      aria-labelledby={labelledBy ?? id}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open ? (
        <div className="dialog-inner">
          <header className="dialog-head">
            <h2 id={id}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer ? <footer className="dialog-foot">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  )
}

// ---------------------------------------------------------------------------
// Toasts

type Toast = { id: number; text: string; tone: 'info' | 'good' | 'bad' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 7000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === 'good' ? <Icon name="check" size={16} /> : t.tone === 'bad' ? <Icon name="warning" size={16} /> : null}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = (): ((text: string, tone?: Toast['tone']) => void) => useContext(ToastCtx)

// ---------------------------------------------------------------------------
// Small display pieces

export function Swatch({ colour, size = 10 }: { colour: ModuleColour; size?: number }) {
  return <span className="swatch" style={{ width: size, height: size, background: `var(--mod-${colour})` }} aria-hidden="true" />
}

export function Score({ value, digits = 0 }: { value: number | null; digits?: number }) {
  return <span className={`num score score-${band(value)}`}>{fmtPct(value, digits)}</span>
}

export function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className="num faint">—</span>
  const dir = value > 0.5 ? 'up' : value < -0.5 ? 'down' : 'flat'
  const label = dir === 'up' ? `up ${value.toFixed(0)} points` : dir === 'down' ? `down ${Math.abs(value).toFixed(0)} points` : 'no change'
  return (
    <span className={`num trend trend-${dir}`} title={label}>
      <span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'}</span>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{dir === 'flat' ? '0' : Math.abs(value).toFixed(0)}</span>
    </span>
  )
}

export function Empty({
  title,
  children,
  action,
  mark = 'grid'
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
  mark?: IconName
}) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        <Icon name={mark} size={20} />
      </div>
      <div className="empty-text">
        <p className="empty-title">{title}</p>
        {children ? <p className="empty-body">{children}</p> : null}
      </div>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value)
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              onChange(options[(i + 1) % options.length].value)
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              onChange(options[(i - 1 + options.length) % options.length].value)
            }
          }}
          tabIndex={value === o.value ? 0 : -1}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  htmlFor
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  id
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
  id?: string
}) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <label className="toggle" htmlFor={inputId}>
      <input id={inputId} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description ? <span className="toggle-desc">{description}</span> : null}
      </span>
    </label>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="loading-bar" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="error-note" role="alert">
      <Icon name="warning" size={18} />
      <div>{children}</div>
    </div>
  )
}

/** Wraps an async loader with loading / error state and a reload function. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): {
  data: T | null
  error: string | null
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    load()
      .then((d) => {
        if (live) {
          setData(d)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message.replace(/^.*::/, '') : String(e))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { data, error, reload: () => setN((x) => x + 1) }
}
