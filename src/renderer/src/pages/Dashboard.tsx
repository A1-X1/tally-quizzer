import { useState } from 'react'
import type { Dashboard as DashboardData, DateRange } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { AttemptsTable } from '../components/AttemptsTable'
import { Icon } from '../components/Icon'
import { LineChart } from '../components/LineChart'
import { ModuleDialog, nextColour } from '../components/ModuleForm'
import { RichText } from '../components/RichText'
import { Empty, ErrorNote, Loading, Score, Segmented, Swatch, Trend, useLoad, useToast } from '../components/ui'
import { fmtDuration, fmtNumber, fmtPct, fmtRelative, plural } from '../lib/format'
import { go, href } from '../lib/router'

const RANGES: { value: DateRange; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: 'Year' },
  { value: 'all', label: 'All time' }
]

function Headline({ d }: { d: DashboardData }) {
  const h = d.headline
  if (h.kind === 'empty') {
    return (
      <h1 className="headline">
        Your quizzes are ready.
        <br />
        <span className="muted">Take one to start the tally.</span>
      </h1>
    )
  }
  const avg = <mark className="hl num-display">{fmtPct(h.average)}</mark>
  if (h.kind === 'recent-with-change' && h.change !== null) {
    const ch = Math.round(h.change)
    const tail =
      ch === 0 ? (
        <>level with the month before.</>
      ) : (
        <>
          <span className={ch > 0 ? 'good' : 'bad'}>
            {ch > 0 ? 'up' : 'down'} {plural(Math.abs(ch), 'point')}
          </span>{' '}
          on the month before.
        </>
      )
    return (
      <h1 className="headline">
        You’ve averaged {avg} over the last 30 days, {tail}
      </h1>
    )
  }
  if (h.kind === 'recent') {
    return (
      <h1 className="headline">
        You’ve averaged {avg} across {plural(h.attemptsInWindow, 'attempt')} in the last 30 days.
      </h1>
    )
  }
  return (
    <h1 className="headline">
      Your last attempt was {h.daysSinceLast === 1 ? 'yesterday' : `${h.daysSinceLast} days ago`}. Overall you
      average {avg}.
    </h1>
  )
}

function FirstRun({ onChanged, hasModule }: { onChanged: () => void; hasModule: boolean }) {
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const trySample = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await api('import:sample')
      go({ name: 'quiz', id: r.quizId })
    } catch (e) {
      toast(errorMessage(e), 'bad')
      setBusy(false)
    }
  }
  return (
    <div className="page firstrun">
      <h1 className="headline">
        Nothing counted yet.
        <br />
        <span className="muted">Start with a module.</span>
      </h1>
      <p className="lede">
        A module is a subject or course, like <em>Linear Algebra</em> or <em>Organic Chemistry</em>. Upload quizzes on
        the same topic into it, and Tally tracks how each one goes over time.
      </p>
      <div className="firstrun-actions">
        {hasModule ? (
          <a className="btn btn-primary btn-lg" href={href({ name: 'upload', moduleId: null })}>
            <Icon name="upload" size={18} /> Upload a quiz
          </a>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} /> Create a module
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-lg" onClick={trySample} disabled={busy} data-testid="try-sample">
          <Icon name="play" size={16} /> Try the sample quiz
        </button>
      </div>
      <ol className="steps">
        <li>
          <span className="step-n num">1</span>
          <div>
            <p className="step-title">Create a module</p>
            <p className="muted">Give it a name, an optional course code and a colour.</p>
          </div>
        </li>
        <li>
          <span className="step-n num">2</span>
          <div>
            <p className="step-title">Upload a quiz as CSV</p>
            <p className="muted">
              Five options per question, one answer or several.{' '}
              <a href={href({ name: 'help', section: 'ai' })}>Have an AI write one from your notes.</a>
            </p>
          </div>
        </li>
        <li>
          <span className="step-n num">3</span>
          <div>
            <p className="step-title">Take it, then take it again</p>
            <p className="muted">Every answer and every second is recorded, so the weak spots show up here.</p>
          </div>
        </li>
      </ol>
      {creating ? <ModuleDialog
        open
        onClose={() => setCreating(false)}
        suggestedColour="cobalt"
        onSaved={(m) => {
          setCreating(false)
          toast(`Created ${m.name}.`, 'good')
          onChanged()
          go({ name: 'upload', moduleId: m.id })
        }}
      /> : null}
    </div>
  )
}

