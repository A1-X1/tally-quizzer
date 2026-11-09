import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { blockedRequests, close, launch, newEnv } from './harness'
import { seedRealistic } from './seed'

// Design-review screenshots with realistic data, at the minimum and a large
// window size, in light and dark. Also asserts no console errors on any page.
const OUT = path.resolve(__dirname, '../../screenshots')
const SIZES = [
  { name: 'min', width: 900, height: 620 },
  { name: 'large', width: 1600, height: 1000 }
]

for (const theme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    test(`screens ${theme} ${size.name}`, async () => {
      test.skip(!process.env.TALLY_SCREENSHOTS, 'Set TALLY_SCREENSHOTS=1 to capture design screenshots')
      fs.mkdirSync(OUT, { recursive: true })
      const env = newEnv()
      seedRealistic(env.userData, env.documents, theme)
      const r = await launch(env)
      const { app, page } = r
      await app.evaluate(({ BrowserWindow }, s) => {
        const w = BrowserWindow.getAllWindows()[0]
        w.unmaximize()
        w.setContentSize(s.width, s.height)
      }, size)
      await page.waitForTimeout(400)
      const shot = async (name: string): Promise<void> => {
        await page.waitForTimeout(350)
        await page.screenshot({ path: path.join(OUT, `${theme}-${size.name}-${name}.png`) })
      }
      const go = async (hash: string, name: string, ready: string): Promise<void> => {
        await page.evaluate((h) => (location.hash = h), hash)
        await expect(page.locator(ready).first()).toBeVisible()
        await shot(name)
      }
      await go('#/', 'dashboard', '.headline')
      await page.locator('#main').evaluate((m) => m.scrollTo(0, 900))
      await shot('dashboard-lower')
      const scrollTo = async (sel: string, name: string): Promise<void> => {
        await page.locator(sel).scrollIntoViewIfNeeded()
        await page.locator(sel).evaluate((el) => el.scrollIntoView({ block: 'start' }))
        await page.waitForTimeout(900)
        await shot(name)
      }
      await scrollTo('#time-h', 'dashboard-time')
      await scrollTo('#pat-h', 'dashboard-patterns')
      await page.locator('#main').evaluate((m) => m.scrollTo(0, 0))
      await page.getByRole('radio', { name: 'Weekly average' }).click()
      await page.locator('#chart-h').evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(900)
      await shot('dashboard-weekly')
      await go('#/modules', 'modules', '.page-title')
      await go('#/modules/1', 'module', '.page-title')
      await go('#/quiz/4', 'quiz-setup', '[data-testid=start-quiz]')
      await scrollTo('#qt-h', 'quiz-timing')
      await go('#/history', 'history', 'table')
      await go('#/help', 'help', '.help-toc')
      await go('#/help/ai', 'help-ai', '.prompt')
      await go('#/settings', 'settings', '[data-testid=settings-path]')
      await go('#/upload?module=1', 'upload', '.upload-step')
      await go('#/result/26', 'result', '[data-testid=result-pct]')
      await scrollTo('#time-h', 'result-time')
      await page.locator('#main').evaluate((m) => m.scrollTo(0, 2200))
      await shot('result-review')
      const resume = page.getByTestId('resume-card')
      await page.evaluate(() => (location.hash = '#/'))
      await resume.getByRole('link').click()
      await expect(page.locator('.question-prompt')).toBeVisible()
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('a')
      await shot('take-single')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('a')
      await page.keyboard.press('c')
      await page.keyboard.press('f')
      await shot('take-multi')
      expect(r.consoleErrors).toEqual([])
      expect(await blockedRequests(app)).toEqual([])
      await close(r)
    })
  }
  test(`welcome ${theme}`, async () => {
    test.skip(!process.env.TALLY_SCREENSHOTS, 'Set TALLY_SCREENSHOTS=1 to capture design screenshots')
    const env = newEnv()
    const r = await launch(env)
    await r.app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
    for (const size of SIZES) {
      await r.app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height), size)
      await r.page.waitForTimeout(400)
      await r.page.screenshot({ path: path.join(OUT, `${theme}-${size.name}-welcome.png`) })
    }
    await close(r)
  })
}
