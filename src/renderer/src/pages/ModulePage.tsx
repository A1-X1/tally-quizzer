import { useState } from 'react'
import { api, errorMessage } from '../api'
import { AttemptsTable } from '../components/AttemptsTable'
import { Icon } from '../components/Icon'
import { LineChart } from '../components/LineChart'
import { HBars } from '../components/Charts'
import { MaterialsSection } from '../components/Materials'
import { ModuleDialog } from '../components/ModuleForm'
import { RichText } from '../components/RichText'
import { Dialog, Empty, ErrorNote, Field, Loading, Score, Swatch, Toggle, Trend, useLoad, useToast } from '../components/ui'
import { fmtNumber, fmtRelative } from '../lib/format'
import { go, href } from '../lib/router'

export function ModulePage({ id }: { id: number }) {
  const { data, error, reload } = useLoad(() => api('modules:detail', { id }), [id])
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [showArchivedQuizzes, setShowArchivedQuizzes] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>
  if (!data) return <Loading />
  const m = data.module
  const quizzes = data.quizzes.filter((q) => showArchivedQuizzes || !q.archivedAt)
  const archivedCount = data.quizzes.filter((q) => q.archivedAt).length

  const archive = async (): Promise<void> => {
    await api('modules:archive', { id: m.id, archived: !m.archivedAt })
    toast(m.archivedAt ? `${m.name} is back in your modules.` : `${m.name} archived. Its data is kept.`, 'good')
    reload()
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      await api('modules:delete', { id: m.id, confirmName: confirm })
      toast(`${m.name} deleted. A backup was saved first.`, 'good')
      go({ name: 'modules' })
    } catch (e) {
      toast(errorMessage(e), 'bad')
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head module-head">
        <div>
          <p className="eyebrow">
            <Swatch colour={m.colour} size={12} />
            <a href={href({ name: 'modules' })}>Modules</a>
            {m.code ? <span className="mono">{m.code}</span> : null}
            {m.archivedAt ? <span className="tag">Archived</span> : null}
          </p>
          <h1 className="page-title">{m.name}</h1>
          {m.description ? <p className="lede">{m.description}</p> : null}
        </div>
        <div className="page-actions">
          {!m.archivedAt ? (
            <a className="btn btn-primary" href={href({ name: 'upload', moduleId: m.id })}>
              <Icon name="plus" size={16} /> New quiz
            </a>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} /> Edit
          </button>
          <button type="button" className="btn btn-ghost" onClick={archive}>
            <Icon name="archive" size={16} /> {m.archivedAt ? 'Unarchive' : 'Archive'}
          </button>
          <button type="button" className="btn btn-ghost btn-danger" onClick={() => setDeleting(true)}>
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      </header>

      <dl className="stat-strip stat-strip-wide">
        <div>
          <dt>Quizzes</dt>
          <dd className="num">{m.quizCount}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd className="num">{fmtNumber(m.attemptCount)}</dd>
        </div>
        <div>
          <dt>Average</dt>
          <dd><Score value={m.average} /></dd>
        </div>
        <div>
          <dt>Latest</dt>
          <dd><Score value={m.latest} /></dd>
        </div>
        <div>
          <dt>Trend</dt>
          <dd><Trend value={m.trend} /></dd>
        </div>
        <div>
          <dt>Last studied</dt>
          <dd>{fmtRelative(m.lastStudied)}</dd>
        </div>
      </dl>

      <section className="section" aria-labelledby="q-h">
        <div className="section-head">
          <h2 id="q-h">Quizzes</h2>
          {archivedCount > 0 ? (
            <div className="section-tools">
              <Toggle checked={showArchivedQuizzes} onChange={setShowArchivedQuizzes} label={`Show ${archivedCount} archived`} />
            </div>
          ) : null}
        </div>
        {quizzes.length === 0 ? (
          <Empty
            title="No quizzes in this module yet."
            mark="file"
            action={
              !m.archivedAt ? (
                <a className="btn btn-secondary" href={href({ name: 'upload', moduleId: m.id })}>
                  Create a quiz
                </a>
              ) : undefined
            }
          >
            Create a quiz of questions on this subject. <a href={href({ name: 'help', section: 'csv' })}>See the format.</a>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table-click table-roomy">
              <caption className="sr-only">Quizzes in {m.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Quiz</th>
                  <th scope="col" className="num-col">Questions</th>
                  <th scope="col" className="num-col">Attempts</th>
                  <th scope="col" className="num-col">Best</th>
                  <th scope="col" className="num-col">Latest</th>
                  <th scope="col" className="num-col">Average</th>
                  <th scope="col" className="num-col">Last taken</th>
                  <th scope="col"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {quizzes.map((q) => (
                  <tr key={q.id} onClick={() => go({ name: 'quiz', id: q.id })} className={q.archivedAt ? 'is-archived' : ''}>
                    <td>
                      <a className="quiz-name" href={href({ name: 'quiz', id: q.id })} onClick={(e) => e.stopPropagation()}>
                        {q.title}
                      </a>
                      <span className="faint num quiz-v">v{q.versionNo}</span>
                      {q.archivedAt ? <span className="tag">Archived</span> : null}
                      {q.inProgressAttemptId ? <span className="tag tag-live">Unfinished</span> : null}
                    </td>
                    <td className="num-col num">{q.questionCount}</td>
                    <td className="num-col num">{q.attemptCount}</td>
                    <td className="num-col"><Score value={q.best} /></td>
                    <td className="num-col"><Score value={q.latest} /></td>
                    <td className="num-col"><Score value={q.average} /></td>
                    <td className="num-col nowrap muted">{fmtRelative(q.lastAttempted)}</td>
                    <td className="td-action">
                      <a
                        className="btn btn-sm btn-secondary"
                        href={href({ name: 'quiz', id: q.id })}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {q.inProgressAttemptId ? 'Resume' : 'Start'}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MaterialsSection moduleId={m.id} archived={!!m.archivedAt} />

      <section className="section" aria-labelledby="t-h">
        <div className="section-head">
          <h2 id="t-h">Performance</h2>
        </div>
        {data.series.length > 0 ? (
          <LineChart points={data.series} height={260} label={`Scores in ${m.name} over time`} onOpen={(aid) => go({ name: 'result', id: aid })} />
        ) : (
          <Empty title="No finished attempts in this module." mark="clock">
            Your scores will be plotted here.
          </Empty>
        )}
      </section>

      <div className="split split-3">
        <section className="section" aria-labelledby="wq-h">
          <div className="section-head">
            <h2 id="wq-h" className="h-small">Weakest quizzes</h2>
          </div>
          {data.weakestQuizzes.length ? (
            <ol className="rank">
              {data.weakestQuizzes.map((q) => (
                <li key={q.id}>
                  <a href={href({ name: 'quiz', id: q.id })}>{q.title}</a>
                  <Score value={q.average} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted small">Take a quiz to see which ones score lowest.</p>
          )}
        </section>
        <section className="section" aria-labelledby="wt-h">
          <div className="section-head">
            <h2 id="wt-h" className="h-small">Weakest topics</h2>
          </div>
          {data.topics.length ? (
            <ol className="rank">
              {data.topics.slice(0, 5).map((t) => (
                <li key={t.topic}>
                  <span>{t.topic}</span>
                  <Score value={t.percentage} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted small">Add a topic column to your CSV to see topic scores.</p>
          )}
        </section>
        <section className="section" aria-labelledby="wqs-h">
          <div className="section-head">
            <h2 id="wqs-h" className="h-small">Most-missed questions</h2>
          </div>
          {data.missed.length ? (
            <ol className="rank rank-questions">
              {data.missed.slice(0, 5).map((q, i) => (
                <li key={i}>
                  <RichText text={q.prompt.length > 110 ? `${q.prompt.slice(0, 107)}…` : q.prompt} />
                  <span className="num bad nowrap">
                    {q.missed}/{q.seen}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted small">Nothing missed yet.</p>
          )}
        </section>
      </div>

      {data.topicTime.length ? (
        <section className="section" aria-labelledby="tt-h">
          <div className="section-head">
            <h2 id="tt-h">Time by topic</h2>
          </div>
          <HBars
            label={`Seconds per question in each topic of ${m.name}`}
            rows={data.topicTime.map((t) => ({
              key: t.topic,
              label: t.topic,
              sub: `${Math.round(t.accuracy)}% right · ${t.answered} answered`,
              value: t.perQuestion,
              display: `${t.perQuestion}s each`,
              tone: t.accuracy >= 70 ? 'good' : t.accuracy < 50 ? 'bad' : 'ink'
            }))}
          />
          <p className="viz-note">Average active seconds per question. Long bars in red are where time goes without paying off.</p>
        </section>
      ) : null}

      <section className="section" aria-labelledby="a-h">
        <div className="section-head">
          <h2 id="a-h">Attempts</h2>
          <div className="section-tools">
            <a className="btn btn-ghost btn-sm" href={href({ name: 'history', moduleId: m.id, quizId: null })}>
              Filter in History <Icon name="arrowRight" size={16} />
            </a>
          </div>
        </div>
        {data.attempts.length ? (
          <AttemptsTable rows={data.attempts} columns={['when', 'quiz', 'version', 'attempt', 'score', 'mark', 'time']} caption={`Attempts in ${m.name}`} />
        ) : (
          <Empty title="No attempts yet." mark="clock" />
        )}
      </section>

      {editing ? (
        <ModuleDialog
          open
          existing={m}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            toast('Module saved.', 'good')
            reload()
          }}
        />
      ) : null}

      <Dialog
        open={deleting}
        onClose={() => {
          setDeleting(false)
          setConfirm('')
        }}
        title={`Delete ${m.name}?`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger-solid" disabled={confirm.trim() !== m.name || busy} onClick={remove}>
              Delete permanently
            </button>
          </>
        }
      >
        <p>
          This removes the module, its {m.quizCount === 1 ? 'quiz' : `${m.quizCount} quizzes`} and{' '}
          {m.attemptCount === 1 ? 'one attempt' : `all ${m.attemptCount} attempts`}. Tally saves a backup first, but
          the module will disappear from the app. To keep it out of sight without losing anything, archive it instead.
        </p>
        <Field label={`Type “${m.name}” to confirm`} htmlFor="del-confirm">
          <input id="del-confirm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </Field>
      </Dialog>
    </div>
  )
}
