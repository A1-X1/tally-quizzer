import { useState } from 'react'
import type { MarkPoint, WrittenMarking } from '../../../shared/types'
import { fmtMarks } from '../lib/format'
import { Icon } from './Icon'
import { RichText } from './RichText'

/** The mark scheme, point by point, with what was awarded and why. */
export function MarkingTable({ scheme, marking }: { scheme: MarkPoint[]; marking: WrittenMarking | null }) {
  return (
    <table className="table table-dense marking-table">
      <caption className="sr-only">Mark scheme and marks awarded</caption>
      <thead>
        <tr>
          <th scope="col">Mark scheme point</th>
          {marking ? <th scope="col">Evidence in your answer</th> : null}
          <th scope="col" className="num-col">Marks</th>
        </tr>
      </thead>
      <tbody>
        {scheme.map((p, i) => {
          const m = marking?.points[i]
          const full = m ? m.awarded >= p.marks : false
          return (
            <tr key={i}>
              <td>
                <RichText text={p.text} />
                {m?.reason ? <span className="marking-reason faint small">{m.reason}</span> : null}
              </td>
              {marking ? (
                <td className="marking-evidence">{m?.evidence ? <q>{m.evidence}</q> : <span className="faint">—</span>}</td>
              ) : null}
              <td className="num-col num nowrap">
                {m ? (
                  <span className={full ? 'good' : m.awarded > 0 ? '' : 'bad'}>
                    {fmtMarks(m.awarded)}/{fmtMarks(p.marks)}
                  </span>
                ) : (
                  <span className="faint">{fmtMarks(p.marks)}</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Award marks point by point: used for self-marking and for adjusting an AI's marks. */
export function MarkEditor({
  scheme,
  initial,
  onSave,
  onCancel,
  busy
}: {
  scheme: MarkPoint[]
  initial: number[] | null
  onSave: (awarded: number[]) => void
  onCancel?: () => void
  busy?: boolean
}) {
  const [awarded, setAwarded] = useState<number[]>(() => initial ?? scheme.map(() => 0))
  const total = awarded.reduce((a, b) => a + b, 0)
  const max = scheme.reduce((a, b) => a + b.marks, 0)
  return (
    <div className="mark-editor" data-testid="mark-editor">
      <p className="mark-editor-help muted small">
        For each point, award marks only if your answer clearly makes that point, in any wording. Half marks are for a
        point worth more than one mark when you made part of it.
      </p>
      <ol className="mark-points">
        {scheme.map((p, i) => {
          const steps: number[] = []
          for (let v = 0; v <= p.marks + 1e-9; v += p.marks > 1 ? 0.5 : 1) steps.push(Math.round(v * 2) / 2)
          return (
            <li key={i}>
              <div className="mark-point-text">
                <RichText text={p.text} />
              </div>
              <div className="mark-steps" role="radiogroup" aria-label={`Marks for point ${i + 1}`}>
                {steps.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={awarded[i] === v}
                    className={awarded[i] === v ? 'mark-step is-on' : 'mark-step'}
                    onClick={() => setAwarded((a) => a.map((x, j) => (j === i ? v : x)))}
                  >
                    {fmtMarks(v)}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="mark-editor-foot">
        <span className="num">
          {fmtMarks(total)} / {fmtMarks(max)}
        </span>
        <div className="row-actions">
          {onCancel ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(awarded)} disabled={busy} data-testid="save-marks">
            <Icon name="check" size={14} /> Save marks
          </button>
        </div>
      </div>
    </div>
  )
}
