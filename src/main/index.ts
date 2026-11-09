import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { afterOpen, closeDb, getTheme, tryOpenConfigured } from './context'
import { registerIpc } from './ipc'
import { blockedRequests, createMainWindow, hardenSession, registerSchemes, serveRenderer } from './window'

// Tests (and power users) can isolate Tally's settings directory.
if (process.env.TALLY_USER_DATA) app.setPath('userData', path.resolve(process.env.TALLY_USER_DATA))

// Exposed for the end-to-end tests, which read it through Playwright's main-process evaluate.
;(globalThis as unknown as { __tallyBlockedRequests: string[] }).__tallyBlockedRequests = blockedRequests

let mainWindow: BrowserWindow | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  })

  registerSchemes()

  app.whenReady().then(() => {
    app.setAppUserModelId('com.a1x1.tally')
    hardenSession()
    serveRenderer()
    registerIpc()

    // Open the configured data folder (if any) before the window so the theme is known.
    const state = tryOpenConfigured()
    nativeTheme.themeSource = state.kind === 'ready' ? getTheme() : 'system'
    if (state.kind === 'ready') void afterOpen()

    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    closeDb()
  })
}
