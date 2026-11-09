import { useState } from 'react'
import type { RestoreCheck, UpdateInfo } from '../../../shared/types'
import { Toggle } from '../components/ui'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { Dialog, ErrorNote, Loading, Segmented, useLoad, useToast } from '../components/ui'
import { fmtBytes, fmtDate, fmtDateTime, plural } from '../lib/format'
import { useTheme } from '../lib/theme'

const REASONS: Record<string, string> = {
  startup: 'At startup',
  manual: 'Manual',
  'pre-delete': 'Before deleting',
  'pre-restore': 'Before restoring',
  'pre-move': 'Before moving',
  'pre-upgrade': 'Before updating'
}

export function SettingsPage({ onDataChanged }: { onDataChanged: () => void }) {
  const { pref, setPref } = useTheme()
  const { data: info, error, reload } = useLoad(() => api('data:info'), [])
  const { data: version } = useLoad(() => api('app:version'), [])
  const [restore, setRestore] = useState<RestoreCheck | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const toast = useToast()

  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e), 'bad')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
        </div>
      </header>

      <section className="settings-section" aria-labelledby="s-look">
        <h2 id="s-look" className="settings-h">Appearance</h2>
        <div className="settings-body">
          <div className="setting">
            <div>
              <p className="setting-name">Theme</p>
              <p className="muted small">System follows your computer’s light or dark setting.</p>
            </div>
            <Segmented
              label="Theme"
              value={pref}
              onChange={setPref}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
              ]}
            />
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="s-data">
        <h2 id="s-data" className="settings-h">Data</h2>
        <div className="settings-body">
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          {!info ? (
            <Loading />
          ) : (
            <>
              <div className="setting setting-path">
                <div>
                  <p className="setting-name">Data folder</p>
                  <p className="mono path" data-testid="settings-path">{info.dataDir}</p>
                  <p className="muted small">
                    <span className="mono">userdata.sqlite</span> · {fmtBytes(info.dbBytes)} ·{' '}
                    {plural(info.summary.modules, 'module')}, {plural(info.summary.quizzes, 'quiz', 'quizzes')},{' '}
                    {plural(info.summary.attempts, 'attempt')}
                  </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => void api('data:showInFolder')}>
                  <Icon name="folder" size={16} /> Show in folder
                </button>
              </div>

              <div className="warning-line" role="note">
                <Icon name="warning" size={18} />
                <p>
                  <strong>Run Tally on one computer at a time.</strong> If this folder is synced (Dropbox, OneDrive,
                  iCloud Drive), close Tally here and let syncing finish before opening it on another device.
                </p>
              </div>

              <div className="setting">
                <div>
                  <p className="setting-name">Move data folder</p>
                  <p className="muted small">
                    Copies everything to a new folder, checks the copy, switches over, then removes the old copy.
                  </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => setMoveOpen(true)} disabled={!!busy}>
                  Move…
                </button>
              </div>

              <div className="setting">
                <div>
                  <p className="setting-name">Export my data</p>
                  <p className="muted small">Saves a complete, consistent copy of userdata.sqlite wherever you choose.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!!busy}
                  onClick={() =>
                    run('export', async () => {
                      const r = await api('data:export')
                      if (r.saved) toast('Export saved and verified.', 'good')
                    })
                  }
                >
                  <Icon name="download" size={16} /> Export…
                </button>
              </div>

              <div className="setting">
                <div>
                  <p className="setting-name">Restore from file</p>
                  <p className="muted small">
                    Replaces your current data with an exported or backed-up file. Your current data is backed up first.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!!busy}
                  onClick={() =>
                    run('pick', async () => {
                      const r = await api('data:pickRestore')
                      if (r) setRestore(r)
                    })
                  }
                >
                  Restore…
                </button>
              </div>

              <div className="setting setting-stack">
                <div className="setting-row">
                  <div>
                    <p className="setting-name">Backups</p>
                    <p className="muted small">
                      Taken at every startup and before anything destructive. The latest ten are kept in{' '}
                      <span className="mono">backups</span>.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!!busy}
                    onClick={() =>
                      run('backup', async () => {
                        await api('data:backupNow')
                        toast('Backup saved.', 'good')
                        reload()
                      })
                    }
                  >
                    Back up now
                  </button>
                </div>
                {info.backups.length ? (
                  <table className="table table-dense backups-table">
                    <caption className="sr-only">Backups</caption>
                    <thead>
                      <tr>
                        <th scope="col">Taken</th>
                        <th scope="col">Why</th>
                        <th scope="col" className="num-col">Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {info.backups.map((b) => (
                        <tr key={b.filename} title={b.filename}>
                          <td>{fmtDateTime(b.createdAt)}</td>
                          <td className="muted">{REASONS[b.reason] ?? b.reason}</td>
                          <td className="num-col num">{fmtBytes(b.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted small">No backups yet. One is taken next time Tally starts.</p>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="s-about">
        <h2 id="s-about" className="settings-h">About</h2>
        <div className="settings-body">
          <UpdatePanel version={version ?? ''} />
          <p className="muted small">
            Tally connects to nothing unless you check for updates. Fonts: Bricolage Grotesque, Instrument Sans and
            Spline Sans Mono (SIL Open Font License). Maths by KaTeX (MIT).
          </p>
        </div>
      </section>

      <Dialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Move your data folder"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setMoveOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() =>
                run('move', async () => {
                  const r = await api('data:move')
                  if (r.moved) {
                    setMoveOpen(false)
                    toast('Data moved. The old copy was removed.', 'good')
                    reload()
                    onDataChanged()
                  }
                })
              }
            >
              Choose new folder…
            </button>
          </>
        }
      >
        <p>
          Pick the folder that should contain <span className="mono">Tally Data</span>. Tally copies your data there,
          verifies the copy, switches to it, and only then deletes the old folder. If anything fails, your data stays
          where it is.
        </p>
      </Dialog>

      <Dialog
        open={restore !== null}
        onClose={() => setRestore(null)}
        title="Restore from this file?"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRestore(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger-solid"
              disabled={!!busy}
              data-testid="confirm-restore"
              onClick={() =>
                run('restore', async () => {
                  if (!restore) return
                  await api('data:restore', { token: restore.token })
                  setRestore(null)
                  toast('Restored. Your previous data was backed up first.', 'good')
                  onDataChanged()
                  location.hash = '#/'
                })
              }
            >
              Replace my data
            </button>
          </>
        }
      >
        {restore ? (
          <>
            <p>
              <span className="mono">{restore.filename}</span> is a valid Tally file with{' '}
              {plural(restore.summary.modules, 'module')}, {plural(restore.summary.quizzes, 'quiz', 'quizzes')} and{' '}
              {plural(restore.summary.attempts, 'attempt')}
              {restore.summary.lastActivity ? `, last used ${fmtDate(restore.summary.lastActivity)}` : ''}.
            </p>
            <p className="muted">
              Your current data will be backed up to the backups folder, then replaced by this file.
            </p>
          </>
        ) : null}
      </Dialog>
    </div>
  )
}

export function UpdatePanel({ version }: { version: string }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: auto, reload } = useLoad(() => api('updates:getAutoCheck'), [])
  const toast = useToast()

  const check = async (): Promise<void> => {
    setChecking(true)
    setError(null)
    try {
      setInfo(await api('updates:check'))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <div className="setting">
        <div>
          <p className="setting-name">
            Tally <span className="num">{version}</span>
          </p>
          <p className="muted small">Checking contacts GitHub only when you ask. Nothing is sent about you or your data.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={check} disabled={checking} data-testid="check-updates">
          <Icon name="retry" size={16} /> {checking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {info ? (
        info.newer && info.latest ? (
          <div className="update-card" role="status">
            <p className="update-title">
              Tally <span className="num">{info.latest}</span> is available
              {info.publishedAt ? <span className="faint small"> · released {fmtDate(info.publishedAt)}</span> : null}
            </p>
            {info.notes ? <pre className="update-notes">{info.notes}</pre> : null}
            <ol className="update-steps">
              <li>Download the new version and close Tally.</li>
              <li>Install it over this one: run the installer on Windows, replace the app in Applications on a Mac, or swap the AppImage on Linux.</li>
              <li>Open Tally. It backs up your data, updates it for the new version if needed, and carries on where you left off.</li>
            </ol>
            <div className="row-actions">
              {info.download ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void api('updates:open', { url: info.download!.url }).catch((e: unknown) => toast(errorMessage(e), 'bad'))}
                >
                  <Icon name="download" size={16} /> Download {info.download.name}{' '}
                  <span className="faint-on">({fmtBytes(info.download.bytes)})</span>
                </button>
              ) : null}
              {info.pageUrl ? (
                <button type="button" className="btn btn-ghost" onClick={() => void api('updates:open', { url: info.pageUrl! })}>
                  <Icon name="external" size={16} /> Release page
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="update-ok" role="status">
            <Icon name="check" size={16} /> {info.latest ? `You have the latest version (${info.current}).` : 'No releases have been published yet.'}
          </p>
        )
      ) : null}
      <div className="setting">
        <Toggle
          checked={auto === true}
          onChange={async (v) => {
            await api('updates:setAutoCheck', { enabled: v })
            reload()
          }}
          label="Check for updates when Tally starts"
          description="Off by default. When on, Tally asks GitHub for the latest version once at startup."
        />
      </div>
    </>
  )
}
