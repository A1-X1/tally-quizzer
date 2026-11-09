import { useEffect, useState } from 'react'
import type { BootState, FolderInspection } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { Icon, TallyMark } from '../components/Icon'
import { ErrorNote } from '../components/ui'
import { fmtDate, plural } from '../lib/format'

export function FolderChooser({
  onReady,
  intro
}: {
  onReady: (s: BootState) => void
  intro?: React.ReactNode
}) {
  const [choice, setChoice] = useState<FolderInspection | null>(null)
  const [isDefault, setIsDefault] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api('setup:inspectDefault')
      .then(setChoice)
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [])

  const pick = async (): Promise<void> => {
    setError(null)
    try {
      const res = await api('setup:pickFolder')
      if (res) {
        setChoice(res)
        setIsDefault(false)
      }
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const confirm = async (): Promise<void> => {
    if (!choice) return
    setBusy(true)
    setError(null)
    try {
      const s =
        choice.status === 'existing'
          ? await api('setup:useExisting', { token: choice.token })
          : await api('setup:create', { token: choice.token })
      onReady(s)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const resetToDefault = async (): Promise<void> => {
    setChoice(await api('setup:inspectDefault'))
    setIsDefault(true)
  }

  return (
    <section className="chooser" aria-labelledby="chooser-title">
      <h2 id="chooser-title" className="chooser-title">
        Where should Tally keep your data?
      </h2>
      {intro}
      <div className="chooser-path">
        <span className="chooser-path-label">{isDefault ? 'Suggested folder' : 'Chosen folder'}</span>
        <span className="mono chooser-path-value" data-testid="data-path">
          {choice?.dataDir ?? '…'}
        </span>
      </div>

      {choice?.status === 'existing' && choice.summary ? (
        <div className="chooser-found" data-testid="existing-data">
          <p className="chooser-found-title">This folder already has Tally data.</p>
          <p className="muted">
            {plural(choice.summary.modules, 'module')}, {plural(choice.summary.quizzes, 'quiz', 'quizzes')} and{' '}
            {plural(choice.summary.attempts, 'finished attempt')}
            {choice.summary.lastActivity ? `, last used ${fmtDate(choice.summary.lastActivity)}` : ''}. Tally will
            open it as it is. Nothing is overwritten.
          </p>
        </div>
      ) : null}
      {choice?.status === 'invalid' ? (
        <ErrorNote>
          <strong>This folder has a userdata.sqlite file that Tally cannot use.</strong> {choice.detail} Choose a
          different folder; the file has not been changed.
        </ErrorNote>
      ) : null}
      {choice?.status === 'not-writable' ? <ErrorNote>{choice.detail} Choose a folder you can write to.</ErrorNote> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="chooser-actions">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={confirm}
          disabled={busy || !choice || choice.status === 'invalid' || choice.status === 'not-writable'}
          data-testid="confirm-folder"
        >
          {choice?.status === 'existing' ? 'Use this existing data' : 'Create my data folder'}
          <Icon name="arrowRight" size={18} />
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={pick} disabled={busy}>
          <Icon name="folder" size={18} />
          Choose another folder…
        </button>
        {!isDefault ? (
          <button type="button" className="btn btn-ghost" onClick={resetToDefault} disabled={busy}>
            Back to the suggested folder
          </button>
        ) : null}
      </div>

      <ul className="chooser-notes">
        <li>
          Tally creates <span className="mono">Tally Data</span> with <span className="mono">userdata.sqlite</span>, a{' '}
          <span className="mono">quizzes</span> folder of readable CSV copies, and automatic{' '}
          <span className="mono">backups</span>.
        </li>
        <li>Pick a folder you have synced or copied from another computer to carry on where you left off.</li>
        <li>Uninstalling or updating Tally never deletes this folder. You can move it later in Settings.</li>
      </ul>
    </section>
  )
}

export function Welcome({ onReady }: { onReady: (s: BootState) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="welcome-mark">
          <TallyMark size={44} />
        </div>
        <h1 className="welcome-title">
          Every quiz you take,
          <br />
          <span className="hl">counted.</span>
        </h1>
        <p className="welcome-lede">
          Tally keeps your quizzes, your answers and your scores on this computer, sorted by module, so you can see
          which topics are sticking and which need another go. No account, no internet.
        </p>
      </div>
      <FolderChooser onReady={onReady} />
    </div>
  )
}
