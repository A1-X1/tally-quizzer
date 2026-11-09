import type { ParsedQuestion, QuestionType } from '../../../shared/types'
import { fmtMarks } from '../lib/format'
import { RichText } from './RichText'

export function TypeBadge({ type }: { type: QuestionType }) {
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
