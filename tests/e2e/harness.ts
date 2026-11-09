import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

/** The packaged executable under test. Override with TALLY_EXECUTABLE. */
export function executablePath(): string {
  if (process.env.TALLY_EXECUTABLE) return path.resolve(process.env.TALLY_EXECUTABLE)
  const rel = path.join(ROOT, 'release')
  const candidates =
    process.platform === 'win32'
      ? [path.join(rel, 'win-unpacked', 'Tally.exe')]
      : process.platform === 'darwin'
        ? [
            path.join(rel, `mac-${process.arch}`, 'Tally.app', 'Contents', 'MacOS', 'Tally'),
            path.join(rel, 'mac', 'Tally.app', 'Contents', 'MacOS', 'Tally')
          ]
        : [path.join(rel, 'linux-unpacked', 'tally')]
  const found = candidates.find((c) => fs.existsSync(c))
  if (!found) throw new Error(`Packaged app not found. Build it first (npm run dist:dir). Looked in:\n${candidates.join('\n')}`)
  return found
}

export interface Env {
  root: string
  userData: string
  documents: string
}

export function newEnv(): Env {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-e2e-'))
  const env = { root, userData: path.join(root, 'userData'), documents: path.join(root, 'Documents') }
  fs.mkdirSync(env.documents, { recursive: true })
  return env
}

export interface Running {
  app: ElectronApplication
  page: Page
  consoleErrors: string[]
}

export async function launch(env: Env, extra: Record<string, string> = {}): Promise<Running> {
  const app = await electron.launch({
    executablePath: executablePath(),
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    env: {
      ...process.env,
      TALLY_USER_DATA: env.userData,
      TALLY_DEFAULT_LOCATION: env.documents,
      ...extra
    } as Record<string, string>,
    timeout: 60_000
  })
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  await page.waitForLoadState('domcontentloaded')
  return { app, page, consoleErrors }
}

/** Replace the next native open dialog with a fixed answer. */
export async function stubOpenDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () =>
      p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }) as typeof dialog.showOpenDialog
  }, filePath)
}

export async function stubSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () =>
      p ? { canceled: false, filePath: p } : { canceled: true, filePath: '' }) as typeof dialog.showSaveDialog
  }, filePath)
}

export async function blockedRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __tallyBlockedRequests: string[] }).__tallyBlockedRequests ?? [])
}

/** Finish first-run setup with the suggested folder. */
export async function setupDefault(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Create my data folder/ }).click()
  await page.getByRole('navigation', { name: 'Main' }).waitFor()
}

export const dataDirOf = (env: Env): string => path.join(env.documents, 'Tally Data')

export async function close(r: Running): Promise<void> {
  await r.app.close()
}

/** Correct answers in samples/example_quiz.csv, by question. */
export const EXAMPLE_ANSWERS = ['C', 'ACE', 'B', 'C', 'A', 'ABD', 'D', 'ACE', 'B', 'C', 'ABD', 'B']
export const EXAMPLE_MARKS = [1, 2, 1, 1, 1, 2, 1, 3, 1, 1, 2, 1]
export const SAMPLE = path.join(ROOT, 'samples', 'example_quiz.csv')
