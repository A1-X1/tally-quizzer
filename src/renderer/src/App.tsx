import { useCallback, useEffect, useState } from 'react'
import type { BootState, UpgradeNotice } from '../../shared/types'
import { api } from './api'
import { Navbar } from './components/Navbar'
import { Loading, ToastProvider, useToast } from './components/ui'
import { useRoute } from './lib/router'
import { ThemeProvider } from './lib/theme'
import { Dashboard } from './pages/Dashboard'
import { HelpPage } from './pages/Help'
import { HistoryPage } from './pages/History'
import { ModulePage } from './pages/ModulePage'
import { ModulesPage } from './pages/Modules'
import { QuizSetup } from './pages/QuizSetup'
import { Recovery } from './pages/Recovery'
import { ResultsPage } from './pages/Results'
import { SettingsPage } from './pages/Settings'
import { TakeQuiz } from './pages/TakeQuiz'
import { UploadPage } from './pages/Upload'
import { Welcome } from './pages/Welcome'

export function App() {
  const [boot, setBoot] = useState<BootState | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api('app:boot')
      .then(setBoot)
      .catch((e: unknown) => setBootError(String(e)))
  }, [])
  useEffect(refresh, [refresh])

  if (bootError) {
    return (
      <div className="boot-error" role="alert">
        Tally could not start: {bootError}
      </div>
    )
  }
  if (!boot) return <Loading label="Starting Tally" />

  return (
    <ToastProvider>
      {boot.kind === 'ready' ? (
        <ThemeProvider initial={boot.theme} persist>
          <Shell onDataChanged={refresh} key={boot.dataDir} upgrade={boot.upgrade} />
        </ThemeProvider>
      ) : (
        <ThemeProvider initial="system" persist={false}>
          <div className="titlebar titlebar-bare" aria-hidden="true" />
          {boot.kind === 'setup' ? (
            <Welcome onReady={setBoot} />
          ) : (
            <Recovery state={boot} onState={setBoot} />
          )}
        </ThemeProvider>
      )}
    </ToastProvider>
  )
}

function Shell({ onDataChanged, upgrade }: { onDataChanged: () => void; upgrade: UpgradeNotice | null }) {
  const route = useRoute()
  const focused = route.name === 'attempt'
  const toast = useToast()
  const [available, setAvailable] = useState<string | null>(null)

  // After an update: say so, once. Then, only if the user opted in, check for a newer version.
  useEffect(() => {
    if (upgrade && upgrade.fromVersion && upgrade.fromVersion !== upgrade.toVersion) {
      toast(`Updated to Tally ${upgrade.toVersion}. Your data was backed up first.`, 'good')
    } else if (upgrade) {
      toast('Your data was updated for this version of Tally. A backup was saved first.', 'good')
    }
    api('updates:getAutoCheck')
      .then((on) => (on ? api('updates:check') : null))
      .then((info) => {
        if (info?.newer && info.latest) setAvailable(info.latest)
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Move focus to the page heading on navigation so keyboard and screen reader users land in context.
  useEffect(() => {
    if (route.name === 'help' && route.section) return
    const main = document.getElementById('main')
    main?.scrollTo({ top: 0 })
    const h1 = main?.querySelector('h1')
    if (h1 instanceof HTMLElement) {
      h1.tabIndex = -1
      h1.focus({ preventScroll: true })
    }
  }, [route])

  return (
    <div className={focused ? 'shell shell-focused' : 'shell'}>
      {focused ? null : <Navbar route={route} />}
      {available && !focused && route.name !== 'settings' ? (
        <div className="update-pill" role="status">
          Tally {available} is available.{' '}
          <a href="#/settings">See what’s new</a>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setAvailable(null)}>
            ×
          </button>
        </div>
      ) : null}
      <main id="main" className="main">
        {route.name === 'dashboard' && <Dashboard />}
        {route.name === 'modules' && <ModulesPage />}
        {route.name === 'module' && <ModulePage id={route.id} key={route.id} />}
        {route.name === 'quiz' && <QuizSetup id={route.id} key={route.id} />}
        {route.name === 'attempt' && <TakeQuiz id={route.id} key={route.id} />}
        {route.name === 'result' && <ResultsPage id={route.id} key={route.id} />}
        {route.name === 'history' && <HistoryPage initialModule={route.moduleId} initialQuiz={route.quizId} />}
        {route.name === 'help' && <HelpPage section={route.section} />}
        {route.name === 'settings' && <SettingsPage onDataChanged={onDataChanged} />}
        {route.name === 'upload' && <UploadPage initialModule={route.moduleId} key={route.moduleId ?? 0} />}
      </main>
    </div>
  )
}
