const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

export const fmtDate = (iso: string | null): string => (iso ? dateFmt.format(new Date(iso)) : '—')
export const fmtShortDate = (iso: string | null): string => (iso ? shortDateFmt.format(new Date(iso)) : '—')
export const fmtTime = (iso: string | null): string => (iso ? timeFmt.format(new Date(iso)) : '—')
export const fmtDateTime = (iso: string | null): string => (iso ? dateTimeFmt.format(new Date(iso)) : '—')

/** "Today", "Yesterday", "3 days ago", or a date. */
export function fmtRelative(iso: string | null, now = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (d.getFullYear() === now.getFullYear()) return shortDateFmt.format(d)
  return dateFmt.format(d)
}

/** 75 → "1m 15s", 3700 → "1h 1m" */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/** 75 → "01:15" */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—'
  return `${n.toFixed(digits)}%`
}

export function fmtMarks(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat().format(n)
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function signed(n: number, digits = 0): string {
  const v = n.toFixed(digits)
  return n > 0 ? `+${v}` : n < 0 ? `−${v.replace('-', '')}` : '±0'
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${fmtNumber(n)} ${n === 1 ? one : many}`

/** Performance band used for colour meaning. */
export function band(pct: number | null): 'good' | 'mid' | 'low' | 'none' {
  if (pct === null) return 'none'
  if (pct >= 70) return 'good'
  if (pct >= 50) return 'mid'
  return 'low'
}
