import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScorePoint } from '../../../shared/types'
import { fmtDate, fmtShortDate } from '../lib/format'

interface Series {
  key: number
  name: string
  colour: string
  points: ScorePoint[]
}

const PAD = { top: 18, right: 150, bottom: 34, left: 44 }
const DAY = 86_400_000

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function ticks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min]
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(min + ((max - min) * i) / (count - 1))
  return out
}

/**
 * Score over time. One line per module, labelled directly at its last point.
 * Pointer and keyboard (arrow keys) both move a focus point with a tooltip.
 */
export function LineChart({
  points,
  height = 300,
  label,
  onOpen
}: {
  points: ScorePoint[]
  height?: number
  label: string
  onOpen?: (attemptId: number) => void
}) {
  const [wrapRef, width] = useWidth()
  const [active, setActive] = useState<number | null>(null)

  const series: Series[] = useMemo(() => {
    const map = new Map<number, Series>()
    for (const p of points) {
      const s = map.get(p.moduleId) ?? {
        key: p.moduleId,
        name: p.moduleName,
        colour: `var(--mod-${p.moduleColour})`,
        points: []
      }
      s.points.push(p)
      map.set(p.moduleId, s)
    }
    return [...map.values()]
  }, [points])

  const flat = useMemo(
    () => [...points].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    [points]
  )

  const times = flat.map((p) => new Date(p.submittedAt).getTime())
  let tMin = Math.min(...times)
  let tMax = Math.max(...times)
  if (!Number.isFinite(tMin)) {
    tMin = Date.now() - 7 * DAY
    tMax = Date.now()
  }
  if (tMax - tMin < DAY) {
    tMin -= DAY / 2
    tMax += DAY / 2
  }
  const right = series.length > 0 ? PAD.right : 24
  const innerW = Math.max(100, width - PAD.left - right)
  const innerH = height - PAD.top - PAD.bottom
  const x = (t: number): number => PAD.left + ((t - tMin) / (tMax - tMin)) * innerW
  const y = (v: number): number => PAD.top + (1 - v / 100) * innerH

  // Direct labels, nudged apart so they never overlap.
  const labels = series
    .map((s) => {
      const last = s.points[s.points.length - 1]
      return { s, last, y: y(last.percentage) }
    })
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 30) labels[i].y = labels[i - 1].y + 30
  }
  const overflow = labels.length ? labels[labels.length - 1].y - (PAD.top + innerH) : 0
  if (overflow > 0) labels.forEach((l) => (l.y -= overflow))

  const xTicks = ticks(tMin, tMax, Math.max(2, Math.min(6, Math.floor(innerW / 130))))
  const activePoint = active !== null ? flat[active] : null

  const onMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    let best = -1
    let bestD = Infinity
    flat.forEach((p, i) => {
      const dx = x(new Date(p.submittedAt).getTime()) - px
      const dy = y(p.percentage) - py
      const d = dx * dx + dy * dy * 0.35
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    setActive(best >= 0 && bestD < 60 * 60 ? best : null)
  }

  const onKey = (e: React.KeyboardEvent<SVGSVGElement>): void => {
    if (flat.length === 0) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a === null ? flat.length - 1 : Math.min(flat.length - 1, a + 1)))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a === null ? flat.length - 1 : Math.max(0, a - 1)))
    } else if (e.key === 'Home') {
      setActive(0)
    } else if (e.key === 'End') {
      setActive(flat.length - 1)
    } else if (e.key === 'Enter' && activePoint && onOpen) {
      onOpen(activePoint.attemptId)
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  const tipLeft = activePoint ? x(new Date(activePoint.submittedAt).getTime()) : 0
  const tipTop = activePoint ? y(activePoint.percentage) : 0

  return (
    <div className="chart" ref={wrapRef} style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}. ${flat.length} attempts. Use the arrow keys to read each point.`}
        tabIndex={flat.length ? 0 : -1}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onClick={() => activePoint && onOpen?.(activePoint.attemptId)}
        style={{ cursor: activePoint && onOpen ? 'pointer' : 'default' }}
      >
        {/* Restrained grid: three reference lines only. */}
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(v)}
              y2={y(v)}
              className={v === 0 ? 'chart-axis' : 'chart-grid'}
            />
            <text x={PAD.left - 10} y={y(v) + 4} className="chart-tick" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={height - 10}
            className="chart-tick"
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {fmtShortDate(new Date(t).toISOString())}
          </text>
        ))}

        {series.map((s) => {
          const d = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(new Date(p.submittedAt).getTime()).toFixed(1)},${y(p.percentage).toFixed(1)}`)
            .join(' ')
          return (
            <g key={s.key} style={{ color: s.colour }}>
              <path d={d} className="chart-line anim-line" pathLength={1} />
              {s.points.map((p, i) => (
                <circle
                  key={p.attemptId}
                  cx={x(new Date(p.submittedAt).getTime())}
                  cy={y(p.percentage)}
                  r={activePoint?.attemptId === p.attemptId ? 6 : 3.5}
                  className="chart-dot anim-pop"
                  style={{ '--i': i * 6 } as React.CSSProperties}
                />
              ))}
            </g>
          )
        })}

        {labels.map(({ s, last, y: ly }) => {
          const lx = x(new Date(last.submittedAt).getTime())
          return (
            <g key={s.key} className="chart-label" style={{ color: s.colour }}>
              <line x1={lx + 8} x2={PAD.left + innerW + 12} y1={y(last.percentage)} y2={ly} className="chart-leader" />
              <text x={PAD.left + innerW + 16} y={ly - 2} className="chart-label-value">
                {Math.round(last.percentage)}%
              </text>
              <text x={PAD.left + innerW + 16} y={ly + 12} className="chart-label-name">
                {s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name}
              </text>
            </g>
          )
        })}

        {activePoint ? (
          <line x1={tipLeft} x2={tipLeft} y1={PAD.top} y2={PAD.top + innerH} className="chart-cursor" />
        ) : null}
      </svg>

      {activePoint ? (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(tipLeft, 90), width - 120),
            top: tipTop
          }}
          role="status"
        >
          <span className="chart-tip-score num">{activePoint.percentage.toFixed(1)}%</span>
          <span className="chart-tip-title">{activePoint.quizTitle}</span>
          <span className="chart-tip-meta">
            Attempt {activePoint.attemptNumber} · {fmtDate(activePoint.submittedAt)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** A tiny inline trend line for tables. */
export function Spark({ values, width = 72, height = 20 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="faint num">—</span>
  const step = width / (values.length - 1)
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 2 - (v / 100) * (height - 4)).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
