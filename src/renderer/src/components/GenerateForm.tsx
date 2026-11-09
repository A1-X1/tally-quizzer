import { useEffect, useState } from 'react'
import type { AiStatus, Difficulty, GenerateFormat, GenerateResult, GenerationInfo, MaterialRow, SourceFile } from '../../../shared/types'
import { addDroppedMaterials } from './Materials'
import { api, errorMessage } from '../api'
import { AiConnection } from './AiSetup'
import { Icon } from './Icon'
import { ErrorNote, Field, Segmented } from './ui'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const STAGES = ['Reading your material', 'Writing questions', 'Checking every question against the rules', 'Almost there']

export interface GenerateBase {
  quizId: number
  title: string
  extend: boolean
  generation: GenerationInfo | null
}

export function GenerateForm({
  moduleId,
  preselected = [],
  base = null,
  onGenerated
}: {
  moduleId: number
  preselected?: number[]
  base?: GenerateBase | null
  onGenerated: (r: GenerateResult) => void
}) {
  const g = base?.generation ?? null
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [topic, setTopic] = useState(g?.topic ?? (base ? base.title : ''))
  const [format, setFormat] = useState<GenerateFormat>(g?.format ?? 'choice')
  const [count, setCount] = useState(base?.extend ? 5 : (g?.count ?? 10))
  const [difficulty, setDifficulty] = useState<Difficulty>(g?.difficulty ?? 'mixed')
  const [instructions, setInstructions] = useState(g?.instructions ?? '')
  const [library, setLibrary] = useState<MaterialRow[] | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(
    () => new Set(preselected.length ? preselected : (g?.materials.filter((m) => m.available && m.materialId !== null).map((m) => m.materialId as number) ?? []))
  )
  const [saveToModule, setSaveToModule] = useState(true)
  const [sources, setSources] = useState<SourceFile[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    api('ai:status').then(setStatus).catch(() => undefined)
  }, [])

  const loadLibrary = (): void => {
    api('materials:list', { moduleId })
      .then(setLibrary)
      .catch(() => setLibrary([]))
  }
  useEffect(loadLibrary, [moduleId])

  const toggle = (id: number): void =>
    setChosen((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

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
      if (saveToModule) {
        const r = await addDroppedMaterials(moduleId, files)
        setChosen((c) => new Set([...c, ...r.added.map((m) => m.id)]))
        if (r.problems.length) setError(r.problems.join(' '))
        loadLibrary()
        return
      }
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
      if (saveToModule) {
        const r = await api('materials:pick', { moduleId })
        setChosen((c) => new Set([...c, ...r.added.map((m) => m.id)]))
        if (r.problems.length) setError(r.problems.join(' '))
        loadLibrary()
        return
      }
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
        sourceTokens: sources.map((s) => s.token),
        materialIds: [...chosen].filter((id) => library?.some((m) => m.id === id)),
        extendQuizId: base?.extend ? base.quizId : null
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

  const picked = (library ?? []).filter((m) => chosen.has(m.id))
  const totalChars = sources.reduce((s, x) => s + x.chars, 0) + picked.reduce((s, x) => s + x.chars, 0)
  const anyMaterial = picked.length + sources.length > 0
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / 12))]

  return (
    <div className="generate" aria-busy={busy}>
      {base ? (
        <div className="gen-banner" role="status">
          <Icon name="info" size={16} />
          <span>
            {base.extend ? (
              <>
                Adding new questions to <strong>{base.title}</strong>. Its current questions are kept and the AI is told not to
                repeat them; you save the result as the next version.
              </>
            ) : (
              <>
                Writing a fresh set of questions for <strong>{base.title}</strong>, saved as its next version. Past attempts keep
                the questions they were taken on.
              </>
            )}
          </span>
        </div>
      ) : null}
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
        {library && library.length ? (
          <>
            <div className="material-pick-tools">
              <span className="faint small">From this module:</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(new Set(library.map((m) => m.id)))}>
                All
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(new Set(library.filter((m) => m.usedBy === 0).map((m) => m.id)))}>
                Not quizzed yet
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(new Set())}>
                None
              </button>
            </div>
            <ul className="material-pick-list" aria-label="Module materials">
              {library.map((m) => (
                <li key={m.id}>
                  <label className="material-pick">
                    <input type="checkbox" checked={chosen.has(m.id)} onChange={() => toggle(m.id)} />
                    <span className="material-pick-name">
                      <span>{m.label}</span>
                      <span className="faint small clamp-1">{m.filename}</span>
                    </span>
                    {m.usedBy === 0 ? <span className="tag tag-live">New</span> : <span className="faint small">used {m.usedBy}×</span>}
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : null}
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
          <p>{library && library.length ? 'Add more:' : 'Drop PDFs, Word documents, PowerPoint slides or text files here, or'}</p>
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
        <label className="save-to-module">
          <input type="checkbox" checked={saveToModule} onChange={(e) => setSaveToModule(e.target.checked)} />
          <span>Save new files to this module’s materials, so they can be used again</span>
        </label>
        <p className="field-hint">
          {anyMaterial
            ? `Questions will be based only on the ${picked.length + sources.length === 1 ? 'chosen file' : `${picked.length + sources.length} chosen files`}${totalChars > 150_000 ? '; together they are long, so the first part of each is used' : ''}.`
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
          <Icon name="play" size={16} /> {busy ? 'Generating…' : base?.extend ? `Add ${count} questions` : `Generate ${count} questions`}
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
