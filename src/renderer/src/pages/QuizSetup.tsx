import { useState } from 'react'
import type { AttemptSettings, QuizTiming } from '../../../shared/types'
import { Bars, HBars } from '../components/Charts'
import { RichText } from '../components/RichText'
import { api, errorCode, errorMessage } from '../api'
import { AttemptsTable } from '../components/AttemptsTable'
import { Icon } from '../components/Icon'
import { Dialog, Empty, ErrorNote, Field, Loading, Score, Segmented, Swatch, Toggle, useLoad, useToast } from '../components/ui'
import { fmtDate, fmtDuration, fmtMarks, plural } from '../lib/format'
import { go, href } from '../lib/router'

const DEFAULTS: AttemptSettings = {
  shuffleQuestions: false,
  shuffleOptions: false,
  feedback: 'end',
  timeLimitMinutes: null,
  marking: 'strict'
}

export function QuizSetup({ id }: { id: number }) {
  const { data, error, reload } = useLoad(() => api('quizzes:detail', { id }), [id])
  const [s, setS] = useState<AttemptSettings>(DEFAULTS)
  const [limitOn, setLimitOn] = useState(false)
  const [limit, setLimit] = useState(20)
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [deleting, setDeleting] = useState(false)
  const toast = useToast()

  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>
  if (!data) return <Loading />
  const q = data.quiz
  const v = data.version
  const archived = !!q.archivedAt

  const start = async (replace: boolean): Promise<void> => {
    setBusy(true)
    setStartError(null)
    try {
      const session = await api('attempts:start', {
        quizId: q.id,
        settings: { ...s, timeLimitMinutes: limitOn ? Math.max(1, Math.min(600, Math.round(limit))) : null },
        practiceFromAttemptId: null,
        replaceInProgress: replace
      })
      go({ name: 'attempt', id: session.id })
    } catch (e) {
      if (errorCode(e) === 'IN_PROGRESS') {
        setStartError('You already have an unfinished attempt at this quiz. Resume it, or start over.')
      } else setStartError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="page quiz-setup">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <Swatch colour={data.module.colour} size={12} />
            <a href={href({ name: 'module', id: data.module.id })}>{data.module.name}</a>
            <span className="faint num">v{v.versionNo}</span>
            {archived ? <span className="tag">Archived</span> : null}
          </p>
          <h1 className="page-title">{q.title}</h1>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setNewTitle(q.title)
              setRenaming(true)
            }}
          >
            <Icon name="edit" size={16} /> Rename
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await api('quizzes:archive', { id: q.id, archived: !archived })
              toast(archived ? 'Quiz restored.' : 'Quiz archived. Its attempts are kept.', 'good')
              reload()
            }}
          >
            <Icon name="archive" size={16} /> {archived ? 'Unarchive' : 'Archive'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setDeleting(true)}>
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      </header>

      <div className="setup-grid">
        <section className="setup-facts" aria-label="About this quiz">
          <dl className="facts">
            <div>
              <dt>Questions</dt>
              <dd className="num">{v.questionCount}</dd>
            </div>
            <div>
              <dt>Marks</dt>
              <dd className="num">{fmtMarks(v.totalMarks)}</dd>
            </div>
            <div>
              <dt>Choose one</dt>
              <dd className="num">{v.singleCount}</dd>
            </div>
            <div>
              <dt>Select all</dt>
              <dd className="num">{v.multiCount}</dd>
            </div>
          </dl>
          <div className="best">
            <div>
              <p className="best-label">Best</p>
              <p className="best-value">
                {data.best ? <Score value={data.best.percentage} /> : <span className="faint num">—</span>}
              </p>
              <p className="faint small">
                {data.best ? `Attempt ${data.best.attemptNumber} · ${fmtDate(data.best.submittedAt)}` : 'Not attempted yet'}
              </p>
            </div>
            <div>
              <p className="best-label">Last</p>
              <p className="best-value">
                {data.last ? <Score value={data.last.percentage} /> : <span className="faint num">—</span>}
              </p>
              <p className="faint small">
                {data.last ? `Attempt ${data.last.attemptNumber} · ${fmtDate(data.last.submittedAt)}` : ''}
              </p>
            </div>
          </div>
          {v.topics.length ? (
            <p className="muted small">
              <span className="faint">Topics </span>
              {v.topics.join(' · ')}
            </p>
          ) : null}
          <p className="faint small">
            Version {v.versionNo} imported {fmtDate(v.importedAt)}
            {v.sourceFilename ? (
              <>
                {' '}from <span className="mono">{v.sourceFilename}</span>
              </>
            ) : null}
            {data.versions.length > 1 ? ` · ${data.versions.length} versions` : ''}
          </p>
        </section>

        <section className="setup-form" aria-labelledby="setup-h">
          <h2 id="setup-h" className="h-small">Settings for this attempt</h2>
          {q.inProgressAttemptId ? (
            <div className="resume-inline">
              <p>
                <strong>You have an unfinished attempt.</strong> Your answers so far are saved.
              </p>
              <div className="row-actions">
                <a className="btn btn-primary" href={href({ name: 'attempt', id: q.inProgressAttemptId })} data-testid="resume-here">
                  Resume <Icon name="arrowRight" size={16} />
                </a>
              </div>
            </div>
          ) : null}
          <div className="setup-options">
            <Toggle
              checked={s.shuffleQuestions}
              onChange={(x) => setS({ ...s, shuffleQuestions: x })}
              label="Shuffle questions"
            />
            <Toggle
              checked={s.shuffleOptions}
              onChange={(x) => setS({ ...s, shuffleOptions: x })}
              label="Shuffle answers"
              description="Letters follow the new order."
            />
            <div className="setup-row">
              <span className="setup-row-label" id="fb-l">Feedback</span>
              <Segmented
                label="Feedback"
                value={s.feedback}
                onChange={(x) => setS({ ...s, feedback: x })}
                options={[
                  { value: 'end', label: 'At the end' },
                  { value: 'each', label: 'After each question' }
                ]}
              />
            </div>
            <div className="setup-row">
              <span className="setup-row-label">Marking</span>
              <Segmented
                label="Marking"
                value={s.marking}
                onChange={(x) => setS({ ...s, marking: x })}
                options={[
                  { value: 'strict', label: 'Strict' },
                  { value: 'partial', label: 'Partial' }
                ]}
              />
            </div>
            <p className="setup-explain muted small">
              {s.marking === 'strict'
                ? 'Full marks only for exactly the right selection; anything else scores zero.'
                : 'On “select all” questions, each right tick earns a share of the marks and each wrong tick cancels one out, never below zero.'}
            </p>
            <div className="setup-row">
              <Toggle checked={limitOn} onChange={setLimitOn} label="Time limit" />
              {limitOn ? (
                <label className="limit-input">
                  <input
                    type="number"
                    className="input input-num mono"
                    min={1}
                    max={600}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    aria-label="Time limit in minutes"
                  />
                  <span className="muted">minutes</span>
                </label>
              ) : null}
            </div>
          </div>
          {startError ? (
            <ErrorNote>
              {startError}
              {q.inProgressAttemptId ? (
                <div className="row-actions">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => start(true)}>
                    Discard it and start over
                  </button>
                </div>
              ) : null}
            </ErrorNote>
          ) : null}
          <div className="setup-start">
            <button
              type="button"
              className="btn btn-primary btn-xl"
              disabled={busy || archived}
              onClick={() => start(false)}
              data-testid="start-quiz"
            >
              {q.inProgressAttemptId ? 'Start a new attempt' : q.attemptCount ? `Start attempt ${(data.attempts.filter((a) => !a.isPractice).length) + 1}` : 'Start quiz'}
              <Icon name="arrowRight" size={20} />
            </button>
            <p className="faint small">
              Keys: <kbd>A</kbd>–<kbd>E</kbd> or <kbd>1</kbd>–<kbd>5</kbd> to answer, <kbd>Enter</kbd> next, <kbd>F</kbd> flag.
            </p>
          </div>
        </section>
      </div>

      <QuizTimingSection timing={data.timing} />

      <section className="section" aria-labelledby="past-h">
        <div className="section-head">
          <h2 id="past-h">Past attempts</h2>
        </div>
        {data.attempts.length ? (
          <AttemptsTable rows={data.attempts} columns={['when', 'attempt', 'version', 'score', 'mark', 'time', 'marking']} caption="Past attempts" />
        ) : (
          <Empty title="No attempts yet." mark="clock">
            Each finished attempt is listed here with its mark, time and settings.
          </Empty>
        )}
      </section>

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename quiz"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRenaming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!newTitle.trim()}
              onClick={async () => {
                try {
                  await api('quizzes:rename', { id: q.id, title: newTitle, description: q.description })
                  setRenaming(false)
                  reload()
                } catch (e) {
                  toast(errorMessage(e), 'bad')
                }
              }}
            >
              Save
            </button>
          </>
        }
      >
        <Field label="Title" htmlFor="rename">
          <input id="rename" className="input" value={newTitle} maxLength={200} onChange={(e) => setNewTitle(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete “${q.title}”?`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger-solid"
              onClick={async () => {
                await api('quizzes:delete', { id: q.id })
                toast('Quiz deleted. A backup was saved first.', 'good')
                go({ name: 'module', id: data.module.id })
              }}
            >
              Delete quiz and attempts
            </button>
          </>
        }
      >
        <p>
          All {data.versions.length > 1 ? `${data.versions.length} versions` : 'questions'} and{' '}
          {q.attemptCount === 1 ? 'the one attempt' : `${q.attemptCount} attempts`} will be removed. Tally saves a backup
          first. Archive the quiz instead to hide it and keep its history.
        </p>
      </Dialog>
    </div>
  )
}

function QuizTimingSection({ timing }: { timing: QuizTiming }) {
  const [view, setView] = useState<'questions' | 'topics' | 'attempts'>('questions')
  if (timing.attempts.length === 0) return null
  const qs = timing.questions.filter((q) => q.perQuestion !== null)
  const maxSecs = Math.max(1, ...qs.map((q) => q.perQuestion ?? 0))
  return (
    <section className="section" aria-labelledby="qt-h">
      <div className="section-head">
        <h2 id="qt-h">Time and accuracy</h2>
        <div className="section-tools">
          <Segmented
            label="Breakdown"
            value={view}
            onChange={setView}
            options={[
              { value: 'questions', label: 'By question' },
              { value: 'topics', label: 'By topic' },
              { value: 'attempts', label: 'By attempt' }
            ]}
          />
        </div>
      </div>
      {view === 'questions' ? (
        <div className="table-wrap anim-enter" key="q">
          <table className="table table-dense qtime-table">
            <caption className="sr-only">Average time and accuracy for each question</caption>
            <thead>
              <tr>
                <th scope="col" className="num-col">#</th>
                <th scope="col">Question</th>
                <th scope="col">Topic</th>
                <th scope="col" className="bar-col">Average time</th>
                <th scope="col" className="num-col">Right</th>
              </tr>
            </thead>
            <tbody>
              {timing.questions.map((q, i) => (
                <tr key={q.position}>
                  <td className="num-col num faint">{q.position}</td>
                  <td className="qtime-prompt">
                    <RichText text={q.prompt.length > 120 ? `${q.prompt.slice(0, 117)}…` : q.prompt} />
                  </td>
                  <td className="muted nowrap">{q.topic ?? '—'}</td>
                  <td className="bar-col">
                    {q.perQuestion === null ? (
                      <span className="faint small">Not yet seen</span>
                    ) : (
                      <div className="qtime-bar">
                        <div className="hbar-track">
                          <span
                            className="hbar-fill tone-accent anim-grow-x"
                            style={{ width: `${Math.max(2, (q.perQuestion / maxSecs) * 100)}%`, '--i': i } as React.CSSProperties}
                          />
                        </div>
                        <span className="num">{fmtDuration(q.perQuestion)}</span>
                      </div>
                    )}
                  </td>
                  <td className="num-col">
                    <Score value={q.accuracy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view === 'topics' ? (
        timing.topics.length === 0 ? (
          <p className="muted">This quiz has no topic column.</p>
        ) : (
          <HBars
            key="t"
            label="Seconds per question in each topic"
            rows={timing.topics.map((t) => ({
              key: t.topic,
              label: t.topic,
              sub: `${Math.round(t.accuracy)}% right · ${fmtDuration(t.seconds)} in total`,
              value: t.perQuestion,
              display: `${t.perQuestion}s each`,
              tone: t.accuracy >= 70 ? 'good' : t.accuracy < 50 ? 'bad' : 'ink'
            }))}
          />
        )
      ) : (
        <>
          <Bars
            key="a"
            height={220}
            label="Seconds per question in each attempt"
            valueFormat={(n) => `${Math.round(n)}s`}
            bars={timing.attempts.map((a) => ({
              key: String(a.attemptNumber),
              value: a.perQuestion,
              label: `Attempt ${a.attemptNumber}: ${a.perQuestion} seconds per question, ${a.percentage}%`,
              tick: `#${a.attemptNumber}`,
              tone: 'accent',
              tip: (
                <>
                  <span className="chart-tip-score num">{a.perQuestion}s a question</span>
                  <span className="chart-tip-title">Attempt {a.attemptNumber} · {Math.round(a.percentage)}%</span>
                  <span className="chart-tip-meta">
                    {fmtDuration(a.durationSeconds)} in total · {fmtDate(a.submittedAt)}
                  </span>
                </>
              )
            }))}
          />
          <p className="viz-note">
            Seconds per question across {plural(timing.attempts.length, 'attempt')}. Getting faster while the score holds
            is a sign it’s sticking.
          </p>
        </>
      )}
    </section>
  )
}
