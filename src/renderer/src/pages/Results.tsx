import { useState } from 'react'
import type { ReviewQuestion } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { TypeBadge } from '../components/QuestionView'
import { RichText } from '../components/RichText'
import { ErrorNote, Loading, Score, Segmented, Swatch, useLoad, useToast } from '../components/ui'
import { band, fmtDateTime, fmtDuration, fmtMarks, signed } from '../lib/format'
import { go, href } from '../lib/router'

type Filter = 'all' | 'wrong' | 'flagged'

export function ResultsPage({ id }: { id: number }) {
  const { data, error } = useLoad(() => api('attempts:result', { id }), [id])
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>
  if (!data) return <Loading />
  const a = data.attempt
  const pct = a.percentage ?? 0
  const vsPrev = data.previous ? pct - data.previous.percentage : null
  const isBest = data.best !== null && a.attemptNumber === data.best.attemptNumber
  const s = data.settings

  const practise = async (): Promise<void> => {
    setBusy(true)
    try {
      const session = await api('attempts:start', {
        quizId: a.quizId,
        settings: { ...s, timeLimitMinutes: null },
        practiceFromAttemptId: a.id,
        replaceInProgress: false
      })
      go({ name: 'attempt', id: session.id })
    } catch (e) {
      toast(errorMessage(e), 'bad')
      setBusy(false)
    }
  }

  const questions = data.questions.filter((q) =>
    filter === 'wrong' ? !q.isCorrect : filter === 'flagged' ? q.flagged : true
  )

  return (
    <div className="page results">
      <p className="eyebrow">
        <Swatch colour={a.moduleColour} size={12} />
        <a href={href({ name: 'module', id: a.moduleId })}>{a.moduleName}</a>
        <a href={href({ name: 'quiz', id: a.quizId })}>{a.quizTitle}</a>
        <span className="faint num">v{a.versionNo}</span>
      </p>

      <section className="result-hero" aria-labelledby="result-h">
        <div className="result-score">
          <h1 id="result-h" className="sr-only">
            {a.isPractice ? 'Practice result' : `Attempt ${a.attemptNumber} result`}: {pct.toFixed(1)} percent
          </h1>
          <p className={`result-pct result-${band(pct)}`} aria-hidden="true" data-testid="result-pct">
            {Math.round(pct)}
            <span className="result-pct-sign">%</span>
          </p>
          <p className="result-caption">
            {a.isPractice ? <span className="tag tag-practice">Practice · not counted</span> : null}
            {isBest && !a.isPractice ? <mark className="hl">Your best on this quiz</mark> : null}
          </p>
        </div>
        <dl className="result-facts">
          <div>
            <dt>Mark</dt>
            <dd className="num" data-testid="result-mark">
              {fmtMarks(a.marksAwarded)} <span className="faint">/ {fmtMarks(a.marksAvailable)}</span>
            </dd>
          </div>
          <div>
            <dt>{a.isPractice ? 'Run' : 'Attempt'}</dt>
            <dd className="num" data-testid="result-attempt">
              {a.isPractice ? 'Practice' : `#${a.attemptNumber}`}
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd className="num" data-testid="result-time">{fmtDuration(a.durationSeconds)}</dd>
          </div>
          <div>
            <dt>vs previous</dt>
            <dd className="num">
              {vsPrev === null ? (
                <span className="faint">—</span>
              ) : (
                <span className={vsPrev > 0 ? 'good' : vsPrev < 0 ? 'bad' : ''}>{signed(vsPrev, 0)} pts</span>
              )}
              {data.previous ? (
                <span className="fact-sub faint">
                  vs #{data.previous.attemptNumber} at {Math.round(data.previous.percentage)}%
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Best</dt>
            <dd className="num">
              {data.best ? (
                <>
                  {Math.round(data.best.percentage)}%
                  <span className="fact-sub faint">attempt #{data.best.attemptNumber}</span>
                </>
              ) : (
                <span className="faint">—</span>
              )}
            </dd>
          </div>
        </dl>
        <div className="result-actions">
          <a className="btn btn-primary" href={href({ name: 'quiz', id: a.quizId })}>
            <Icon name="retry" size={16} /> Retry quiz
          </a>
          <button type="button" className="btn btn-secondary" onClick={practise} disabled={busy || data.wrongCount === 0}>
            Practise {data.wrongCount === 0 ? 'wrong answers' : `${data.wrongCount} wrong ${data.wrongCount === 1 ? 'answer' : 'answers'}`}
          </button>
        </div>
      </section>

      <section className="section" aria-labelledby="details-h">
        <div className="section-head">
          <h2 id="details-h" className="h-small">Attempt details</h2>
        </div>
        <dl className="details">
          <div>
            <dt>Started</dt>
            <dd>{fmtDateTime(a.startedAt)}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{fmtDateTime(a.submittedAt)}</dd>
          </div>
          <div>
            <dt>Marking</dt>
            <dd>{s.marking === 'strict' ? 'Strict' : 'Partial'}</dd>
          </div>
          <div>
            <dt>Feedback</dt>
            <dd>{s.feedback === 'end' ? 'At the end' : 'After each question'}</dd>
          </div>
          <div>
            <dt>Order</dt>
            <dd>
              {s.shuffleQuestions ? 'Questions shuffled' : 'Questions in order'}
              {s.shuffleOptions ? ', answers shuffled' : ''}
            </dd>
          </div>
          <div>
            <dt>Time limit</dt>
            <dd>{s.timeLimitMinutes ? `${s.timeLimitMinutes} min` : 'None'}</dd>
          </div>
        </dl>
      </section>

      {data.topics.length > 0 ? (
        <section className="section" aria-labelledby="topics-h">
          <div className="section-head">
            <h2 id="topics-h">By topic</h2>
          </div>
          <table className="table topic-table">
            <caption className="sr-only">Marks by topic</caption>
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col" className="num-col">Questions</th>
                <th scope="col" className="num-col">Marks</th>
                <th scope="col" className="bar-col"><span className="sr-only">Bar</span></th>
                <th scope="col" className="num-col">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.topics.map((t) => (
                <tr key={t.topic}>
                  <td>{t.topic}</td>
                  <td className="num-col num">{t.questions}</td>
                  <td className="num-col num">
                    {fmtMarks(t.awarded)}
                    <span className="faint">/{fmtMarks(t.available)}</span>
                  </td>
                  <td className="bar-col">
                    <div className="bar-track" aria-hidden="true">
                      <span className={`bar-fill bar-${t.percentage >= 70 ? 'good' : t.percentage >= 50 ? 'mid' : 'low'}`} style={{ width: `${Math.max(2, t.percentage)}%` }} />
                    </div>
                  </td>
                  <td className="num-col"><Score value={t.percentage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="section" aria-labelledby="review-h">
        <div className="section-head">
          <h2 id="review-h">Review</h2>
          <div className="section-tools">
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All ${data.questions.length}` },
                { value: 'wrong', label: `Wrong ${data.wrongCount}` },
                { value: 'flagged', label: `Flagged ${data.questions.filter((q) => q.flagged).length}` }
              ]}
            />
          </div>
        </div>
        {questions.length === 0 ? (
          <p className="muted">{filter === 'wrong' ? 'Nothing wrong. Every answer was right.' : 'You didn’t flag any questions.'}</p>
        ) : (
          <ol className="review-list">
            {questions.map((q) => (
              <ReviewItem key={q.id} q={q} />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function ReviewItem({ q }: { q: ReviewQuestion }) {
  const verdict = q.isCorrect ? 'right' : q.marksAwarded > 0 ? 'part' : 'wrong'
  return (
    <li className={`review review-${verdict}`} data-testid="review-item">
      <header className="review-head">
        <span className="question-n question-n-sm num">{String(q.displayPosition).padStart(2, '0')}</span>
        <span className={`verdict verdict-${verdict}`}>
          <Icon name={q.isCorrect ? 'check' : 'cross'} size={14} weight={2.6} />
          {q.isCorrect ? 'Correct' : !q.answered ? 'Not answered' : q.marksAwarded > 0 ? 'Partly right' : 'Wrong'}
        </span>
        <TypeBadge type={q.type} />
        {q.topic ? <span className="tag">{q.topic}</span> : null}
        <span className="review-score num">
          {fmtMarks(q.marksAwarded)}/{fmtMarks(q.marks)}
        </span>
        <span className="faint num small" title="Time spent">
          {fmtDuration(q.timeSpent)}
        </span>
        {q.flagged ? (
          <span className="faint small">
            <Icon name="flag" size={13} /> Flagged
          </span>
        ) : null}
      </header>
      <p className="review-prompt">
        <RichText text={q.prompt} />
      </p>
      <ul className="review-options">
        {q.options.map((o) => {
          const chosen = q.selected.includes(o.id)
          const cls = o.isCorrect ? (chosen ? 'ro-right' : 'ro-missed') : chosen ? 'ro-wrong' : 'ro-idle'
          return (
            <li key={o.id} className={`ro ${cls}`}>
              <span className={`opt-key opt-key-${q.type}`}>{o.label}</span>
              <span className="ro-text">
                <RichText text={o.text} />
              </span>
              <span className="ro-notes">
                {chosen ? <span className="ro-note">Your answer</span> : null}
                {o.isCorrect ? <span className="ro-note ro-note-correct">Correct</span> : null}
              </span>
            </li>
          )
        })}
      </ul>
      {q.explanation ? (
        <div className="review-expl">
          <span className="mini-h">Why</span>
          <p>
            <RichText text={q.explanation} />
          </p>
        </div>
      ) : null}
    </li>
  )
}
