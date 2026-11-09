import { useEffect, useState } from 'react'
import type { AiStatus, AttemptResult, ReviewQuestion } from '../../../shared/types'
import { MarkEditor, MarkingTable } from '../components/Marking'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { TypeBadge } from '../components/QuestionView'
import { RichText } from '../components/RichText'
import { ErrorNote, Loading, Score, Segmented, Swatch, useLoad, useToast } from '../components/ui'
import { Bars, Donut, HBars } from '../components/Charts'
import { band, fmtDateTime, fmtDuration, fmtMarks, plural, signed } from '../lib/format'
import { go, href } from '../lib/router'

type Filter = 'all' | 'wrong' | 'flagged'

export function ResultsPage({ id }: { id: number }) {
  const { data: loaded, error } = useLoad(() => api('attempts:result', { id }), [id])
  const [override, setOverride] = useState<AttemptResult | null>(null)
  const data = override ?? loaded
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  useEffect(() => {
    api('ai:status').then(setAiStatus).catch(() => undefined)
  }, [])
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

      {data.needsMarking > 0 ? (
        <div className="marking-banner" role="status" data-testid="needs-marking">
          <Icon name="edit" size={18} />
          <p>
            <strong>
              {data.needsMarking} written {data.needsMarking === 1 ? 'answer needs' : 'answers need'} marking.
            </strong>{' '}
            The score below counts {data.needsMarking === 1 ? 'it' : 'them'} as zero until then.
          </p>
          <div className="row-actions">
            {aiStatus?.configured ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={markingAll}
                onClick={async () => {
                  setMarkingAll(true)
                  try {
                    setOverride(await api('attempts:markPending', { id: a.id }))
                  } catch (e) {
                    toast(errorMessage(e), 'bad')
                    setOverride(await api('attempts:result', { id: a.id }))
                  } finally {
                    setMarkingAll(false)
                  }
                }}
              >
                {markingAll ? 'Marking…' : 'Mark with AI'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => document.querySelector('[data-unmarked="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
            >
              Mark them myself
            </button>
          </div>
        </div>
      ) : null}

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

      <TimeBreakdown data={data} />

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
              <ReviewItem key={q.id} q={q} attemptId={a.id} onUpdated={setOverride} />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function ReviewItem({ q, attemptId, onUpdated }: { q: ReviewQuestion; attemptId: number; onUpdated: (r: AttemptResult) => void }) {
  const unmarked = !!q.written && !q.written.marking
  const verdict = unmarked ? 'pending' : q.isCorrect ? 'right' : q.marksAwarded > 0 ? 'part' : 'wrong'
  return (
    <li className={`review review-${verdict}`} data-testid="review-item" data-unmarked={unmarked ? 'true' : undefined}>
      <header className="review-head">
        <span className="question-n question-n-sm num">{String(q.displayPosition).padStart(2, '0')}</span>
        <span className={`verdict verdict-${verdict}`}>
          <Icon name={unmarked ? 'edit' : q.isCorrect ? 'check' : 'cross'} size={14} weight={2.6} />
          {unmarked ? 'Needs marking' : q.isCorrect ? 'Correct' : !q.answered ? 'Not answered' : q.marksAwarded > 0 ? 'Partly right' : 'Wrong'}
        </span>
        <TypeBadge type={q.type} />
        {q.topic ? <span className="tag">{q.topic}</span> : null}
        <span className="review-score num">
          {fmtMarks(q.marksAwarded)}/{fmtMarks(q.marks)}
        </span>
        <span className="faint num small" title="Time spent">
          {fmtDuration(q.timeSpent)}
          {q.visits > 1 ? ` · ${q.visits} visits` : ''}
          {q.answerChanges > 0 ? ` · changed ${q.answerChanges}×` : ''}
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
      {q.written ? <WrittenReviewBlock q={q} attemptId={attemptId} onUpdated={onUpdated} /> : null}
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

const TOPIC_COLOURS = ['cobalt', 'orange', 'teal', 'ochre', 'rose', 'violet']

function TimeBreakdown({ data }: { data: AttemptResult }) {
  const [view, setView] = useState<'questions' | 'topics'>('questions')
  const t = data.timing
  if (t.questionSeconds === 0) return null
  const slowest = [...data.questions].sort((a, b) => b.timeSpent - a.timeSpent)[0]
  const multipleTopics = t.topics.length > 1
  return (
    <section className="section" aria-labelledby="time-h">
      <div className="section-head">
        <h2 id="time-h">Time</h2>
        <div className="section-tools">
          <Segmented
            label="Time view"
            value={view}
            onChange={setView}
            options={[
              { value: 'questions', label: 'Per question' },
              { value: 'topics', label: 'Per topic' }
            ]}
          />
        </div>
      </div>
      <dl className="stat-strip time-strip">
        <div>
          <dt>Per question</dt>
          <dd className="num">{fmtDuration(t.perQuestion)}</dd>
        </div>
        <div>
          <dt>Median</dt>
          <dd className="num">{fmtDuration(t.median)}</dd>
        </div>
        <div>
          <dt>On right answers</dt>
          <dd className="num">{t.rightPerQuestion === null ? '—' : fmtDuration(t.rightPerQuestion)}</dd>
        </div>
        <div>
          <dt>On wrong answers</dt>
          <dd className="num">{t.wrongPerQuestion === null ? '—' : fmtDuration(t.wrongPerQuestion)}</dd>
        </div>
        <div>
          <dt>Longest</dt>
          <dd className="num">
            Q{slowest.displayPosition} · {fmtDuration(slowest.timeSpent)}
          </dd>
        </div>
        <div>
          <dt>Answers changed</dt>
          <dd className="num">{t.answerChanges}</dd>
        </div>
      </dl>
      {view === 'questions' ? (
        <>
          <Bars
            key="q"
            height={240}
            label="Seconds spent on each question; green right, red wrong"
            valueFormat={(n) => `${Math.round(n)}`}
            reference={{ value: t.perQuestion, label: `average ${Math.round(t.perQuestion)}s` }}
            bars={data.questions.map((q) => ({
              key: String(q.id),
              value: q.timeSpent,
              label: `Question ${q.displayPosition}: ${q.timeSpent} seconds, ${q.isCorrect ? 'right' : 'wrong'}`,
              tick: data.questions.length <= 30 || q.displayPosition % 5 === 0 ? String(q.displayPosition) : '',
              tone: q.isCorrect ? 'good' : 'bad',
              tip: (
                <>
                  <span className="chart-tip-score num">{fmtDuration(q.timeSpent)}</span>
                  <span className="chart-tip-title">
                    Question {q.displayPosition} · {q.isCorrect ? 'right' : q.answered ? 'wrong' : 'not answered'}
                  </span>
                  <span className="chart-tip-meta">
                    {q.topic ?? 'No topic'}
                    {q.firstAnswerSeconds !== null ? ` · first answer after ${fmtDuration(q.firstAnswerSeconds)}` : ''}
                  </span>
                </>
              )
            }))}
          />
          <p className="viz-note">Active seconds on each question, in the order you saw them. The dashed line is your average.</p>
        </>
      ) : (
        <div className="viz-grid">
          <div className="viz-cell">
            {multipleTopics ? (
              <Donut
                key="donut"
                label="Share of time per topic"
                centre={{ value: fmtDuration(t.questionSeconds), caption: 'on questions' }}
                slices={t.topics.map((tp, i) => ({
                  key: tp.topic,
                  label: tp.topic,
                  value: tp.seconds,
                  colour: `var(--mod-${TOPIC_COLOURS[i % TOPIC_COLOURS.length]})`,
                  display: fmtDuration(tp.seconds)
                }))}
              />
            ) : (
              <p className="muted">All of this quiz’s questions share one topic.</p>
            )}
          </div>
          <div className="viz-cell">
            <HBars
              label="Seconds per question in each topic"
              rows={t.topics.map((tp) => ({
                key: tp.topic,
                label: tp.topic,
                sub: `${plural(tp.questions, 'question')} · ${Math.round(tp.percentage)}% right`,
                value: tp.perQuestion,
                display: `${tp.perQuestion}s each`,
                tone: tp.percentage >= 70 ? 'good' : tp.percentage < 50 ? 'bad' : 'ink'
              }))}
            />
          </div>
        </div>
      )}
    </section>
  )
}

function WrittenReviewBlock({ q, attemptId, onUpdated }: { q: ReviewQuestion; attemptId: number; onUpdated: (r: AttemptResult) => void }) {
  const w = q.written!
  const [editing, setEditing] = useState(!w.marking && !!q.writtenAnswer?.trim())
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const save = async (awarded: number[]): Promise<void> => {
    setBusy(true)
    try {
      onUpdated(await api('attempts:adjustMarks', { attemptId, questionId: q.id, awarded }))
      setEditing(false)
      toast('Marks saved.', 'good')
    } catch (e) {
      toast(errorMessage(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="written-review">
      <div className="your-answer">
        <span className="mini-h">Your answer</span>
        {q.writtenAnswer?.trim() ? <p className="your-answer-text">{q.writtenAnswer}</p> : <p className="faint">No answer given.</p>}
      </div>
      {editing ? (
        <MarkEditor
          scheme={w.markScheme}
          initial={w.marking ? w.marking.points.map((p) => p.awarded) : null}
          onSave={save}
          onCancel={w.marking ? () => setEditing(false) : undefined}
          busy={busy}
        />
      ) : (
        <>
          <MarkingTable scheme={w.markScheme} marking={w.marking} />
          {w.marking?.feedback ? <p className="marking-feedback">{w.marking.feedback}</p> : null}
          <p className="faint small marking-by">
            {w.marking
              ? w.marking.markedBy === 'ai'
                ? `Marked by ${w.marking.model ?? 'AI'} against the mark scheme${w.marking.edited ? ', then adjusted by you' : ''}.`
                : w.marking.markedBy === 'auto'
                  ? 'No answer, so no marks.'
                  : 'Marked by you.'
              : 'Not marked yet.'}{' '}
            {q.writtenAnswer?.trim() ? (
              <button type="button" className="link-btn" onClick={() => setEditing(true)} data-testid="adjust-marks">
                {w.marking ? 'Change marks' : 'Mark it'}
              </button>
            ) : null}
          </p>
        </>
      )}
      <div className="model-answer">
        <span className="mini-h">Model answer</span>
        <p>
          <RichText text={w.modelAnswer} />
        </p>
      </div>
    </div>
  )
}
