import { expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { APPLICATION_ID, MIGRATIONS } from '../../src/main/db/schema'
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
  await page.getByRole('link', { name: 'New quiz' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'New quiz' })).toBeVisible()
  await page.getByTestId('method-file').click()
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
      const prefs = (w.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences | null }).getLastWebPreferences()
      return {
        min: w.getMinimumSize(),
        contextIsolation: prefs?.contextIsolation,
        sandbox: prefs?.sandbox,
        nodeIntegration: prefs?.nodeIntegration
      }
    })
    expect(info).toEqual({ min: [900, 620], contextIsolation: true, sandbox: true, nodeIntegration: false })
    expect(await r.page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
    expect(await r.page.evaluate(() => Object.keys((window as unknown as { tally: object }).tally).sort())).toEqual(['invoke', 'onSystemTheme', 'platform'])
    // In-app navigation away from the app is refused.
    await r.page.evaluate(() => {
      location.href = 'https://example.com/'
    })
    await r.page.waitForTimeout(500)
    expect(r.page.url()).toMatch(/^app:\/\/tally\//)
    expect(await blockedRequests(r.app)).toEqual([])
    await close(r)
  })

  test('opening data from an older version backs it up first, then upgrades it', async () => {
    const env = newEnv()
    const dir = dataDirOf(env)
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true })
    const db = new Database(path.join(dir, 'userdata.sqlite'))
    db.pragma('journal_mode = DELETE')
    db.pragma(`application_id = ${APPLICATION_ID}`)
    MIGRATIONS[0](db)
    db.pragma('user_version = 1')
    db.prepare(`INSERT INTO modules (name, colour, created_at) VALUES ('From v1', 'plum', '2026-01-01T00:00:00Z')`).run()
    db.prepare(`INSERT INTO settings (key, value) VALUES ('app_version', '0.9.0')`).run()
    db.close()
    const original = fs.readFileSync(path.join(dir, 'userdata.sqlite'))
    fs.mkdirSync(env.userData, { recursive: true })
    fs.writeFileSync(path.join(env.userData, 'config.json'), JSON.stringify({ dataDir: dir }))

    const r = await launch(env)
    await expect(r.page.getByText(/Updated to Tally .*Your data was backed up first\./)).toBeVisible()
    await r.page.getByTestId('skip-onboarding').click()
    const backups = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.endsWith('-pre-upgrade.sqlite'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, 'backups', backups[0])).equals(original)).toBe(true)
    await nav(r.page, 'Modules').click()
    await expect(r.page.getByRole('link', { name: 'From v1' })).toBeVisible()
    expect(r.consoleErrors).toEqual([])
    await close(r)
  })

  test('written questions: typed answers are saved, then marked against the scheme by hand', async () => {
    const env = newEnv()
    const r = await launch(env)
    await setupDefault(r.page)
    await createModule(r.page, 'Biology')
    const file = path.join(env.root, 'written.csv')
    fs.writeFileSync(
      file,
      [
        'question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic,model_answer,mark_scheme',
        '"Which organelle makes most ATP?",Nucleus,Mitochondrion,Ribosome,Golgi body,Lysosome,single,B,1,,Cells,,',
        '"Explain why enzymes stop working at high temperatures.",,,,,,written,,3,,Enzymes,"Bonds holding the tertiary structure break, so the enzyme denatures; the active site changes shape and the substrate no longer fits.","[1] The enzyme is denatured / loses its shape; [1] The active site changes shape; [1] The substrate no longer fits the active site"'
      ].join('\n')
    )
    await importCsv(r, file)
    await expect(r.page.getByText('Model answer').first()).toBeVisible()
    await r.page.getByTestId('save-import').click()
    await r.page.getByTestId('start-quiz').click()
    await onQuestion(r.page, 1)
    await r.page.keyboard.press('b')
    await r.page.keyboard.press('Enter')
    await onQuestion(r.page, 2)
    await expect(r.page.getByText('Written answer')).toBeVisible()
    const box = r.page.getByTestId('written-input')
    await box.click()
    // Letters typed in the box must not trigger shortcuts.
    await box.fill('')
    await r.page.keyboard.type('The heat denatures the enzyme. Flag: f')
    await expect(box).toHaveValue('The heat denatures the enzyme. Flag: f')
    await expect(r.page.locator('.nav-q.is-flagged')).toHaveCount(0)
    await expect(r.page.locator('.take-save')).toHaveText('Saved')
    await r.page.keyboard.press('Escape')
    await r.page.keyboard.press('Enter')
    await expect(r.page.getByRole('heading', { name: 'Ready to submit?' })).toBeVisible()
    await r.page.getByTestId('submit').click()

    await expect(r.page.getByTestId('needs-marking')).toBeVisible()
    await expect(r.page.getByTestId('result-mark')).toHaveText(/^1\s*\/\s*4$/)
    const editor = r.page.getByTestId('mark-editor')
    await expect(editor).toBeVisible()
    await editor.getByRole('radiogroup', { name: 'Marks for point 1' }).getByRole('radio', { name: '1' }).click()
    await editor.getByTestId('save-marks').click()
    await expect(r.page.getByTestId('needs-marking')).toHaveCount(0)
    await expect(r.page.getByTestId('result-mark')).toHaveText(/^2\s*\/\s*4$/)
    await expect(r.page.getByTestId('result-pct')).toHaveText('50%')
    await expect(r.page.getByText('Marked by you.')).toBeVisible()
    expect(r.consoleErrors).toEqual([])
    await close(r)
  })

  test('onboarding offers AI setup and chat guides without a key', async () => {
    const env = newEnv()
    const r = await launch(env)
    await r.page.getByRole('button', { name: /Create my data folder/ }).click()
    await expect(r.page.getByTestId('onboarding')).toBeVisible()
    await r.page.getByTestId('path-chat').click()
    for (const name of ['Claude', 'ChatGPT', 'Gemini']) {
      await r.page.getByRole('radio', { name, exact: true }).click()
      await expect(r.page.getByText(`For one quiz in ${name}`)).toBeVisible()
    }
    await r.page.getByRole('radio', { name: 'With written answers' }).click()
    await expect(r.page.locator('.prompt')).toContainText('mark_scheme')
    await r.page.getByTestId('path-ai').click()
    await r.page.getByTestId('ai-key').fill('not-a-key-at-all')
    await r.page.getByTestId('save-key').click()
    await expect(r.page.getByText(/does not look like an OpenRouter key/)).toBeVisible()
    await r.page.getByTestId('finish-onboarding').click()
    await expect(r.page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    expect(await blockedRequests(r.app)).toEqual([])
    await close(r)

    // Not shown again.
    const again = await launch(env)
    await expect(again.page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await close(again)
  })

  // Live test against OpenRouter. Runs only when a key is provided in the environment;
  // the key is typed into the app like a user would and is never written to the repository.
  test('AI: connect a key, generate a mixed quiz from a PDF, and have written answers marked', async () => {
    const key = process.env.TALLY_E2E_OPENROUTER_KEY
    test.skip(!key, 'Set TALLY_E2E_OPENROUTER_KEY to run the live AI test')
    test.setTimeout(12 * 60_000)
    const env = newEnv()
    const r = await launch(env)
    await r.page.getByRole('button', { name: /Create my data folder/ }).click()
    await r.page.getByTestId('path-ai').click()
    await r.page.getByTestId('ai-key').fill(key!)
    await r.page.getByTestId('save-key').click()
    await expect(r.page.getByTestId('ai-connected')).toBeVisible({ timeout: 30_000 })
    if (process.env.TALLY_E2E_MODEL) {
      await r.app.evaluate(() => undefined)
      await r.page.getByTestId('model-select').selectOption(process.env.TALLY_E2E_MODEL)
    }
    await r.page.getByTestId('finish-onboarding').click()
    await createModule(r.page, 'Plant biology')

    await r.page.getByRole('link', { name: 'New quiz' }).first().click()
    await r.page.getByTestId('method-ai').click()
    await r.page.getByTestId('gen-topic').fill('Photosynthesis: what it does and where it happens.')
    await stubOpenDialog(r.app, path.resolve(__dirname, '../fixtures/sample.pdf'))
    await r.page.getByRole('button', { name: /Add files/ }).click()
    await expect(r.page.getByRole('checkbox', { name: /Sample/ })).toBeChecked()
    await r.page.getByRole('radiogroup', { name: 'Question format' }).getByRole('radio', { name: 'Mixed' }).click()
    await r.page.locator('input[type=range]').fill('4')
    await r.page.getByTestId('generate').click()
    await expect(r.page.getByTestId('ai-generated')).toBeVisible({ timeout: 5 * 60_000 })
    await expect(r.page.getByTestId('import-errors')).toHaveCount(0)
    if (process.env.TALLY_SCREENSHOTS) await r.page.screenshot({ path: path.resolve(__dirname, '../../screenshots/ai-preview.png'), fullPage: true })
    await r.page.getByTestId('save-import').click()

    await r.page.getByTestId('start-quiz').click()
    const total = await r.page.locator('.nav-q:not(.nav-q-submit)').count()
    for (let i = 1; i <= total; i++) {
      await onQuestion(r.page, i)
      if (await r.page.getByTestId('written-input').count()) {
        await r.page.getByTestId('written-input').fill(
          'Photosynthesis converts light energy into chemical energy stored in glucose, and it takes place in the chloroplasts.'
        )
        await expect(r.page.locator('.take-save')).toHaveText('Saved')
        await r.page.keyboard.press('Escape')
      } else {
        await r.page.keyboard.press('a')
      }
      await r.page.keyboard.press('Enter')
    }
    await r.page.getByTestId('submit').click()
    await expect(r.page.getByTestId('result-pct')).toBeVisible({ timeout: 5 * 60_000 })
    if (process.env.TALLY_E2E_VERBOSE) {
      const mirror = path.join(dataDirOf(env), 'quizzes', 'Plant biology')
      for (const f of fs.readdirSync(mirror)) console.log(fs.readFileSync(path.join(mirror, f), 'utf8'))
      console.log(await r.page.locator('.written-review').allInnerTexts())
    }
    if (process.env.TALLY_SCREENSHOTS) {
      await r.page.locator('#review-h').scrollIntoViewIfNeeded()
      await r.page.screenshot({ path: path.resolve(__dirname, '../../screenshots/ai-results.png') })
    }
    const written = await r.page.locator('.written-review').count()
    if (written > 0) {
      await expect(r.page.getByText(/Marked by .* against the mark scheme/).first()).toBeVisible()
    }

    // The PDF was saved to the module and the quiz remembers it.
    await r.page.locator('.eyebrow a').nth(1).click()
    await expect(r.page.getByTestId('generated-from')).toContainText('Sample')
    const before = Number((await r.page.locator('.facts dd').first().textContent()) ?? 0)
    await r.page.getByTestId('extend').click()
    await expect(r.page.getByText(/Adding new questions to/)).toBeVisible()
    await expect(r.page.getByRole('checkbox', { name: /Sample/ })).toBeChecked()
    await r.page.locator('input[type=range]').fill('3')
    await r.page.getByTestId('generate').click()
    await expect(r.page.getByTestId('ai-generated')).toContainText(/new questions? added/, { timeout: 5 * 60_000 })
    await expect(r.page.getByRole('button', { name: /Save as version 2/ })).toBeVisible()
    await r.page.getByTestId('save-import').click()
    await expect(r.page.getByText('v2').first()).toBeVisible()
    const after = Number((await r.page.locator('.facts dd').first().textContent()) ?? 0)
    expect(after).toBeGreaterThan(before)
    await nav(r.page, 'Modules').click()
    await r.page.getByRole('link', { name: 'Plant biology' }).click()
    await expect(r.page.getByTestId('materials')).toContainText('In 2 quiz versions')
    expect(await blockedRequests(r.app)).toEqual([])
    expect(r.consoleErrors).toEqual([])
    await close(r)
  })

  test('module materials: add week by week, rename, see what is not quizzed yet, remove', async () => {
    const env = newEnv()
    let r = await launch(env)
    await setupDefault(r.page)
    await createModule(r.page, 'Cell Biology')
    const w1 = path.join(env.root, 'week_1_membranes.md')
    fs.writeFileSync(w1, '# Membranes\n\nThe phospholipid bilayer is selectively permeable. Osmosis moves water.')
    await stubOpenDialog(r.app, w1)
    await r.page.getByTestId('add-materials').click()
    const section = r.page.getByTestId('materials')
    await expect(section).toContainText('Week 1 membranes')
    await expect(section).toContainText('Not quizzed yet')
    await expect(section.getByTestId('quiz-unused')).toContainText('Quiz the new one')
    expect(fs.existsSync(path.join(dataDirOf(env), 'materials', 'Cell Biology', 'week_1_membranes.md'))).toBe(true)

    // Rename.
    await section.getByRole('button', { name: 'Week 1 membranes', exact: true }).click()
    await section.getByLabel('Label').fill('Week 1 – Membranes')
    await section.getByRole('button', { name: 'Save' }).click()
    await expect(section).toContainText('Week 1 – Membranes')

    // The same file again is refused.
    await stubOpenDialog(r.app, w1)
    await r.page.getByTestId('add-materials').click()
    await expect(section).toContainText('already in Cell Biology')

    // A second week, then the generate shortcut preselects the unused ones.
    const w2 = path.join(env.root, 'week2.txt')
    fs.writeFileSync(w2, 'Active transport uses carrier proteins and ATP to move substances against a gradient.')
    await stubOpenDialog(r.app, w2)
    await r.page.getByTestId('add-materials').click()
    await expect(section.getByTestId('quiz-unused')).toContainText('Quiz the 2 new ones')
    await section.getByTestId('quiz-unused').click()
    await expect(r.page.getByRole('heading', { level: 1, name: 'New quiz' })).toBeVisible()
    await close(r)

    // Persisted after a restart; remove one.
    r = await launch(env)
    await nav(r.page, 'Modules').click()
    await r.page.getByRole('link', { name: 'Cell Biology' }).click()
    const again = r.page.getByTestId('materials')
    await expect(again).toContainText('2 files')
    await again.getByRole('button', { name: 'Remove Week2' }).click()
    await r.page.getByRole('button', { name: 'Remove material' }).click()
    await expect(again).toContainText('1 file')
    expect(fs.existsSync(path.join(dataDirOf(env), 'materials', 'Cell Biology', 'week2.txt'))).toBe(false)
    expect(r.consoleErrors).toEqual([])
    await close(r)
  })
})
