import { useState } from 'react'
import type { BootState } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { ErrorNote } from '../components/ui'
import { FolderChooser } from './Welcome'

export function Recovery({
  state,
  onState
}: {
  state: Extract<BootState, { kind: 'missing' }>
  onState: (s: BootState) => void
}) {
  const [mode, setMode] = useState<'recover' | 'new'>('recover')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const retry = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      const s = await api('setup:retry')
      if (s.kind === 'missing') setNote(`Still not available. ${s.reason}`)
      onState(s)
    } catch (e) {
      setNote(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const locate = async (): Promise<void> => {
    setNote(null)
    try {
      const found = await api('setup:locate')
      if (!found) return
      if (found.status !== 'existing') {
        setNote(
          found.status === 'invalid'
            ? `That folder has a database Tally cannot use: ${found.detail}`
            : `There is no Tally data in ${found.location}. Choose the folder that contains userdata.sqlite.`
        )
        return
      }
      setBusy(true)
      onState(await api('setup:useExisting', { token: found.token }))
    } catch (e) {
      setNote(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'new') {
    return (
      <div className="welcome">
        <div className="welcome-hero">
          <h1 className="welcome-title">Start somewhere new.</h1>
          <p className="welcome-lede">
            Tally will create a fresh data folder. Your old folder at{' '}
            <span className="mono">{state.dataDir}</span> is left exactly as it is, so you can come back to it with{' '}
            <em>Locate folder</em>.
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => setMode('recover')}>
            <Icon name="arrowLeft" size={16} /> Back
          </button>
        </div>
        <FolderChooser onReady={onState} />
      </div>
    )
  }

  return (
    <div className="recovery" data-testid="recovery">
      <p className="eyebrow bad">Data folder unavailable</p>
      <h1 className="recovery-title">Tally can’t find your data.</h1>
      <dl className="recovery-facts">
        <dt>Looked in</dt>
        <dd className="mono">{state.dataDir}</dd>
        <dt>Reason</dt>
        <dd>{state.reason}</dd>
      </dl>
      <p className="recovery-lede">
        If the folder is on an external drive or a synced folder that hasn’t finished downloading, reconnect it and
        retry. Tally has not created anything in its place.
      </p>
      {note ? <ErrorNote>{note}</ErrorNote> : null}
      <div className="recovery-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={retry} disabled={busy}>
          <Icon name="retry" size={18} /> Retry
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={locate} disabled={busy}>
          <Icon name="folder" size={18} /> Locate folder…
        </button>
        <button type="button" className="btn btn-ghost btn-lg" onClick={() => setMode('new')} disabled={busy}>
          Choose new location
        </button>
      </div>
    </div>
  )
}
