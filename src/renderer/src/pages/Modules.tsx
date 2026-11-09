import { useState } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { ModuleDialog, nextColour } from '../components/ModuleForm'
import { Empty, ErrorNote, Loading, Score, Swatch, Toggle, Trend, useLoad, useToast } from '../components/ui'
import { fmtRelative } from '../lib/format'
import { go, href } from '../lib/router'

export function ModulesPage() {
  const [showArchived, setShowArchived] = useState(false)
  const { data, error, reload } = useLoad(() => api('modules:list', { includeArchived: showArchived }), [showArchived])
  const [creating, setCreating] = useState(false)
  const toast = useToast()

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Modules</h1>
          <p className="lede">Each module holds quizzes on one subject. Scores roll up here.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New module
          </button>
        </div>
      </header>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty
          title={showArchived ? 'No modules, archived or otherwise.' : 'No modules yet.'}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(true)}>
              Create your first module
            </button>
          }
        >
          A module is a subject or course. Create one, then upload quizzes into it.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table table-click table-roomy">
            <caption className="sr-only">Modules</caption>
            <thead>
              <tr>
                <th scope="col">Module</th>
                <th scope="col" className="num-col">Quizzes</th>
                <th scope="col" className="num-col">Attempts</th>
                <th scope="col" className="num-col">Average</th>
                <th scope="col" className="num-col">Latest</th>
                <th scope="col" className="num-col">Trend</th>
                <th scope="col" className="num-col">Last studied</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} onClick={() => go({ name: 'module', id: m.id })} className={m.archivedAt ? 'is-archived' : ''}>
                  <td>
                    <div className="module-cell">
                      <Swatch colour={m.colour} size={12} />
                      <div>
                        <a className="module-name" href={href({ name: 'module', id: m.id })} onClick={(e) => e.stopPropagation()}>
                          {m.name}
                        </a>
                        <div className="module-sub">
                          {m.code ? <span className="mono">{m.code}</span> : null}
                          {m.archivedAt ? <span className="tag">Archived</span> : null}
                          {m.description ? <span className="faint clamp-1">{m.description}</span> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num-col num">{m.quizCount}</td>
                  <td className="num-col num">{m.attemptCount}</td>
                  <td className="num-col"><Score value={m.average} /></td>
                  <td className="num-col"><Score value={m.latest} /></td>
                  <td className="num-col"><Trend value={m.trend} /></td>
                  <td className="num-col nowrap muted">{fmtRelative(m.lastStudied)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="page-foot">
        <Toggle checked={showArchived} onChange={setShowArchived} label="Show archived modules" />
      </div>

      {creating ? (
        <ModuleDialog
          open
          onClose={() => setCreating(false)}
          suggestedColour={nextColour((data ?? []).map((m) => m.colour))}
          onSaved={(m) => {
            setCreating(false)
            toast(`Created ${m.name}.`, 'good')
            reload()
            go({ name: 'module', id: m.id })
          }}
        />
      ) : null}
    </div>
  )
}
