import { app, BrowserWindow, nativeTheme, net, protocol, screen, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAllowedUpdateRequest } from './updates'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://tally`

export { CSP } from './window-csp'
import { CSP } from './window-csp'

const devServer = (): string | undefined => (!app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined)

/** URLs whose frames are allowed to talk to the main process. */
export function isTrustedUrl(url: string): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true
  const dev = devServer()
  return !!dev && url.startsWith(dev)
}

/** Every network request the app refused, for diagnostics and tests. */
export const blockedRequests: string[] = []

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

export function serveRenderer(): void {
  const root = path.join(__dirname, '../renderer')
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'tally') return new Response('Not found', { status: 404 })
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const file = path.normalize(path.join(root, rel))
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      return new Response('Not found', { status: 404 })
    }
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(res.body, { status: res.status, headers })
  })
}

/** Deny permissions, block navigation, new windows and every outbound request. */
export function hardenSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
    const dev = devServer()
    if (dev) {
      const origin = new URL(dev).host
      if (new URL(details.url).host === origin) return cb({})
    }
    if (isAllowedUpdateRequest(details.url)) return cb({})
    blockedRequests.push(details.url)
    console.warn('[net] blocked', details.url)
    cb({ cancel: true })
  })

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

// ---------------------------------------------------------------------------
// Window state

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const stateFile = (): string => path.join(app.getPath('userData'), 'window-state.json')
export const MIN_WIDTH = 900
export const MIN_HEIGHT = 620

function loadState(): WindowState {
  const fallback: WindowState = { width: 1280, height: 820, maximized: false }
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Partial<WindowState>
    const width = Math.max(MIN_WIDTH, Number(s.width) || fallback.width)
    const height = Math.max(MIN_HEIGHT, Number(s.height) || fallback.height)
    const state: WindowState = { width, height, maximized: !!s.maximized }
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      // Only restore a position that is still on a connected display.
      const area = screen.getDisplayMatching({ x: s.x, y: s.y, width, height }).workArea
      const visible =
        s.x + 100 > area.x && s.x < area.x + area.width - 100 && s.y >= area.y - 10 && s.y < area.y + area.height - 60
      if (visible) {
        state.x = s.x
        state.y = s.y
      }
    }
    return state
  } catch {
    return fallback
  }
}

function saveState(win: BrowserWindow): void {
  try {
    const b = win.getNormalBounds()
    const s: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify(s))
  } catch {
    /* non-essential */
  }
}

// ---------------------------------------------------------------------------
// Title bar

export const TITLE_BAR_HEIGHT = 64
const COLOURS = {
  light: { bg: '#F5F1E8', ink: '#16181D' },
  dark: { bg: '#131418', ink: '#EFEBE1' }
}

export function applyTitleBarTheme(win: BrowserWindow, dark: boolean): void {
  const c = dark ? COLOURS.dark : COLOURS.light
  win.setBackgroundColor(c.bg)
  if (process.platform !== 'darwin') {
    try {
      win.setTitleBarOverlay({ color: c.bg, symbolColor: c.ink, height: TITLE_BAR_HEIGHT })
    } catch {
      /* not supported on this platform */
    }
  }
}

export function createMainWindow(): BrowserWindow {
  const state = loadState()
  const dark = nativeTheme.shouldUseDarkColors
  const c = dark ? COLOURS.dark : COLOURS.light
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'Tally',
    backgroundColor: c.bg,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 22, y: 24 } }
      : { titleBarOverlay: { color: c.bg, symbolColor: c.ink, height: TITLE_BAR_HEIGHT } }),
    ...(process.platform === 'linux' ? { icon: path.join(__dirname, '../../resources/icon.png') } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.TALLY_DEVTOOLS === '1'
    }
  })
  if (state.maximized) win.maximize()

  win.once('ready-to-show', () => {
    if (process.env.TALLY_HIDDEN !== '1') win.show()
  })
  win.on('close', () => saveState(win))

  // External links: only http(s) and only through an explicit user click in the
  // renderer, which calls app:openReleases. Anything else that tries to open is denied.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\/A1-X1\/tally-quizzer(\/|$)/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const dev = devServer()
  if (dev) void win.loadURL(dev)
  else void win.loadURL(`${APP_ORIGIN}/index.html`)
  return win
}
