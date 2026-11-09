import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { fmtDuration } from '../lib/format'

// ---------------------------------------------------------------------------
// Motion helpers. Every animation here is a CSS animation, so the global
// prefers-reduced-motion rule in base.css switches them all off.

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Count from 0 to `value` over `ms`, easing out. */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(() => (reduced() ? value : 0))
  const from = useRef(0)
  useEffect(() => {
    if (reduced()) {
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number): void => {
      const p = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      setShown(a + (value - a) * e)
      if (p < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const n = useCountUp(value)
  return <>{format(n)}</>
}

function useWidth(min = 260): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return [ref, w]
}

const vars = (o: Record<string, string | number>): CSSProperties => o as CSSProperties

// ---------------------------------------------------------------------------
// Shared tooltip

interface TipState {
  x: number
  y: number
  content: ReactNode
}

function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vertical bars (weekly scores, distributions, per-question time)

export interface Bar {
  key: string
  value: number | null
  label: string
  /** Short axis label; empty to hide. */
  tick?: string
  tone?: 'ink' | 'accent' | 'good' | 'bad' | 'muted'
  tip: ReactNode
}

export function Bars({
  bars,
  height = 220,
  max,
  label,
  valueFormat = (n) => String(Math.round(n)),
  reference
}: {
  bars: Bar[]
  height?: number
  max?: number
  label: string
  valueFormat?: (n: number) => string
  reference?: { value: number; label: string }
}) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState<TipState | null>(null)
  const pad = { top: 22, bottom: 26, left: 4, right: 4 }
  const innerH = height - pad.top - pad.bottom
  const top = max ?? Math.max(1, ...bars.map((b) => b.value ?? 0), reference?.value ?? 0)
  const slot = (width - pad.left - pad.right) / Math.max(1, bars.length)
  const bw = Math.max(3, Math.min(48, slot - Math.max(2, slot * 0.28)))
  const y = (v: number): number => pad.top + innerH - (v / top) * innerH
  const showValues = bars.length <= 14
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label} onPointerLeave={() => setTip(null)}>
        <line x1={0} x2={width} y1={pad.top + innerH} y2={pad.top + innerH} className="chart-axis" />
        {reference ? (
          <g>
            <line x1={0} x2={width} y1={y(reference.value)} y2={y(reference.value)} className="chart-ref" />
            <text x={width - 2} y={y(reference.value) - 5} textAnchor="end" className="chart-tick">
              {reference.label}
            </text>
          </g>
        ) : null}
        {bars.map((b, i) => {
          const cx = pad.left + slot * i + slot / 2
          const v = b.value ?? 0
          const h = Math.max(b.value === null ? 0 : 2, (v / top) * innerH)
          return (
            <g
              key={b.key}
              onPointerEnter={() => setTip({ x: cx, y: y(v), content: b.tip })}
              onFocus={() => setTip({ x: cx, y: y(v), content: b.tip })}
              onBlur={() => setTip(null)}
              tabIndex={0}
              aria-label={b.label}
              className="bar-hit"
            >
              <rect x={cx - slot / 2} y={pad.top} width={slot} height={innerH} fill="transparent" />
              {b.value !== null ? (
                <rect
                  x={cx - bw / 2}
                  y={pad.top + innerH - h}
                  width={bw}
                  height={h}
                  rx={Math.min(4, bw / 2)}
                  className={`viz-bar tone-${b.tone ?? 'ink'} anim-grow-y`}
                  style={vars({ '--i': i })}
                />
              ) : null}
              {showValues && b.value !== null && b.value > 0 ? (
                <text x={cx} y={pad.top + innerH - h - 6} textAnchor="middle" className="chart-bar-value anim-fade" style={vars({ '--i': i })}>
                  {valueFormat(v)}
                </text>
              ) : null}
              {b.tick ? (
                <text x={cx} y={height - 8} textAnchor="middle" className="chart-tick">
                  {b.tick}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Horizontal bars with labels (time by module, topic time, question types)

export interface HBar {
  key: string
  label: ReactNode
  sub?: ReactNode
  value: number
  display: string
  colour?: string
  tone?: 'ink' | 'good' | 'bad' | 'muted' | 'accent'
}

export function HBars({ rows, max, label }: { rows: HBar[]; max?: number; label: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="hbars" aria-label={label}>
      {rows.map((r, i) => (
        <li key={r.key}>
          <div className="hbar-label">
            <span>{r.label}</span>
            {r.sub ? <span className="faint">{r.sub}</span> : null}
          </div>
          <div className="hbar-track" aria-hidden="true">
            <span
              className={`hbar-fill tone-${r.tone ?? 'ink'} anim-grow-x`}
              style={vars({ width: `${Math.max(1.5, (r.value / top) * 100)}%`, '--i': i, ...(r.colour ? { background: r.colour } : {}) })}
            />
          </div>
          <span className="hbar-value num">{r.display}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Donut with a legend (share of time by module)

export function Donut({
  slices,
  label,
  centre
}: {
  slices: { key: string; label: string; value: number; colour: string; display: string }[]
  label: string
  centre: { value: string; caption: string }
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1
  const r = 70
  const c = 2 * Math.PI * r
  const gap = slices.length > 1 ? 3 : 0
  let offset = 0
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div className="donut">
      <svg viewBox="0 0 180 180" width={180} height={180} role="img" aria-label={label}>
        <circle cx={90} cy={90} r={r} className="donut-track" />
        {slices.map((s, i) => {
          const len = Math.max(0, (s.value / total) * c - gap)
          const el = (
            <circle
              key={s.key}
              cx={90}
              cy={90}
              r={r}
              className={hover && hover !== s.key ? 'donut-seg is-dim anim-sweep' : 'donut-seg anim-sweep'}
              stroke={s.colour}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              style={vars({ '--len': len, '--c': c, '--i': i })}
              transform="rotate(-90 90 90)"
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
            >
              <title>
                {s.label}: {s.display}
              </title>
            </circle>
          )
          offset += (s.value / total) * c
          return el
        })}
        <text x={90} y={88} textAnchor="middle" className="donut-value">
          {centre.value}
        </text>
        <text x={90} y={108} textAnchor="middle" className="donut-caption">
          {centre.caption}
        </text>
      </svg>
      <ul className="legend">
        {slices.map((s) => (
          <li
            key={s.key}
            className={hover === s.key ? 'is-on' : ''}
            onPointerEnter={() => setHover(s.key)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="swatch" style={{ background: s.colour, width: 10, height: 10 }} />
            <span className="legend-label">{s.label}</span>
            <span className="num faint">{s.display}</span>
            <span className="num">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calendar heatmap: twelve weeks, one column per week, Monday at the top.

export function Heatmap({
  days,
  metric
}: {
  days: { date: string; seconds: number; attempts: number }[]
  metric: 'time' | 'attempts'
}) {
  const [tip, setTip] = useState<TipState | null>(null)
  const [wrapRef, avail] = useWidth(200)
  const value = (d: (typeof days)[number]): number => (metric === 'time' ? d.seconds : d.attempts)
  const max = Math.max(1, ...days.map(value))
  const first = new Date(`${days[0]?.date ?? '2026-01-01'}T00:00:00`)
  const lead = (first.getDay() + 6) % 7
  const cells = [...Array.from({ length: lead }, () => null), ...days]
  const cols = Math.ceil(cells.length / 7)
  const gapPx = 4
  const size = Math.max(11, Math.min(30, Math.floor((avail - 30) / cols - gapPx)))
  const level = (v: number): number => (v <= 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999)))
  const months: { col: number; label: string }[] = []
  cells.forEach((d, i) => {
    if (!d) return
    const dt = new Date(`${d.date}T00:00:00`)
    if (dt.getDate() <= 7 && i % 7 === 0) months.push({ col: Math.floor(i / 7), label: dt.toLocaleDateString(undefined, { month: 'short' }) })
  })
  const w = cols * (size + gapPx) + 26
  const active = days.filter((d) => value(d) > 0).length
  return (
    <div className="heatmap" ref={wrapRef}>
      <div className="chart" style={{ height: 7 * (size + gapPx) + 22 }}>
        <svg
          width={w}
          height={7 * (size + gapPx) + 22}
          role="img"
          aria-label={`Study activity over the last twelve weeks: ${active} active days.`}
          onPointerLeave={() => setTip(null)}
        >
          {['Mon', '', 'Wed', '', 'Fri', '', ''].map((l, r) =>
            l ? (
              <text key={r} x={0} y={18 + r * (size + gapPx) + size / 2 + 4} className="chart-tick">
                {l}
              </text>
            ) : null
          )}
          {months.map((m) => (
            <text key={m.col} x={26 + m.col * (size + gapPx)} y={10} className="chart-tick">
              {m.label}
            </text>
          ))}
          {cells.map((d, i) => {
            if (!d) return null
            const col = Math.floor(i / 7)
            const row = i % 7
            const x = 26 + col * (size + gapPx)
            const y = 18 + row * (size + gapPx)
            const v = value(d)
            const dt = new Date(`${d.date}T00:00:00`)
            const content = (
              <>
                <span className="chart-tip-title">{dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                <span className="chart-tip-meta">
                  {d.seconds ? fmtDuration(d.seconds) : 'No study'} · {d.attempts} {d.attempts === 1 ? 'attempt' : 'attempts'}
                </span>
              </>
            )
            return (
              <rect
                key={d.date}
                x={x}
                y={y}
                width={size}
                height={size}
                rx={Math.max(3, size / 5)}
                className={`heat heat-${level(v)} anim-pop`}
                style={vars({ '--i': col * 7 + row })}
                onPointerEnter={() => setTip({ x: x + size / 2, y, content })}
              />
            )
          })}
        </svg>
        <Tip tip={tip} />
      </div>
      <div className="heat-scale" aria-hidden="true">
        <span className="faint">Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-key heat-${l}`} />
        ))}
        <span className="faint">More</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scatter: seconds per question (x) against accuracy (y), one dot per topic.

export function Scatter({
  points,
  height = 280,
  label
}: {
  points: { key: string; x: number; y: number; label: string; sub: string; size: number }[]
  height?: number
  label: string
}) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState<TipState | null>(null)
  const pad = { top: 16, right: 24, bottom: 36, left: 40 }
  const xs = points.map((p) => p.x)
  const lo = Math.max(0, Math.floor((Math.min(...xs, 10) * 0.8) / 5) * 5)
  const maxX = Math.max(lo + 10, Math.ceil((Math.max(...xs, 10) * 1.1) / 5) * 5)
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const sx = (v: number): number => pad.left + ((v - lo) / (maxX - lo)) * innerW
  const sy = (v: number): number => pad.top + (1 - v / 100) * innerH
  const maxSize = Math.max(1, ...points.map((p) => p.size))
  const xTicks = [lo, lo + (maxX - lo) / 3, lo + (2 * (maxX - lo)) / 3]
  // Label the most telling topics first (least accurate, then slowest) and skip any label that would collide.
  const placed: { x: number; y: number; w: number }[] = []
  const labelled = new Set<string>()
  const order = [...points].sort((a, b) => a.y - b.y || b.x - a.x)
  for (const p of order) {
    const r = 6 + (p.size / Math.max(1, ...points.map((q) => q.size))) * 8
    const text = p.label.length > 22 ? `${p.label.slice(0, 21)}…` : p.label
    const lx = sx(p.x) + r + 5
    const ly = sy(p.y)
    const w = text.length * 6.6
    const clash =
      lx + w > width - 4 ||
      placed.some((q) => Math.abs(q.y - ly) < 15 && lx < q.x + q.w + 6 && q.x < lx + w + 6) ||
      points.some((q) => q !== p && Math.abs(sy(q.y) - ly) < 12 && sx(q.x) > lx - 4 && sx(q.x) < lx + w)
    if (!clash && placed.length < 6) {
      placed.push({ x: lx, y: ly, w })
      labelled.add(p.key)
    }
  }
  const medianX = points.length ? [...points].sort((a, b) => a.x - b.x)[Math.floor(points.length / 2)].x : 0
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label} onPointerLeave={() => setTip(null)}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={pad.left + innerW} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'chart-axis' : 'chart-grid'} />
            <text x={pad.left - 8} y={sy(v) + 4} textAnchor="end" className="chart-tick">
              {v}%
            </text>
          </g>
        ))}
        {points.length > 2 ? <line x1={sx(medianX)} x2={sx(medianX)} y1={pad.top} y2={pad.top + innerH} className="chart-ref" /> : null}
        {xTicks.map((t, i) => (
          <text key={i} x={sx(t)} y={height - 14} textAnchor={i === 0 ? 'start' : 'middle'} className="chart-tick">
            {Math.round(t)}s
          </text>
        ))}
        <text x={pad.left + innerW} y={height - 14} textAnchor="end" className="chart-tick">
          seconds per question →
        </text>
        {points.map((p, i) => {
          const r = 6 + (p.size / maxSize) * 8
          const content = (
            <>
              <span className="chart-tip-title">{p.label}</span>
              <span className="chart-tip-meta">
                {Math.round(p.y)}% accuracy · {p.x}s per question · {p.sub}
              </span>
            </>
          )
          return (
            <g
              key={p.key}
              tabIndex={0}
              aria-label={`${p.label}: ${Math.round(p.y)}% accuracy, ${p.x} seconds per question`}
              onPointerEnter={() => setTip({ x: sx(p.x), y: sy(p.y) - r, content })}
              onFocus={() => setTip({ x: sx(p.x), y: sy(p.y) - r, content })}
              onBlur={() => setTip(null)}
              className="scatter-pt"
            >
              <circle cx={sx(p.x)} cy={sy(p.y)} r={r + 6} fill="transparent" />
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={r}
                className={`scatter-dot anim-pop ${p.y >= 70 ? 'tone-good' : p.y < 50 ? 'tone-bad' : 'tone-ink'}`}
                style={vars({ '--i': i * 4 })}
              />
              {labelled.has(p.key) ? (
                <text x={sx(p.x) + r + 5} y={sy(p.y) + 4} className="scatter-label">
                  {p.label.length > 22 ? `${p.label.slice(0, 21)}…` : p.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  )
}
