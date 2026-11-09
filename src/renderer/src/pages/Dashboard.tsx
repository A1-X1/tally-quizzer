import { useState } from 'react'
import type { Dashboard as DashboardData, DashboardPatterns, DateRange } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { AttemptsTable } from '../components/AttemptsTable'
import { Icon } from '../components/Icon'
import { LineChart } from '../components/LineChart'
import { Bars, CountUp, Donut, HBars, Heatmap, Scatter } from '../components/Charts'
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
            <Icon name="plus" size={18} /> Create a quiz
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
            <p className="step-title">Create a quiz</p>
            <p className="muted">
              Generate one from your notes with AI, or import a CSV.{' '}
              <a href={href({ name: 'help', section: 'ai' })}>How it works.</a>
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
  const [scoreView, setScoreView] = useState<'line' | 'weekly' | 'spread'>('line')
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
            <dd className="num"><CountUp value={t.attempts} format={(n) => fmtNumber(Math.round(n))} /></dd>
          </div>
          <div>
            <dt>Questions answered</dt>
            <dd className="num"><CountUp value={t.questionsAnswered} format={(n) => fmtNumber(Math.round(n))} /></dd>
          </div>
          <div>
            <dt>Time studied</dt>
            <dd className="num"><CountUp value={t.secondsStudied} format={(n) => fmtDuration(n)} /></dd>
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
        <div className="format-row">
          <Segmented
            label="Chart format"
            value={scoreView}
            onChange={setScoreView}
            options={[
              { value: 'line', label: 'Every attempt' },
              { value: 'weekly', label: 'Weekly average' },
              { value: 'spread', label: 'Score spread' }
            ]}
          />
        </div>
        {scoreView === 'weekly' ? (
          <WeeklyScores p={data.patterns} key={`w-${moduleId}`} />
        ) : scoreView === 'spread' ? (
          <Spread p={data.patterns} key={`s-${moduleId}`} />
        ) : data.series.length > 0 ? (
          <LineChart
            key={`l-${moduleId}-${range}`}
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

      <TimeSections p={data.patterns} />

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

// ---------------------------------------------------------------------------
// Alternative formats for scores, and the time and pattern sections.

const weekTick = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

function WeeklyScores({ p }: { p: DashboardPatterns }) {
  if (p.weekly.every((w) => w.attempts === 0)) {
    return <Empty title="No finished attempts in the last twelve weeks." mark="clock" />
  }
  return (
    <>
      <Bars
        height={300}
        max={100}
        label="Average score per week over the last twelve weeks"
        valueFormat={(n) => `${Math.round(n)}`}
        bars={p.weekly.map((w, i) => ({
          key: w.weekStart,
          value: w.average,
          label: `Week of ${weekTick(w.weekStart)}: ${w.average === null ? 'no attempts' : `${w.average}% across ${w.attempts}`}`,
          tick: i % 2 === 0 || p.weekly.length < 8 ? weekTick(w.weekStart) : '',
          tone: w.average === null ? 'muted' : w.average >= 70 ? 'good' : w.average < 50 ? 'bad' : 'ink',
          tip: (
            <>
              <span className="chart-tip-score num">{w.average === null ? '—' : `${w.average}%`}</span>
              <span className="chart-tip-title">Week of {weekTick(w.weekStart)}</span>
              <span className="chart-tip-meta">
                {plural(w.attempts, 'attempt')} · {fmtDuration(w.seconds)} studied
              </span>
            </>
          )
        }))}
      />
      <p className="viz-note">Mean percentage of official attempts finished each week, Monday to Sunday.</p>
    </>
  )
}

function Spread({ p }: { p: DashboardPatterns }) {
  const total = p.distribution.reduce((a, b) => a + b, 0)
  if (total === 0) return <Empty title="No finished attempts yet." mark="clock" />
  return (
    <>
      <Bars
        height={300}
        label="How many attempts scored in each ten-point band"
        bars={p.distribution.map((n, i) => ({
          key: String(i),
          value: n,
          label: `${i * 10} to ${i === 9 ? 100 : i * 10 + 9} percent: ${n} attempts`,
          tick: `${i * 10}${i === 9 ? '+' : ''}`,
          tone: i >= 7 ? 'good' : i < 5 ? 'bad' : 'ink',
          tip: (
            <>
              <span className="chart-tip-score num">{plural(n, 'attempt')}</span>
              <span className="chart-tip-meta">
                scored {i * 10}–{i === 9 ? 100 : i * 10 + 9}% · {Math.round((n / total) * 100)}% of all
              </span>
            </>
          )
        }))}
      />
      <p className="viz-note">Every official attempt, grouped by score. Green bands are 70% and above; red are below 50%.</p>
    </>
  )
}

function TimeSections({ p }: { p: DashboardPatterns }) {
  const [heatMetric, setHeatMetric] = useState<'time' | 'attempts'>('time')
  const [moduleView, setModuleView] = useState<'bars' | 'donut'>('bars')
  const [topicView, setTopicView] = useState<'scatter' | 'table'>('scatter')
  const totalTime = p.timeByModule.reduce((s, m) => s + m.seconds, 0)
  const activeDays = p.activity.filter((d) => d.seconds > 0 || d.attempts > 0).length
  const slowest = [...p.topicTime].sort((a, b) => b.perQuestion - a.perQuestion)[0]
  return (
    <>
      <section className="section" aria-labelledby="time-h">
        <div className="section-head">
          <h2 id="time-h">Where your time goes</h2>
        </div>
        <div className="viz-grid">
          <div className="viz-cell anim-enter" style={{ '--i': 0 } as React.CSSProperties}>
            <div className="viz-head">
              <h3 className="mini-h">Last twelve weeks · {plural(activeDays, 'active day')}</h3>
              <Segmented
                label="Activity measure"
                value={heatMetric}
                onChange={setHeatMetric}
                options={[
                  { value: 'time', label: 'Time' },
                  { value: 'attempts', label: 'Attempts' }
                ]}
              />
            </div>
            <Heatmap days={p.activity} metric={heatMetric} key={heatMetric} />
          </div>
          <div className="viz-cell anim-enter" style={{ '--i': 1 } as React.CSSProperties}>
            <div className="viz-head">
              <h3 className="mini-h">Time by module · {fmtDuration(totalTime)}</h3>
              <Segmented
                label="Time by module format"
                value={moduleView}
                onChange={setModuleView}
                options={[
                  { value: 'bars', label: 'Bars' },
                  { value: 'donut', label: 'Share' }
                ]}
              />
            </div>
            {p.timeByModule.length === 0 ? (
              <Empty title="No time recorded yet." mark="clock" />
            ) : moduleView === 'bars' ? (
              <HBars
                key="bars"
                label="Time spent per module"
                rows={p.timeByModule.map((m) => ({
                  key: String(m.moduleId),
                  label: m.name,
                  sub: plural(m.attempts, 'attempt'),
                  value: m.seconds,
                  display: fmtDuration(m.seconds),
                  colour: `var(--mod-${m.colour})`
                }))}
              />
            ) : (
              <Donut
                key="donut"
                label="Share of study time per module"
                centre={{ value: fmtDuration(totalTime), caption: 'studied' }}
                slices={p.timeByModule.map((m) => ({
                  key: String(m.moduleId),
                  label: m.name,
                  value: m.seconds,
                  colour: `var(--mod-${m.colour})`,
                  display: fmtDuration(m.seconds)
                }))}
              />
            )}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="pat-h">
        <div className="section-head">
          <h2 id="pat-h">Time against accuracy</h2>
          <div className="section-tools">
            <Segmented
              label="Topic view"
              value={topicView}
              onChange={setTopicView}
              options={[
                { value: 'scatter', label: 'Chart' },
                { value: 'table', label: 'Table' }
              ]}
            />
          </div>
        </div>
        <div className="viz-grid viz-grid-wide">
          <div className="viz-cell">
            {p.topicTime.length === 0 ? (
              <Empty title="No topic data yet." mark="grid">
                Add a topic column to your quizzes to see which topics take longest.
              </Empty>
            ) : topicView === 'scatter' ? (
              <>
                <Scatter
                  key="scatter"
                  label="Each topic: average seconds per question against accuracy"
                  points={p.topicTime.map((t) => ({
                    key: `${t.moduleName}-${t.topic}`,
                    x: t.perQuestion,
                    y: t.accuracy,
                    label: t.topic,
                    sub: `${t.moduleName}, ${plural(t.answered, 'answer')}`,
                    size: t.answered
                  }))}
                />
                <p className="viz-note">
                  Each dot is a topic; bigger dots have more answers. Bottom-right is slow and still wrong, the best
                  place to revise.
                  {slowest ? ` ${slowest.topic} takes longest, at ${slowest.perQuestion}s a question.` : ''}
                </p>
              </>
            ) : (
              <table className="table table-dense anim-enter">
                <caption className="sr-only">Time and accuracy by topic</caption>
                <thead>
                  <tr>
                    <th scope="col">Topic</th>
                    <th scope="col">Module</th>
                    <th scope="col" className="num-col">Answered</th>
                    <th scope="col" className="num-col">Per question</th>
                    <th scope="col" className="num-col">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {p.topicTime.map((t) => (
                    <tr key={`${t.moduleName}-${t.topic}`}>
                      <td>{t.topic}</td>
                      <td className="muted">{t.moduleName}</td>
                      <td className="num-col num">{t.answered}</td>
                      <td className="num-col num">{t.perQuestion}s</td>
                      <td className="num-col"><Score value={t.accuracy} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="viz-cell">
            <h3 className="mini-h">Choose one versus select all</h3>
            {p.types.length === 0 ? (
              <p className="muted small">Answer some questions to compare.</p>
            ) : (
              <div className="type-compare">
                <HBars
                  label="Accuracy by question type"
                  max={100}
                  rows={p.types.map((t) => ({
                    key: `a-${t.type}`,
                    label: t.type === 'single' ? 'Choose one' : 'Select all',
                    sub: 'accuracy',
                    value: t.accuracy,
                    display: `${Math.round(t.accuracy)}%`,
                    tone: t.accuracy >= 70 ? 'good' : t.accuracy < 50 ? 'bad' : 'ink'
                  }))}
                />
                <HBars
                  label="Seconds per question by question type"
                  rows={p.types.map((t) => ({
                    key: `t-${t.type}`,
                    label: t.type === 'single' ? 'Choose one' : 'Select all',
                    sub: `${fmtNumber(t.answered)} answered`,
                    value: t.perQuestion,
                    display: `${t.perQuestion}s`,
                    tone: 'accent'
                  }))}
                />
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
