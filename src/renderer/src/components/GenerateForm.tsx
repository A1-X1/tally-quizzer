import { useEffect, useState } from 'react'
import type { AiStatus, Difficulty, GenerateFormat, GenerateResult, SourceFile } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { AiConnection } from './AiSetup'
import { Icon } from './Icon'
import { ErrorNote, Field, Segmented } from './ui'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const STAGES = ['Reading your material', 'Writing questions', 'Checking every question against the rules', 'Almost there']

export function GenerateForm({ moduleId, onGenerated }: { moduleId: number; onGenerated: (r: GenerateResult) => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [topic, setTopic] = useState('')
  const [format, setFormat] = useState<GenerateFormat>('choice')
  const [count, setCount] = useState(10)
  const [difficulty, setDifficulty] = useState<Difficulty>('mixed')
  const [instructions, setInstructions] = useState('')
  const [sources, setSources] = useState<SourceFile[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    api('ai:status').then(setStatus).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  const addFiles = async (files: File[]): Promise<void> => {
    setError(null)
    setAdding(true)
    try {
      for (const f of files.slice(0, 10 - sources.length)) {
        if (f.size > MAX_FILE_BYTES) throw new Error(`“${f.name}” is larger than 25 MB.`)
        const s = await api('ai:addSource', { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
        setSources((x) => [...x, s])
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setAdding(false)
    }
  }

  const pick = async (): Promise<void> => {
    setError(null)
    setAdding(true)
    try {
      const picked = await api('ai:pickSources')
      setSources((x) => [...x, ...picked].slice(0, 10))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setAdding(false)
    }
  }

  const generate = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await api('ai:generate', {
        moduleId,
        topic,
        count,
        difficulty,
        format,
        instructions: instructions.trim() || null,
        sourceTokens: sources.map((s) => s.token)
      })
      onGenerated(r)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  if (!status.configured) {
    return (
      <div className="generate generate-setup">
        <p className="lede-sm">
          To generate quizzes inside Tally, add an OpenRouter key. It takes about two minutes, and free models are
          available. Or use the AI chat you already have, then import the file: see{' '}
          <a href="#/help/ai">Help</a>.
        </p>
        <AiConnection onChange={setStatus} />
      </div>
    )
  }

  const totalChars = sources.reduce((s, x) => s + x.chars, 0)
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / 12))]

  return (
    <div className="generate" aria-busy={busy}>
      <Field label="What is the quiz about?" htmlFor="gen-topic" hint="Be specific: the course, the chapter, and what you need to be able to do.">
        <textarea
          id="gen-topic"
          className="input textarea"
          rows={3}
          maxLength={2000}
          placeholder="e.g. Week 4 of Cell Biology: membrane transport, osmosis and active transport. Focus on explaining the differences."
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          data-testid="gen-topic"
        />
      </Field>

      <div className="field">
        <span className="field-label">Study material (optional, more accurate)</span>
        <div
          className={dragging ? 'dropzone dropzone-sm is-over' : 'dropzone dropzone-sm'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void addFiles([...e.dataTransfer.files])
          }}
        >
          <p>Drop PDFs, Word documents, PowerPoint slides or text files here, or</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={pick} disabled={adding || busy || sources.length >= 10}>
            <Icon name="plus" size={14} /> {adding ? 'Reading…' : 'Add files…'}
          </button>
        </div>
        {sources.length ? (
          <ul className="source-list">
            {sources.map((s) => (
              <li key={s.token}>
                <Icon name="file" size={16} />
                <span className="source-name">{s.name}</span>
                <span className="faint small num">{Math.max(1, Math.round(s.chars / 1000))}k characters</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${s.name}`}
                  onClick={() => {
                    void api('ai:dropSource', { token: s.token })
                    setSources((x) => x.filter((y) => y.token !== s.token))
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="field-hint">
          {sources.length
            ? `Questions will be based only on these files${totalChars > 150_000 ? '; they are long, so the first part of each is used' : ''}.`
            : 'With files, every question and answer is taken from your material, not general knowledge.'}
        </p>
      </div>

      <div className="gen-options">
        <div className="gen-option">
          <span className="field-label">Questions</span>
          <Segmented
            label="Question format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'choice', label: 'Multiple choice' },
              { value: 'mixed', label: 'Mixed' },
              { value: 'written', label: 'Written only' }
            ]}
          />
        </div>
        <div className="gen-option">
          <span className="field-label">Difficulty</span>
          <Segmented
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
              { value: 'mixed', label: 'Mixed' }
            ]}
          />
        </div>
        <label className="gen-option gen-count">
          <span className="field-label">How many</span>
          <span className="count-row">
            <input type="range" min={3} max={40} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of questions" />
            <span className="num count-value">{count}</span>
          </span>
        </label>
      </div>
      {format !== 'choice' ? (
        <p className="field-hint">
          Written questions come with a model answer and a point-by-point mark scheme. They are marked
          {status.aiMarking ? ' by the AI against that scheme' : ' by you against that scheme'}; you can change any mark.
        </p>
      ) : null}

      <Field label="Anything else? (optional)" htmlFor="gen-extra">
        <input
          id="gen-extra"
          className="input"
          maxLength={2000}
          placeholder="e.g. Include two calculation questions. Use British spelling."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="gen-actions">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={generate}
          disabled={busy || topic.trim().length < 3}
          data-testid="generate"
        >
          <Icon name="play" size={16} /> {busy ? 'Generating…' : `Generate ${count} questions`}
        </button>
        <span className="faint small">
          Model: <span className="mono">{status.model ?? 'not chosen'}</span> · <a href="#/settings">change</a>
        </span>
      </div>
      {busy ? (
        <div className="gen-progress" role="status">
          <span className="gen-bar" aria-hidden="true" />
          <span>
            {stage}… <span className="num faint">{elapsed}s</span>
          </span>
          <span className="faint small">Free models can take a minute or two.</span>
        </div>
      ) : null}
    </div>
  )
}
