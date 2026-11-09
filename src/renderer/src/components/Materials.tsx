import { useEffect, useState } from 'react'
import type { MaterialRow } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { fmtBytes, fmtDate, plural } from '../lib/format'
import { href } from '../lib/router'
import { Icon } from './Icon'
import { Dialog, Empty, ErrorNote, useToast } from './ui'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const KIND: Record<string, string> = { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', md: 'Markdown', markdown: 'Markdown', txt: 'Text', csv: 'CSV', html: 'Web page', htm: 'Web page', rtf: 'RTF' }

export const kindLabel = (k: string): string => KIND[k] ?? k.toUpperCase()

/** Add dropped files to a module's materials, collecting any problems. */
export async function addDroppedMaterials(moduleId: number, files: File[]): Promise<{ added: MaterialRow[]; problems: string[] }> {
  const added: MaterialRow[] = []
  const problems: string[] = []
  for (const f of files.slice(0, 20)) {
    try {
      if (f.size > MAX_FILE_BYTES) throw new Error(`“${f.name}” is larger than 25 MB.`)
      added.push(await api('materials:add', { moduleId, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))
    } catch (e) {
      problems.push(errorMessage(e))
    }
  }
  return { added, problems }
}

/** The module's library of study material: added week by week, used to generate quizzes. */
export function MaterialsSection({ moduleId, archived }: { moduleId: number; archived: boolean }) {
  const [list, setList] = useState<MaterialRow[] | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [label, setLabel] = useState('')
  const [removing, setRemoving] = useState<MaterialRow | null>(null)
  const toast = useToast()

  const load = (): void => {
    api('materials:list', { moduleId })
      .then(setList)
      .catch((e: unknown) => setProblems([errorMessage(e)]))
  }
  useEffect(load, [moduleId])

  const afterAdd = (r: { added: MaterialRow[]; problems: string[] }): void => {
    setProblems(r.problems)
    if (r.added.length) toast(`Added ${plural(r.added.length, 'file')}.`, 'good')
    load()
  }

  const pick = async (): Promise<void> => {
    setBusy(true)
    try {
      afterAdd(await api('materials:pick', { moduleId }))
    } catch (e) {
      setProblems([errorMessage(e)])
    } finally {
      setBusy(false)
    }
  }

  const saveLabel = async (m: MaterialRow): Promise<void> => {
    try {
      await api('materials:rename', { id: m.id, label })
      setEditing(null)
      load()
    } catch (e) {
      toast(errorMessage(e), 'bad')
    }
  }

  const unused = (list ?? []).filter((m) => m.usedBy === 0)

  return (
    <section
      className={dragging ? 'section materials is-dropping' : 'section materials'}
      aria-labelledby="mat-h"
      onDragOver={(e) => {
        if (archived) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={async (e) => {
        e.preventDefault()
        setDragging(false)
        if (archived) return
        setBusy(true)
        afterAdd(await addDroppedMaterials(moduleId, [...e.dataTransfer.files]))
        setBusy(false)
      }}
      data-testid="materials"
    >
      <div className="section-head">
        <h2 id="mat-h">Study materials</h2>
        <div className="section-tools">
          {unused.length > 0 && !archived ? (
            <a
              className="btn btn-primary btn-sm"
              href={href({ name: 'upload', moduleId, materialIds: unused.map((m) => m.id) })}
              data-testid="quiz-unused"
            >
              <Icon name="play" size={14} /> Quiz the {unused.length === 1 ? 'new one' : `${unused.length} new ones`}
            </a>
          ) : null}
          {!archived ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={pick} disabled={busy} data-testid="add-materials">
              <Icon name="plus" size={14} /> {busy ? 'Reading…' : 'Add files…'}
            </button>
          ) : null}
        </div>
      </div>
      {problems.length ? (
        <ErrorNote>
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </ErrorNote>
      ) : null}
      {!list ? null : list.length === 0 ? (
        <Empty title="No materials yet." mark="file" action={!archived ? <button type="button" className="btn btn-secondary btn-sm" onClick={pick}>Add files…</button> : undefined}>
          Add lecture slides, notes and handouts as the weeks go by, or drop them here. They are saved with this module, so you
          can generate quizzes from any of them later.
        </Empty>
      ) : (
        <>
          <p className="muted small materials-summary">
            {plural(list.length, 'file')}
            {unused.length ? (
              <>
                {' · '}
                <strong>{unused.length} not in any quiz yet</strong>
              </>
            ) : (
              ' · all used in at least one quiz'
            )}
            . Drop more files here to add them.
          </p>
          <div className="table-wrap">
            <table className="table table-dense materials-table">
              <caption className="sr-only">Study materials in this module</caption>
              <thead>
                <tr>
                  <th scope="col">Label</th>
                  <th scope="col">File</th>
                  <th scope="col">Added</th>
                  <th scope="col">Coverage</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((m, i) => (
                  <tr key={m.id} className="anim-enter" style={{ '--i': i } as React.CSSProperties}>
                    <td className="material-label">
                      {editing === m.id ? (
                        <form
                          className="inline-edit"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void saveLabel(m)
                          }}
                        >
                          <input
                            className="input"
                            value={label}
                            maxLength={120}
                            autoFocus
                            aria-label="Label"
                            onChange={(e) => setLabel(e.target.value)}
                            onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                          />
                          <button type="submit" className="btn btn-primary btn-sm">
                            Save
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="label-btn"
                          title="Rename"
                          onClick={() => {
                            setEditing(m.id)
                            setLabel(m.label)
                          }}
                        >
                          {m.label}
                          <Icon name="edit" size={13} />
                        </button>
                      )}
                    </td>
                    <td>
                      <div className="material-file">
                        <span className="tag">{kindLabel(m.kind)}</span>
                        <span className="faint small material-filename" title={m.filename}>
                          {m.filename}
                        </span>
                        <span className="faint small num nowrap">{fmtBytes(m.bytes)}</span>
                      </div>
                    </td>
                    <td className="nowrap muted small">{fmtDate(m.addedAt)}</td>
                    <td className="nowrap">
                      {m.usedBy === 0 ? (
                        <span className="tag tag-live">Not quizzed yet</span>
                      ) : (
                        <span className="small muted">
                          In {plural(m.usedBy, 'quiz version')}
                        </span>
                      )}
                    </td>
                    <td className="td-action nowrap">
                      {m.hasCopy ? (
                        <button type="button" className="icon-btn" title="Show file" aria-label={`Show ${m.label} in folder`} onClick={() => void api('materials:show', { id: m.id }).catch((e: unknown) => toast(errorMessage(e), 'bad'))}>
                          <Icon name="folder" size={16} />
                        </button>
                      ) : null}
                      <a className="icon-btn" title="Quiz this" aria-label={`Generate a quiz from ${m.label}`} href={href({ name: 'upload', moduleId, materialIds: [m.id] })}>
                        <Icon name="play" size={15} />
                      </a>
                      <button type="button" className="icon-btn" title="Remove" aria-label={`Remove ${m.label}`} onClick={() => setRemoving(m)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove “${removing?.label ?? ''}”?`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger-solid"
              onClick={async () => {
                if (!removing) return
                await api('materials:remove', { id: removing.id })
                setRemoving(null)
                load()
              }}
            >
              Remove material
            </button>
          </>
        }
      >
        <p>
          The file and its text are removed from this module. Quizzes already made from it are kept, and still list it as a
          source.
        </p>
      </Dialog>
    </section>
  )
}
