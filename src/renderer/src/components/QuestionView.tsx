import type { MarkPoint, ParsedQuestion, QuestionType } from '../../../shared/types'
import { fmtMarks } from '../lib/format'
import { RichText } from './RichText'

export function TypeBadge({ type }: { type: QuestionType }) {
  if (type === 'written') {
    return (
      <span className="type-badge type-written">
        <span className="type-glyph type-glyph-line" aria-hidden="true" />
        Written answer
      </span>
    )
  }
  return type === 'single' ? (
    <span className="type-badge type-single">
      <span className="type-glyph type-glyph-radio" aria-hidden="true" />
      Choose one
    </span>
  ) : (
    <span className="type-badge type-multi">
      <span className="type-glyph type-glyph-box" aria-hidden="true" />
      Select all that apply
    </span>
  )
}

/** A mark scheme as a numbered list of points with their marks. */
export function MarkSchemeList({ points }: { points: MarkPoint[] }) {
  return (
    <ol className="scheme">
      {points.map((p, i) => (
        <li key={i}>
          <span className="scheme-marks num">
            {fmtMarks(p.marks)} {p.marks === 1 ? 'mark' : 'marks'}
          </span>
          <RichText text={p.text} />
        </li>
      ))}
    </ol>
  )
}

export function QuestionPreview({ q }: { q: ParsedQuestion }) {
  return (
    <article className="qpreview">
      <header className="qpreview-head">
        <span className="faint num">Row {q.row}</span>
        <TypeBadge type={q.type} />
        <span className="faint num">
          {fmtMarks(q.marks)} {q.marks === 1 ? 'mark' : 'marks'}
        </span>
        {q.topic ? <span className="tag">{q.topic}</span> : null}
      </header>
      <p className="qpreview-prompt">
        <RichText text={q.prompt} />
      </p>
      {q.type === 'written' ? (
        <div className="qpreview-written">
          <MarkSchemeList points={q.markScheme ?? []} />
          {q.modelAnswer ? (
            <p className="qpreview-model">
              <span className="mini-h">Model answer</span>
              <RichText text={q.modelAnswer} />
            </p>
          ) : null}
        </div>
      ) : null}
      <ul className="qpreview-options">
        {q.options.map((o) => (
          <li key={o.label} className={o.isCorrect ? 'is-correct' : ''}>
            <span className={`opt-key opt-key-${q.type}`}>{o.label}</span>
            <RichText text={o.text} />
            {o.isCorrect ? <span className="sr-only">(correct)</span> : null}
          </li>
        ))}
      </ul>
      {q.explanation ? (
        <p className="qpreview-expl">
          <RichText text={q.explanation} />
        </p>
      ) : null}
    </article>
  )
}
