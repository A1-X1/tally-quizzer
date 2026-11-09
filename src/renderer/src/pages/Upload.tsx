import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_CSV_BYTES } from '../../../shared/api'
import type { GenerateResult, ImportPreview, ModuleRow } from '../../../shared/types'
import { GenerateForm, type GenerateBase } from '../components/GenerateForm'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { ModuleDialog, nextColour } from '../components/ModuleForm'
import { QuestionPreview } from '../components/QuestionView'
import { Empty, ErrorNote, Field, Loading, Swatch, useLoad, useToast } from '../components/ui'
import { fmtMarks, plural } from '../lib/format'
import { go, href } from '../lib/router'

type Loaded = { filename: string; text: string }

export function UploadPage({
  initialModule,
  materialIds = [],
  quizId = null,
  extend = false
}: {
  initialModule: number | null
  materialIds?: number[]
  quizId?: number | null
  extend?: boolean
}) {
  const [base, setBase] = useState<GenerateBase | null>(null)
  useEffect(() => {
    if (!quizId) return
    api('quizzes:detail', { id: quizId })
      .then((d) => setBase({ quizId: d.quiz.id, title: d.quiz.title, extend, generation: d.generation }))
      .catch(() => setBase(null))
  }, [quizId, extend])
  const { data: modules, reload } = useLoad(() => api('modules:list', { includeArchived: false }), [])
  const [moduleId, setModuleId] = useState<number | null>(initialModule)
  const [file, setFile] = useState<Loaded | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'version' | 'separate'>('version')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [creating, setCreating] = useState(false)
  const [method, setMethod] = useState<'ai' | 'file' | null>(materialIds.length || quizId ? 'ai' : null)
  const [aiInfo, setAiInfo] = useState<GenerateResult | null>(null)
  const toast = useToast()
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (modules && moduleId === null && modules.length === 1) setModuleId(modules[0].id)
  }, [modules, moduleId])

  // Re-validate whenever the file or the target module changes. Nothing is saved here.
  useEffect(() => {
    if (!file || !moduleId) {
      setPreview(null)
      return
    }
    let live = true
    setBusy(true)
    setError(null)
    api('import:preview', { moduleId, filename: file.filename, text: file.text })
      .then((p) => {
        if (!live) return
        setPreview(p)
        setTitle(p.suggestedTitle)
        setMode('version')
      })
      .catch((e: unknown) => live && setError(errorMessage(e)))
      .finally(() => live && setBusy(false))
    return () => {
      live = false
    }
  }, [file, moduleId])

  const titleMatch = useMemo(() => {
    if (!preview) return null
    const t = title.trim().toLowerCase()
    return preview.moduleQuizzes.find((q) => q.title.toLowerCase() === t) ?? null
  }, [preview, title])

  const accept = async (f: File): Promise<void> => {
    setError(null)
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setError(`“${f.name}” is not a CSV file. Export your spreadsheet as CSV (UTF-8) and try again.`)
      return
    }
    if (f.size > MAX_CSV_BYTES) {
      setError(`“${f.name}” is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB. Split it into smaller quizzes.`)
      return
    }
    setFile({ filename: f.name, text: await f.text() })
  }

  const choose = async (): Promise<void> => {
    setError(null)
    try {
      const r = await api('import:pickFile')
      if (r) setFile(r)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const save = async (): Promise<void> => {
    if (!preview || !file || !moduleId) return
    setBusy(true)
    setError(null)
    try {
      const asVersion = titleMatch !== null && mode === 'version'
      const res = await api('import:commit', {
        moduleId,
        filename: file.filename,
        text: file.text,
        title,
        mode: asVersion ? 'version' : 'new',
        targetQuizId: asVersion ? titleMatch.quizId : null,
        generation: aiInfo && file.filename === aiInfo.filename && file.text === aiInfo.csv ? aiInfo.generation : null
      })
      toast(
        res.versionNo > 1 ? `Saved “${res.title}” as version ${res.versionNo}.` : `Imported “${res.title}”.`,
        'good'
      )
      go({ name: 'quiz', id: res.quizId })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  if (!modules) return <Loading />
  const mod: ModuleRow | undefined = modules.find((m) => m.id === moduleId)
  const separateClash = titleMatch !== null && mode === 'separate'

  return (
    <div className="page upload">
      <header className="page-head">
        <div>
          <h1 className="page-title">New quiz</h1>
          <p className="lede">
            Generate one from a topic and your notes, or import a CSV file. Nothing is saved until you have checked it.
          </p>
        </div>
      </header>

      <ol className="upload-steps">
        <li className="upload-step">
          <div className="upload-step-n num">1</div>
          <div className="upload-step-body">
            <h2 className="h-step">Module</h2>
            {modules.length === 0 ? (
              <Empty
                title="You need a module first."
                action={
                  <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                    <Icon name="plus" size={16} /> Create a module
                  </button>
                }
              >
                Quizzes live inside modules, one per subject.
              </Empty>
            ) : (
              <div className="module-picker" role="radiogroup" aria-label="Module">
                {modules.map((m) => (
                  <label key={m.id} className={m.id === moduleId ? 'module-pick is-on' : 'module-pick'}>
                    <input type="radio" name="module" checked={m.id === moduleId} onChange={() => setModuleId(m.id)} />
                    <Swatch colour={m.colour} size={10} />
                    <span>{m.name}</span>
                    {m.code ? <span className="mono faint">{m.code}</span> : null}
                  </label>
                ))}
                <button type="button" className="module-pick module-pick-new" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={14} /> New module
                </button>
              </div>
            )}
          </div>
        </li>

        <li className={moduleId ? 'upload-step' : 'upload-step is-disabled'}>
          <div className="upload-step-n num">2</div>
          <div className="upload-step-body">
            <h2 className="h-step">How</h2>
            <div className="method-cards" role="radiogroup" aria-label="How to create the quiz">
              <button
                type="button"
                role="radio"
                aria-checked={method === 'ai'}
                className={method === 'ai' ? 'method-card is-on' : 'method-card'}
                onClick={() => setMethod('ai')}
                data-testid="method-ai"
              >
                <span className="method-title">Generate with AI</span>
                <span className="method-body">Describe the topic, add notes or slides, choose multiple choice, written or mixed.</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={method === 'file'}
                className={method === 'file' ? 'method-card is-on' : 'method-card'}
                onClick={() => setMethod('file')}
                data-testid="method-file"
              >
                <span className="method-title">Import a file</span>
                <span className="method-body">
                  A CSV in Tally’s format, from a spreadsheet or an AI chat. <a href={href({ name: 'help', section: 'csv' })} onClick={(e) => e.stopPropagation()}>Format</a>
                </span>
              </button>
            </div>
            {method === 'ai' && moduleId && (!quizId || base) ? (
              <GenerateForm
                moduleId={moduleId}
                preselected={materialIds}
                base={base}
                onGenerated={(r) => {
                  setAiInfo(r)
                  setFile({ filename: r.filename, text: r.csv })
                }}
              />
            ) : null}
            {method === 'file' ? (
            <div
              ref={dropRef}
              className={dragging ? 'dropzone is-over' : 'dropzone'}
              onDragOver={(e) => {
                e.preventDefault()
                if (moduleId) setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files[0]
                if (f && moduleId) void accept(f)
              }}
            >
              <Icon name="file" size={26} weight={1.5} />
              <p>
                {file ? (
                  <>
                    <span className="mono">{file.filename}</span>
                    <span className="faint"> · {(new Blob([file.text]).size / 1024).toFixed(1)} KB</span>
                  </>
                ) : (
                  'Drag a CSV file here, or'
                )}
              </p>
              <button type="button" className="btn btn-secondary" onClick={choose} disabled={!moduleId || busy} data-testid="choose-csv">
                {file ? 'Choose a different file…' : 'Choose a file…'}
              </button>
            </div>
            ) : null}
          </div>
        </li>

        <li className={preview ? 'upload-step' : 'upload-step is-disabled'}>
          <div className="upload-step-n num">3</div>
          <div className="upload-step-body">
            <h2 className="h-step">Check and save</h2>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            {aiInfo && file && file.filename === aiInfo.filename ? (
              <div className="notice" role="status" data-testid="ai-generated">
                <Icon name="info" size={18} />
                <p>
                  {aiInfo.added !== null
                    ? `${aiInfo.added} new ${aiInfo.added === 1 ? 'question' : 'questions'} added to the existing ones, `
                    : 'Written '}
                  by <span className="mono">{aiInfo.model}</span> and checked against Tally’s rules.
                  {aiInfo.dropped ? ` ${aiInfo.dropped} ${aiInfo.dropped === 1 ? 'question that broke the rules was' : 'questions that broke the rules were'} left out.` : ''}
                  {aiInfo.truncated ? ' Your files were longer than the limit, so only the first part of each was used.' : ''} Read
                  the sample below before saving.
                </p>
              </div>
            ) : null}
            {busy && !preview ? <Loading label="Checking the file" /> : null}
            {preview && !preview.ok ? <ImportErrors preview={preview} /> : null}
            {preview && preview.ok ? (
              <div className="import-ok">
                <dl className="stat-strip">
                  <div>
                    <dt>Questions</dt>
                    <dd className="num">{preview.questionCount}</dd>
                  </div>
                  <div>
                    <dt>Total marks</dt>
                    <dd className="num">{fmtMarks(preview.totalMarks)}</dd>
                  </div>
                  <div>
                    <dt>Choose one</dt>
                    <dd className="num">{preview.singleCount}</dd>
                  </div>
                  <div>
                    <dt>Select all that apply</dt>
                    <dd className="num">{preview.multiCount}</dd>
                  </div>
                  {preview.writtenCount ? (
                    <div>
                      <dt>Written</dt>
                      <dd className="num">{preview.writtenCount}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Topics</dt>
                    <dd className="num">{preview.topics.length || '—'}</dd>
                  </div>
                </dl>
                {preview.topics.length ? <p className="muted small">Topics: {preview.topics.join(', ')}</p> : null}

                {preview.duplicateOf ? (
                  <div className="notice" role="status" data-testid="duplicate">
                    <Icon name="info" size={18} />
                    <p>
                      This exact file is already in {mod?.name ?? 'this module'} as{' '}
                      <a href={href({ name: 'quiz', id: preview.duplicateOf.quizId })}>“{preview.duplicateOf.title}”</a> (version{' '}
                      {preview.duplicateOf.versionNo}). Nothing new to import.
                    </p>
                  </div>
                ) : (
                  <>
                    <Field label="Quiz title" htmlFor="quiz-title">
                      <input
                        id="quiz-title"
                        className="input input-title"
                        value={title}
                        maxLength={200}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </Field>
                    {titleMatch ? (
                      <fieldset className="version-choice">
                        <legend>
                          A quiz called “{titleMatch.title}” is already in this module, with different questions.
                        </legend>
                        <label className={mode === 'version' ? 'choice is-on' : 'choice'}>
                          <input type="radio" name="vmode" checked={mode === 'version'} onChange={() => setMode('version')} />
                          <span>
                            <strong>Save as new version</strong>
                            <span className="muted">
                              Becomes version {titleMatch.versionNo + 1}. Past attempts keep pointing at the questions they were taken on.
                            </span>
                          </span>
                        </label>
                        <label className={mode === 'separate' ? 'choice is-on' : 'choice'}>
                          <input
                            type="radio"
                            name="vmode"
                            checked={mode === 'separate'}
                            onChange={() => {
                              setMode('separate')
                              setTitle(`${title.trim()} (2)`)
                            }}
                          />
                          <span>
                            <strong>Create separate quiz</strong>
                            <span className="muted">Keeps its own attempts and statistics. Give it a different title.</span>
                          </span>
                        </label>
                      </fieldset>
                    ) : null}
                    <div className="import-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-lg"
                        onClick={save}
                        disabled={busy || !title.trim() || separateClash}
                        data-testid="save-import"
                      >
                        {titleMatch && mode === 'version'
                          ? `Save as version ${titleMatch.versionNo + 1}`
                          : `Save ${plural(preview.questionCount, 'question')}`}
                      </button>
                      {separateClash ? <span className="muted small">Choose a title that isn’t already used.</span> : null}
                    </div>
                  </>
                )}

                <h3 className="mini-h">Sample questions</h3>
                <div className="sample-list">
                  {preview.sample.map((q) => (
                    <QuestionPreview key={q.row} q={q} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </li>
      </ol>

      {creating ? (
        <ModuleDialog
          open
          onClose={() => setCreating(false)}
          suggestedColour={nextColour(modules.map((m) => m.colour))}
          onSaved={(m) => {
            setCreating(false)
            reload()
            setModuleId(m.id)
            toast(`Created ${m.name}.`, 'good')
          }}
        />
      ) : null}
    </div>
  )
}

function ImportErrors({ preview }: { preview: ImportPreview }) {
  return (
    <div className="import-errors" data-testid="import-errors">
      <p className="import-errors-title">
        <Icon name="warning" size={18} />
        {plural(preview.errors.length, 'problem')} found. Nothing has been saved.
      </p>
      <div className="table-wrap">
        <table className="table table-dense">
          <caption className="sr-only">Problems in {preview.filename}</caption>
          <thead>
            <tr>
              <th scope="col" className="num-col">Row</th>
              <th scope="col">Column</th>
              <th scope="col">Problem</th>
              <th scope="col">How to fix it</th>
            </tr>
          </thead>
          <tbody>
            {preview.errors.map((e, i) => (
              <tr key={i}>
                <td className="num-col num">{e.row ?? '—'}</td>
                <td className="mono">{e.column ?? '—'}</td>
                <td>{e.message}</td>
                <td className="muted">{e.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Row numbers match your spreadsheet: the header is row 1. Fix the file, save it as CSV, and choose it again.
      </p>
    </div>
  )
}
