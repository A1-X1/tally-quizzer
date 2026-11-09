import { useState } from 'react'
import { MODULE_COLOURS, type ModuleColour, type ModuleInput, type ModuleRow } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { Dialog, ErrorNote, Field } from './ui'

const COLOUR_NAMES: Record<ModuleColour, string> = {
  cobalt: 'Cobalt',
  teal: 'Teal',
  ochre: 'Ochre',
  plum: 'Plum',
  olive: 'Olive',
  rose: 'Rose',
  slate: 'Slate',
  graphite: 'Graphite'
}

export function ModuleDialog({
  open,
  onClose,
  onSaved,
  existing,
  suggestedColour
}: {
  open: boolean
  onClose: () => void
  onSaved: (m: ModuleRow) => void
  existing?: ModuleRow | null
  suggestedColour?: ModuleColour
}) {
  const [form, setForm] = useState<ModuleInput>(() => ({
    name: existing?.name ?? '',
    code: existing?.code ?? '',
    colour: existing?.colour ?? suggestedColour ?? 'cobalt',
    description: existing?.description ?? ''
  }))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const input: ModuleInput = {
        name: form.name,
        code: form.code?.trim() ? form.code : null,
        colour: form.colour,
        description: form.description?.trim() ? form.description : null
      }
      const m = existing
        ? await api('modules:update', { id: existing.id, input })
        : await api('modules:create', input)
      onSaved(m)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={existing ? 'Edit module' : 'New module'}>
      <form className="form" onSubmit={save} id="module-form">
        <Field label="Name" htmlFor="m-name">
          <input
            id="m-name"
            className="input"
            value={form.name}
            maxLength={120}
            required
            autoFocus
            placeholder="e.g. Discrete Mathematics"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Code" htmlFor="m-code" hint="Optional. A course code such as MATH1002.">
          <input
            id="m-code"
            className="input input-short mono"
            value={form.code ?? ''}
            maxLength={40}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </Field>
        <fieldset className="field colour-field">
          <legend className="field-label">Colour</legend>
          <div className="colour-options">
            {MODULE_COLOURS.map((c) => (
              <label key={c} className="colour-option" title={COLOUR_NAMES[c]}>
                <input
                  type="radio"
                  name="colour"
                  value={c}
                  checked={form.colour === c}
                  onChange={() => setForm({ ...form, colour: c })}
                />
                <span className="colour-chip" style={{ background: `var(--mod-${c})` }} />
                <span className="sr-only">{COLOUR_NAMES[c]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Description" htmlFor="m-desc" hint="Optional.">
          <textarea
            id="m-desc"
            className="input textarea"
            rows={3}
            maxLength={2000}
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !form.name.trim()}>
            {existing ? 'Save changes' : 'Create module'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function nextColour(used: ModuleColour[]): ModuleColour {
  return MODULE_COLOURS.find((c) => !used.includes(c)) ?? MODULE_COLOURS[used.length % MODULE_COLOURS.length]
}
