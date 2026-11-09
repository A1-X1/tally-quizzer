import { useMemo, useState } from 'react'
import type { HistoryFilter } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { AttemptsTable } from '../components/AttemptsTable'
import { Icon } from '../components/Icon'
import { Empty, ErrorNote, Loading, Toggle, useLoad, useToast } from '../components/ui'
import { fmtDuration, fmtPct, plural } from '../lib/format'

/** Convert a local yyyy-mm-dd to the UTC instant at local midnight. */
const startOfLocalDay = (d: string): string | null => (d ? new Date(`${d}T00:00:00`).toISOString() : null)
const endOfLocalDay = (d: string): string | null => {
  if (!d) return null
  const x = new Date(`${d}T00:00:00`)
  x.setDate(x.getDate() + 1)
  return x.toISOString()
}

export function HistoryPage({ initialModule, initialQuiz }: { initialModule: number | null; initialQuiz: number | null }) {
  const [moduleId, setModuleId] = useState<number | null>(initialModule)
  const [quizId, setQuizId] = useState<number | null>(initialQuiz)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [minScore, setMinScore] = useState('')
  const [maxScore, setMaxScore] = useState('')
  const [includePractice, setIncludePractice] = useState(false)
  const toast = useToast()

  const { data: modules } = useLoad(() => api('modules:list', { includeArchived: true }), [])
  const { data: quizzes } = useLoad(() => api('quizzes:all'), [])

  const filter: HistoryFilter = useMemo(() => {
    const num = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Math.max(0, Math.min(100, Number(s))))
    return {
      moduleId,
      quizId,
      from: startOfLocalDay(from),
      to: endOfLocalDay(to),
      minScore: num(minScore),
      maxScore: num(maxScore),
      includePractice
    }
  }, [moduleId, quizId, from, to, minScore, maxScore, includePractice])

  const { data: rows, error } = useLoad(() => api('history:list', filter), [filter])

  const quizOptions = (quizzes ?? []).filter((q) => moduleId === null || q.moduleId === moduleId)
  const official = (rows ?? []).filter((r) => !r.isPractice && r.percentage !== null)
  const avg = official.length ? official.reduce((s, r) => s + (r.percentage ?? 0), 0) / official.length : null
  const time = (rows ?? []).reduce((s, r) => s + r.durationSeconds, 0)
  const filtered = moduleId !== null || quizId !== null || from || to || minScore || maxScore || includePractice

  const exportCsv = async (): Promise<void> => {
    try {
      const r = await api('history:export', filter)
      if (r.saved) toast(`Exported ${plural(r.rows ?? 0, 'attempt')}.`, 'good')
    } catch (e) {
      toast(errorMessage(e), 'bad')
    }
  }

  const reset = (): void => {
    setModuleId(null)
    setQuizId(null)
    setFrom('')
    setTo('')
    setMinScore('')
    setMaxScore('')
    setIncludePractice(false)
  }

  return (
    <div className="page history">
      <header className="page-head">
        <div>
          <h1 className="page-title">History</h1>
          <p className="lede">
            {rows
              ? rows.length === 0
                ? 'No attempts match.'
                : `${plural(rows.length, 'attempt')}${avg !== null ? ` · ${fmtPct(avg)} average` : ''} · ${fmtDuration(time)} in total`
              : ' '}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={!rows || rows.length === 0}>
            <Icon name="download" size={16} /> Export CSV
          </button>
        </div>
      </header>

      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filter attempts">
        <label className="filter">
          <span className="filter-label">Module</span>
          <select
            className="select"
            value={moduleId ?? ''}
            onChange={(e) => {
              setModuleId(e.target.value ? Number(e.target.value) : null)
              setQuizId(null)
            }}
          >
            <option value="">All modules</option>
            {(modules ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.archivedAt ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="filter-label">Quiz</span>
          <select className="select" value={quizId ?? ''} onChange={(e) => setQuizId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All quizzes</option>
            {quizOptions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="filter-label">From</span>
          <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="filter">
          <span className="filter-label">To</span>
          <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="filter filter-range">
          <span className="filter-label" id="score-l">Score %</span>
          <div className="range-inputs" role="group" aria-labelledby="score-l">
            <input className="input input-num mono" inputMode="numeric" placeholder="0" aria-label="Minimum score" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
            <span className="faint">to</span>
            <input className="input input-num mono" inputMode="numeric" placeholder="100" aria-label="Maximum score" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
          </div>
        </div>
        <div className="filter filter-toggle">
          <Toggle checked={includePractice} onChange={setIncludePractice} label="Include practice" />
        </div>
        {filtered ? (
          <button type="button" className="btn btn-ghost btn-sm filter-reset" onClick={reset}>
            Clear filters
          </button>
        ) : null}
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title={filtered ? 'Nothing matches these filters.' : 'No attempts yet.'} mark="clock">
          {filtered ? 'Widen the dates or clear a filter.' : 'Finish a quiz and it will be recorded here, with every answer and timing.'}
        </Empty>
      ) : (
        <AttemptsTable
          rows={rows}
          columns={['when', 'module', 'quiz', 'version', 'attempt', 'score', 'mark', 'time', 'marking']}
          sortable
          caption="Attempt history"
        />
      )}
    </div>
  )
}