export function Dashboard() {
  const [moduleId, setModuleId] = useState<number | null>(null)
  const [range, setRange] = useState<DateRange>('90d')
  const { data, error, reload } = useLoad(() => api('stats:dashboard', { moduleId, range }), [moduleId, range])
  const [creating, setCreating] = useState(false)
  const toast = useToast()

  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>
  if (!data) return <Loading />

  if (!data.hasAnyQuiz && data.recent.length === 0) {
    return <FirstRun onChanged={reload} hasModule={data.hasAnyModule} />
  }

  const t = data.totals
  return (
    <div className="page dashboard">
      <header className="dash-head">
        <Headline d={data} />
        <dl className="stat-strip" aria-label="Totals">
          <div>
            <dt>Attempts</dt>
            <dd className="num">{fmtNumber(t.attempts)}</dd>
          </div>
          <div>
            <dt>Questions answered</dt>
            <dd className="num">{fmtNumber(t.questionsAnswered)}</dd>
          </div>
          <div>
            <dt>Time studied</dt>
            <dd className="num">{fmtDuration(t.secondsStudied)}</dd>
          </div>
          <div>
            <dt>Modules</dt>
            <dd className="num">{fmtNumber(data.modules.length)}</dd>
          </div>
        </dl>
      </header>

      {data.inProgress.length > 0 ? (
        <section className="resume" aria-label="Unfinished attempts">
          {data.inProgress.slice(0, 2).map((a) => (
            <div className="resume-row" key={a.id} data-testid="resume-card">
              <span className="resume-tag">{a.isPractice ? 'Unfinished practice' : 'Unfinished'}</span>
              <div className="resume-what">
                <span className="resume-title">{a.quizTitle}</span>
                <span className="muted">
                  <Swatch colour={a.moduleColour} /> {a.moduleName} · started {fmtRelative(a.startedAt).toLowerCase()} ·{' '}
                  {fmtDuration(a.durationSeconds)} so far
                </span>
              </div>
              <a className="btn btn-primary" href={href({ name: 'attempt', id: a.id })}>
                Resume <Icon name="arrowRight" size={16} />
              </a>
            </div>
          ))}
        </section>
      ) : null}

      <section className="section" aria-labelledby="chart-h">
        <div className="section-head">
          <h2 id="chart-h">Score over time</h2>
          <div className="section-tools">
            <label className="select-wrap">
              <span className="sr-only">Module</span>
              <select className="select" value={moduleId ?? ''} onChange={(e) => setModuleId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">All modules</option>
                {data.modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={16} />
            </label>
            <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
          </div>
        </div>
        {data.series.length > 0 ? (
          <LineChart
            points={data.series}
            height={320}
            label="Percentage score of each attempt over time"
            onOpen={(id) => go({ name: 'result', id })}
          />
        ) : (
          <Empty title="No attempts in this range." mark="clock">
            {range !== 'all' ? 'Try a longer range, or ' : ''}finish a quiz to plot your first point.
          </Empty>
        )}
      </section>

      <div className="split">
        <section className="section" aria-labelledby="mods-h">
          <div className="section-head">
            <h2 id="mods-h">Modules</h2>
            <div className="section-tools">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} /> New module
              </button>
            </div>
          </div>
          {data.modules.length > 0 ? (
            <div className="table-wrap">
              <table className="table table-click">
                <caption className="sr-only">Modules</caption>
                <thead>
                  <tr>
                    <th scope="col">Module</th>
                    <th scope="col" className="num-col">Attempts</th>
                    <th scope="col" className="num-col">Average</th>
                    <th scope="col" className="num-col">Latest</th>
                    <th scope="col" className="num-col">Trend</th>
                    <th scope="col" className="num-col">Studied</th>
                  </tr>
                </thead>
                <tbody>
                  {data.modules.map((m) => (
                    <tr key={m.id} onClick={() => go({ name: 'module', id: m.id })}>
                      <td className="cell-module">
                        <Swatch colour={m.colour} />
                        <a href={href({ name: 'module', id: m.id })} onClick={(e) => e.stopPropagation()}>
                          {m.name}
                        </a>
                        {m.code ? <span className="faint mono code-tag">{m.code}</span> : null}
                      </td>
                      <td className="num-col num">{m.attemptCount}</td>
                      <td className="num-col"><Score value={m.average} /></td>
                      <td className="num-col"><Score value={m.latest} /></td>
                      <td className="num-col"><Trend value={m.trend} /></td>
                      <td className="num-col nowrap muted">{m.lastStudied ? fmtRelative(m.lastStudied) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No modules yet." action={<button className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>Create a module</button>} />
          )}
        </section>

        <section className="section needs" aria-labelledby="needs-h">
          <div className="section-head">
            <h2 id="needs-h">Needs work</h2>
          </div>
          {data.topics.length === 0 && data.missed.length === 0 ? (
            <Empty title="Nothing flagged yet." mark="check">
              Questions you miss and topics that score lowest will gather here.
            </Empty>
          ) : (
            <>
              {data.topics.length > 0 ? (
                <div className="needs-block">
                  <h3 className="mini-h">Lowest-scoring topics</h3>
                  <ul className="bars">
                    {data.topics.map((tp) => (
                      <li key={`${tp.moduleId}-${tp.topic}`}>
                        <div className="bar-label">
                          <span>{tp.topic}</span>
                          <span className="faint">{tp.moduleName}</span>
                        </div>
                        <div className="bar-track" aria-hidden="true">
                          <span className={`bar-fill bar-${tp.percentage >= 70 ? 'good' : tp.percentage >= 50 ? 'mid' : 'low'}`} style={{ width: `${Math.max(2, tp.percentage)}%` }} />
                        </div>
                        <Score value={tp.percentage} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.missed.length > 0 ? (
                <div className="needs-block">
                  <h3 className="mini-h">Most-missed questions</h3>
                  <ol className="missed">
                    {data.missed.map((q, i) => (
                      <li key={i}>
                        <a href={href({ name: 'quiz', id: q.quizId })} className="missed-prompt">
                          <RichText text={q.prompt.length > 140 ? `${q.prompt.slice(0, 137)}…` : q.prompt} />
                        </a>
                        <span className="missed-meta">
                          <span className="num bad">
                            {q.missed}/{q.seen}
                          </span>{' '}
                          missed · {q.quizTitle}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <section className="section" aria-labelledby="recent-h">
        <div className="section-head">
          <h2 id="recent-h">Recent attempts</h2>
          <div className="section-tools">
            <a className="btn btn-ghost btn-sm" href={href({ name: 'history', moduleId: null, quizId: null })}>
              Full history <Icon name="arrowRight" size={16} />
            </a>
          </div>
        </div>
        {data.recent.length > 0 ? (
          <AttemptsTable rows={data.recent} columns={['when', 'quiz', 'module', 'attempt', 'score', 'mark', 'time']} caption="Recent attempts" />
        ) : (
          <Empty title="No finished attempts yet." mark="clock">
            Open a module and start a quiz. Finished attempts are listed here.
          </Empty>
        )}
      </section>

      {creating ? <ModuleDialog
        open
        onClose={() => setCreating(false)}
        suggestedColour={nextColour(data.modules.map((m) => m.colour))}
        onSaved={(m) => {
          setCreating(false)
          toast(`Created ${m.name}.`, 'good')
          reload()
        }}
      /> : null}
    </div>
  )
}
