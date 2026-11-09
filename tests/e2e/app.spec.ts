import { expect, test, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  blockedRequests,
  close,
  dataDirOf,
  EXAMPLE_ANSWERS,
  executablePath,
  launch,
  newEnv,
  SAMPLE,
  setupDefault,
  stubOpenDialog,
  stubSaveDialog,
  type Running
} from './harness'

// ---------------------------------------------------------------------------
// Helpers that drive the real UI

async function createModule(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    location.hash = '#/modules'
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Modules' })).toBeVisible()
  await page.getByRole('button', { name: 'New module' }).first().click()
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create module' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

async function importCsv(r: Running, file: string): Promise<void> {
  const { app, page } = r
  await page.getByRole('link', { name: 'Upload quiz' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Upload a quiz' })).toBeVisible()
  await stubOpenDialog(app, file)
  await page.getByTestId('choose-csv').click()
}

async function importSample(r: Running): Promise<void> {
  await importCsv(r, SAMPLE)
  await r.page.getByTestId('save-import').click()
  await expect(r.page.getByTestId('start-quiz')).toBeVisible()
}

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

async function onQuestion(page: Page, n: number): Promise<void> {
  await expect(page.locator('.question-n')).toHaveText(String(n).padStart(2, '0'))
}

/** Answer with the keyboard: letters are pressed in turn, then Enter moves on. */
async function answer(page: Page, answers: string[]): Promise<void> {
  for (let i = 0; i < answers.length; i++) {
    await onQuestion(page, i + 1)
    for (const letter of answers[i].toLowerCase()) await page.keyboard.press(letter)
    for (const letter of answers[i]) {
      await expect(page.getByTestId(`option-${letter}`)).toHaveAttribute('aria-checked', 'true')
    }
    await page.keyboard.press('Enter')
  }
}

async function takeQuiz(page: Page, answers: string[], waitSeconds = 0): Promise<void> {
  await page.getByTestId('start-quiz').click()
  await onQuestion(page, 1)
  if (waitSeconds) await page.waitForTimeout(waitSeconds * 1000)
  await answer(page, answers)
  await expect(page.getByRole('heading', { name: 'Ready to submit?' })).toBeVisible()
  await page.getByTestId('submit').click()
  await expect(page.getByTestId('result-pct')).toBeVisible()
}

// ---------------------------------------------------------------------------

test.describe('packaged app', () => {
  test('first run creates the chosen data folder and remembers it after restart', async () => {
    const env = newEnv()
    let r = await launch(env)
    await expect(r.page.getByRole('heading', { name: /Every quiz you take/ })).toBeVisible()
    await expect(r.page.getByTestId('data-path')).toHaveText(dataDirOf(env))
    await setupDefault(r.page)
    for (const p of ['userdata.sqlite', 'quizzes', 'backups']) {
      expect(fs.existsSync(path.join(dataDirOf(env), p))).toBe(true)
    }
    const config = JSON.parse(fs.readFileSync(path.join(env.userData, 'config.json'), 'utf8'))
    expect(config).toEqual({ dataDir: dataDirOf(env) })
    expect(r.consoleErrors).toEqual([])
    await close(r)

    r = await launch(env)
    await expect(r.page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect(r.page.getByText('Nothing counted yet.')).toBeVisible()
    await close(r)
  })

  test('choosing a folder with existing data reuses it without overwriting', async () => {
    const env = newEnv()
    let r = await launch(env)
    await setupDefault(r.page)
    await createModule(r.page, 'Organic Chemistry')
    await close(r)

    const dbFile = path.join(dataDirOf(env), 'userdata.sqlite')
    const before = fs.readFileSync(dbFile)
    // A second device: fresh settings, same synced folder.
    const second = { ...env, userData: path.join(env.root, 'userData-2') }
    r = await launch(second)
    await expect(r.page.getByTestId('existing-data')).toContainText('1 module')
    expect(fs.readFileSync(dbFile).equals(before)).toBe(true)
    await r.page.getByRole('button', { name: 'Use this existing data' }).click()
    await nav(r.page, 'Modules').click()
    await expect(r.page.getByRole('link', { name: 'Organic Chemistry' })).toBeVisible()
    await close(r)
  })

  test('a missing data folder shows recovery and creates nothing', async () => {
    const env = newEnv()
    let r = await launch(env)
    await setupDefault(r.page)
    await close(r)

    const moved = path.join(env.root, 'elsewhere')
    fs.renameSync(dataDirOf(env), moved)
    r = await launch(env)
    await expect(r.page.getByTestId('recovery')).toBeVisible()
    await expect(r.page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(r.page.getByRole('button', { name: /Locate folder/ })).toBeVisible()
    await expect(r.page.getByRole('button', { name: 'Choose new location' })).toBeVisible()
    expect(fs.existsSync(dataDirOf(env))).toBe(false)

    // Retry does not create anything either.
    await r.page.getByRole('button', { name: 'Retry' }).click()
    await expect(r.page.getByText(/Still not available/)).toBeVisible()
    expect(fs.existsSync(dataDirOf(env))).toBe(false)

    // Locate the moved folder.
    await stubOpenDialog(r.app, moved)
    await r.page.getByRole('button', { name: /Locate folder/ }).click()
    await expect(r.page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    expect(JSON.parse(fs.readFileSync(path.join(env.userData, 'config.json'), 'utf8')).dataDir).toBe(moved)
    await close(r)
  })

  test('create a module, import the sample, take it twice with both question types', async () => {
    const env = newEnv()
    let r = await launch(env)
    await setupDefault(r.page)
    await createModule(r.page, 'Foundations')
    await importSample(r)
    await expect(r.page.getByRole('heading', { level: 1, name: 'Example quiz' })).toBeVisible()
    expect(fs.existsSync(path.join(dataDirOf(env), 'quizzes', 'Foundations', 'Example quiz v1.csv'))).toBe(true)

    // Attempt 1: everything right except the last question (1 mark). 16 / 17.
    const first = [...EXAMPLE_ANSWERS.slice(0, 11), 'A']
    await takeQuiz(r.page, first, 3)
    await expect(r.page.getByTestId('result-mark')).toHaveText(/^16\s*\/\s*17$/)
    await expect(r.page.getByTestId('result-pct')).toHaveText('94%')
    await expect(r.page.getByTestId('result-attempt')).toHaveText('#1')
    const time = await r.page.getByTestId('result-time').textContent()
    const seconds = Number(/(\d+)s/.exec(time ?? '')?.[1] ?? 0) + 60 * Number(/(\d+)m/.exec(time ?? '')?.[1] ?? 0)
    expect(seconds).toBeGreaterThanOrEqual(3)
    expect(seconds).toBeLessThan(120)
    await expect(r.page.getByTestId('review-item')).toHaveCount(12)

    // Attempt 2: all right.
    await r.page.getByRole('link', { name: 'Retry quiz' }).click()
    await takeQuiz(r.page, EXAMPLE_ANSWERS)
    await expect(r.page.getByTestId('result-mark')).toHaveText(/^17\s*\/\s*17$/)
    await expect(r.page.getByTestId('result-pct')).toHaveText('100%')
    await expect(r.page.getByTestId('result-attempt')).toHaveText('#2')
    await expect(r.page.getByText('Your best on this quiz')).toBeVisible()
    expect(r.consoleErrors).toEqual([])
    expect(await blockedRequests(r.app)).toEqual([])
    await close(r)

    // Everything is still there after a restart.
    r = await launch(env)
    await nav(r.page, 'History').click()
    await expect(r.page.locator('table tbody tr')).toHaveCount(2)
    await expect(r.page.getByText('2 attempts')).toBeVisible()
    await close(r)
  })

  test('closing mid-quiz allows resuming with answers intact', async () => {
    const env = newEnv()
    let r = await launch(env)
    await setupDefault(r.page)
    await createModule(r.page, 'Resume test')
    await importSample(r)
    await r.page.getByTestId('start-quiz').click()
    await answer(r.page, EXAMPLE_ANSWERS.slice(0, 2))
    await onQuestion(r.page, 3)
    await r.page.keyboard.press('f')
    await expect(r.page.locator('.take-save')).toHaveText('Saved')
    await close(r)

    r = await launch(env)
    await expect(r.page.getByTestId('resume-card')).toBeVisible()
    await r.page.getByTestId('resume-card').getByRole('link', { name: /Resume/ }).click()
    await onQuestion(r.page, 3)
    await expect(r.page.locator('.nav-q.is-flagged')).toHaveCount(1)
    await r.page.keyboard.press('ArrowLeft')
    await r.page.keyboard.press('ArrowLeft')
    await onQuestion(r.page, 1)
    await expect(r.page.getByTestId('option-C')).toHaveAttribute('aria-checked', 'true')
    await r.page.keyboard.press('ArrowRight')
    await onQuestion(r.page, 2)
    for (const l of 'ACE') await expect(r.page.getByTestId(`option-${l}`)).toHaveAttribute('aria-checked', 'true')
    await expect(r.page.getByTestId('option-B')).toHaveAttribute('aria-checked', 'false')
    await close(r)
  })

  test('an invalid CSV saves nothing and lists row-specific errors', async () => {
    const env = newEnv()
    const r = await launch(env)
    await setupDefault(r.page)
    await createModule(r.page, 'Errors')
    const bad = path.join(env.root, 'broken quiz.csv')
    fs.writeFileSync(
      bad,
      [
        'question,option_a,option_b,option_c,option_d,option_e,type,correct',
        'Fine?,a,b,c,d,e,single,A',
        'Two answers?,a,b,c,d,e,single,A;B',
        'Duplicate?,a,b,b,d,e,multi,A',
        'Missing,a,b,c,d,,single,Z'
      ].join('\n')
    )
    await importCsv(r, bad)
    const table = r.page.getByTestId('import-errors')
    await expect(table).toBeVisible()
    await expect(table).toContainText('Nothing has been saved')
    const rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(0)).toContainText('3')
    await expect(rows.nth(0)).toContainText('correct')
    await expect(rows.nth(1)).toContainText('option_c')
    await expect(rows.nth(2)).toContainText('option_e')
    await expect(rows.nth(3)).toContainText('"Z" is not an option letter')
    await expect(r.page.getByTestId('save-import')).toHaveCount(0)

    await nav(r.page, 'Modules').click()
    await r.page.getByRole('link', { name: 'Errors' }).click()
    await expect(r.page.getByText('No quizzes in this module yet.')).toBeVisible()
    expect(fs.readdirSync(path.join(dataDirOf(env), 'quizzes'))).toEqual([])
    await close(r)
  })

  test('maths and code render; HTML in a CSV is shown as text and never runs', async () => {
    const env = newEnv()
    const r = await launch(env)
    await setupDefault(r.page)
    await createModule(r.page, 'Rendering')
    const file = path.join(env.root, 'render.csv')
    fs.writeFileSync(
      file,
      [
        'question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic',
        '"<img src=x onerror=""window.__pwned=1""> What is $\\frac{1}{2} + \\frac{1}{2}$?",$1$,$2$,`one`,<b>bold</b>,<script>window.__pwned=2</script>,single,A,1,"$$\\int_0^1 1\\,dx = 1$$",Maths'
      ].join('\n')
    )
    await importCsv(r, file)
    await expect(r.page.locator('.qpreview .katex').first()).toBeVisible()
    await r.page.getByTestId('save-import').click()
    await r.page.getByTestId('start-quiz').click()
    const prompt = r.page.locator('.question-prompt')
    await expect(prompt).toContainText('<img src=x onerror="window.__pwned=1">')
    await expect(prompt.locator('.katex')).toHaveCount(1)
    await expect(prompt.locator('img')).toHaveCount(0)
    await expect(r.page.locator('.opt code')).toHaveText('one')
    await expect(r.page.getByTestId('option-D')).toContainText('<b>bold</b>')
    await expect(r.page.locator('.opt b')).toHaveCount(0)
    await expect(r.page.locator('.question script')).toHaveCount(0)
    expect(await r.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
    expect(r.consoleErrors).toEqual([])
    expect(await blockedRequests(r.app)).toEqual([])
    await close(r)
  })

  test('export, restore, move the data folder, and startup backups', async () => {
    const env = newEnv()
    let r = await launch(env)
    await setupDefault(r.page)
    await createModule(r.page, 'Kept module')
    await close(r)

    // Startup backups: each launch with data takes one.
    r = await launch(env)
    await nav(r.page, 'Settings').click()
    await expect(r.page.getByRole('button', { name: 'Back up now' })).toBeVisible()
    const backups = fs.readdirSync(path.join(dataDirOf(env), 'backups')).filter((f) => f.endsWith('-startup.sqlite'))
    expect(backups.length).toBeGreaterThanOrEqual(1)

    // Export.
    const exported = path.join(env.root, 'export.sqlite')
    await stubSaveDialog(r.app, exported)
    await r.page.getByRole('button', { name: /Export…/ }).click()
    await expect(r.page.getByText('Export saved and verified.')).toBeVisible()
    expect(fs.statSync(exported).size).toBeGreaterThan(0)

    // Change something, then restore the export.
    await createModule(r.page, 'Added later')
    await nav(r.page, 'Settings').click()
    await stubOpenDialog(r.app, exported)
    await r.page.getByRole('button', { name: /Restore…/ }).click()
    await expect(r.page.getByText(/is a valid Tally file with 1 module/)).toBeVisible()
    await r.page.getByTestId('confirm-restore').click()
    await expect(r.page.getByText('Restored. Your previous data was backed up first.')).toBeVisible()
    await nav(r.page, 'Modules').click()
    await expect(r.page.getByRole('link', { name: 'Kept module' })).toBeVisible()
    await expect(r.page.getByRole('link', { name: 'Added later' })).toHaveCount(0)
    expect(fs.readdirSync(path.join(dataDirOf(env), 'backups')).some((f) => f.endsWith('-pre-restore.sqlite'))).toBe(true)

    // Move.
    const target = path.join(env.root, 'Synced')
    fs.mkdirSync(target)
    await nav(r.page, 'Settings').click()
    await r.page.getByRole('button', { name: 'Move…' }).click()
    await stubOpenDialog(r.app, target)
    await r.page.getByRole('button', { name: /Choose new folder/ }).click()
    await expect(r.page.getByText('Data moved. The old copy was removed.')).toBeVisible()
    const newDir = path.join(target, 'Tally Data')
    await expect(r.page.getByTestId('settings-path')).toHaveText(newDir)
    expect(fs.existsSync(path.join(newDir, 'userdata.sqlite'))).toBe(true)
    expect(fs.existsSync(dataDirOf(env))).toBe(false)
    await close(r)

    r = await launch(env)
    await nav(r.page, 'Modules').click()
    await expect(r.page.getByRole('link', { name: 'Kept module' })).toBeVisible()
    expect(r.consoleErrors).toEqual([])
    await close(r)
  })

  test('launching a second time focuses the original window', async () => {
    const env = newEnv()
    const r = await launch(env)
    await setupDefault(r.page)
    const signalled = r.app.evaluate(
      ({ app }) => new Promise<boolean>((resolve) => app.once('second-instance', () => resolve(true)))
    )
    const second = spawn(executablePath(), process.platform === 'linux' ? ['--no-sandbox'] : [], {
      env: { ...process.env, TALLY_USER_DATA: env.userData, TALLY_DEFAULT_LOCATION: env.documents },
      stdio: 'ignore'
    })
    const exitCode = await new Promise<number | null>((resolve) => second.on('exit', resolve))
    expect(exitCode).toBe(0)
    expect(await signalled).toBe(true)
    const windows = await r.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), minimized: w.isMinimized() }))
    )
    expect(windows).toEqual([{ visible: true, minimized: false }])
    await close(r)
  })

  test('the window enforces its minimum size and security settings', async () => {
    const env = newEnv()
    const r = await launch(env)
    const info = await r.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const prefs = w.webContents.getLastWebPreferences()
      return {
        min: w.getMinimumSize(),
        contextIsolation: prefs?.contextIsolation,
        sandbox: prefs?.sandbox,
        nodeIntegration: prefs?.nodeIntegration
      }
    })
    expect(info).toEqual({ min: [900, 620], contextIsolation: true, sandbox: true, nodeIntegration: false })
    expect(await r.page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
    expect(await r.page.evaluate(() => Object.keys((window as unknown as { tally: object }).tally).sort())).toEqual(['invoke', 'platform'])
    // In-app navigation away from the app is refused.
    await r.page.evaluate(() => {
      location.href = 'https://example.com/'
    })
    await r.page.waitForTimeout(500)
    expect(r.page.url()).toMatch(/^app:\/\/tally\//)
    expect(await blockedRequests(r.app)).toEqual([])
    await close(r)
  })
})
