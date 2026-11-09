import { useMemo, useState } from 'react'
import type { AttemptListRow } from '../../../shared/types'
import { fmtDateTime, fmtDuration, fmtMarks, fmtRelative, fmtTime } from '../lib/format'
import { go } from '../lib/router'
import { Icon } from './Icon'
import { Score, Swatch } from './ui'

export type Column = 'when' | 'module' | 'quiz' | 'version' | 'attempt' | 'score' | 'mark' | 'time' | 'marking'
type SortKey = 'when' | 'module' | 'quiz' | 'attempt' | 'score' | 'mark' | 'time'

const LABELS: Record<Column, string> = {
  when: 'Finished',
  module: 'Module',
  quiz: 'Quiz',
  version: 'Version',
  attempt: 'Attempt',
  score: 'Score',
  mark: 'Mark',
  time: 'Time',
  marking: 'Marking'
}

const NUMERIC: Column[] = ['attempt', 'score', 'mark', 'time', 'version']

function value(r: AttemptListRow, k: SortKey): number | string {
  switch (k) {
    case 'when':
      return r.submittedAt ?? ''
    case 'module':
      return r.moduleName.toLowerCase()
    case 'quiz':
      return r.quizTitle.toLowerCase()
    case 'attempt':
      return r.attemptNumber ?? -1
    case 'score':
      return r.percentage ?? -1
    case 'mark':
      return r.marksAwarded ?? -1
    case 'time':
      return r.durationSeconds
  }
}

export function AttemptsTable({
  rows,
  columns,
  sortable = false,
  caption,
  dense = false
}: {
  rows: AttemptListRow[]
  columns: Column[]
  sortable?: boolean
  caption: string
  dense?: boolean
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'when', dir: -1 })
  const sorted = useMemo(() => {
    if (!sortable) return rows
    return [...rows].sort((a, b) => {
      const va = value(a, sort.key)
      const vb = value(b, sort.key)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
  }, [rows, sort, sortable])

  const header = (c: Column) => {
    const sortKey = (['when', 'module', 'quiz', 'attempt', 'score', 'mark', 'time'] as string[]).includes(c)
      ? (c as SortKey)
      : null
    const cls = NUMERIC.includes(c) ? 'num-col' : ''
    if (!sortable || !sortKey) {
      return (
        <th key={c} scope="col" className={cls}>
          {LABELS[c]}
        </th>
      )
    }
    const active = sort.key === sortKey
    return (
      <th
        key={c}
        scope="col"
        className={cls}
        aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          className={active ? 'th-sort is-active' : 'th-sort'}
          onClick={() =>
            setSort((s) => (s.key === sortKey ? { key: sortKey, dir: s.dir === 1 ? -1 : 1 } : { key: sortKey, dir: sortKey === 'when' || sortKey === 'score' ? -1 : 1 }))
          }
        >
          {LABELS[c]}
          <span className="th-arrow" aria-hidden="true">
            {active ? (sort.dir === 1 ? '↑' : '↓') : ''}
          </span>
        </button>
      </th>
    )
  }

  return (
    <div className="table-wrap">
      <table className={dense ? 'table table-dense table-click' : 'table table-click'}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map(header)}
            <th scope="col" className="th-go">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} onClick={() => go({ name: 'result', id: r.id })}>
              {columns.map((c) => {
                switch (c) {
                  case 'when':
                    return (
                      <td key={c} className="nowrap" title={fmtDateTime(r.submittedAt)}>
                        <span>{fmtRelative(r.submittedAt)}</span>{' '}
                        <span className="faint num">{fmtTime(r.submittedAt)}</span>
                      </td>
                    )
                  case 'module':
                    return (
                      <td key={c} className="cell-module">
                        <Swatch colour={r.moduleColour} />
                        <span>{r.moduleName}</span>
                      </td>
                    )
                  case 'quiz':
                    return (
                      <td key={c} className="cell-quiz">
                        <span>{r.quizTitle}</span>
                        {r.isPractice ? <span className="tag tag-practice">Practice</span> : null}
                      </td>
                    )
                  case 'version':
                    return (
                      <td key={c} className="num-col num">
                        v{r.versionNo}
                      </td>
                    )
                  case 'attempt':
                    return (
                      <td key={c} className="num-col num">
                        {r.attemptNumber !== null ? `#${r.attemptNumber}` : '—'}
                      </td>
                    )
                  case 'score':
                    return (
                      <td key={c} className="num-col">
                        <Score value={r.percentage} />
                      </td>
                    )
                  case 'mark':
                    return (
                      <td key={c} className="num-col num">
                        {fmtMarks(r.marksAwarded)}
                        <span className="faint">/{fmtMarks(r.marksAvailable)}</span>
                      </td>
                    )
                  case 'time':
                    return (
                      <td key={c} className="num-col num">
                        {fmtDuration(r.durationSeconds)}
                      </td>
                    )
                  case 'marking':
                    return (
                      <td key={c} className="faint">
                        {r.markingMode === 'strict' ? 'Strict' : 'Partial'}
                      </td>
                    )
                }
              })}
              <td className="td-go">
                <a
                  href={`#/result/${r.id}`}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Open ${r.quizTitle}${r.attemptNumber ? ` attempt ${r.attemptNumber}` : ' practice run'}`}
                >
                  <Icon name="arrowRight" size={16} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
