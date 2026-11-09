import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Channel, IpcEnvelope, Req, Res } from '../shared/api'
import { MAX_CSV_BYTES, RELEASES_URL } from '../shared/api'
import { MODULE_COLOURS, type HistoryFilter, type ImportResult } from '../shared/types'
import {
  adopt,
  afterOpen,
  bootState,
  closeDb,
  ctx,
  defaultLocation,
  requireDb,
  tryOpenConfigured
} from './context'
import { checkDatabaseFile, openDatabase, recordAppVersion } from './db/connection'
import {
  backupTo,
  copyDataFolder,
  createBackup,
  createDataFolder,
  openDataFolder,
  dataInfo,
  DB_FILE,
  inspectLocation,
  rememberInspection,
  removeOldData,
  takeInspection,
  writeMirror,
  DATA_FOLDER_NAME
} from './storage'
import * as modules from './services/modules'
import * as quizzes from './services/quizzes'
import * as attempts from './services/attempts'
import * as analytics from './services/analytics'
import { UserError } from './services/rows'
import { toCsv } from './csv/parse'
import templateCsv from '../../samples/template.csv?raw'
import exampleCsv from '../../samples/example_quiz.csv?raw'
import { applyTitleBarTheme, isTrustedUrl } from './window'
import { checkForUpdates, isOfferedDownload } from './updates'
import * as ai from './ai/service'
import { aiSettings, forgetKey, loadKey, saveKey, setAiMarking, setModel } from './ai/keystore'
import { verifyKey } from './ai/openrouter'
import { MAX_SOURCE_BYTES, SOURCE_EXTENSIONS } from './ai/extract'
import type { DB } from './db/connection'

/** Whether an attempt asked for AI marking and a key is available to do it. */
function attemptUsesAi(db: DB, attemptId: number): boolean {
  const settings = db.prepare('SELECT settings_json FROM attempts WHERE id = ?').pluck().get(attemptId) as string | undefined
  try {
    return !!settings && (JSON.parse(settings) as { aiMarking?: boolean }).aiMarking === true && !!loadKey() && !!aiSettings().model
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Validation schemas

const id = z.number().int().positive()
const text = (max: number) => z.string().max(max)
const nullableText = (max: number) => z.string().max(max).nullable()

const moduleInput = z
  .object({
    name: text(120),
    code: nullableText(40),
    colour: z.enum(MODULE_COLOURS),
    description: nullableText(2000)
  })
  .strict()

const settingsSchema = z
  .object({
    shuffleQuestions: z.boolean(),
    shuffleOptions: z.boolean(),
    feedback: z.enum(['end', 'each']),
    timeLimitMinutes: z.number().int().min(1).max(600).nullable(),
    marking: z.enum(['strict', 'partial']),
    aiMarking: z.boolean().optional(),
    questionTypes: z.enum(['all', 'choice', 'written']).optional()
  })
  .strict()

const isoDate = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date')

const historyFilter = z
  .object({
    moduleId: id.nullable(),
    quizId: id.nullable(),
    from: isoDate.nullable(),
    to: isoDate.nullable(),
    minScore: z.number().min(0).max(100).nullable(),
    maxScore: z.number().min(0).max(100).nullable(),
    includePractice: z.boolean()
  })
  .strict()

const csvText = z.string().max(MAX_CSV_BYTES)
const filename = z.string().min(1).max(255)

// ---------------------------------------------------------------------------

type Handler<C extends Channel> = (req: Req<C>, event: IpcMainInvokeEvent) => Res<C> | Promise<Res<C>>

function handle<C extends Channel>(channel: C, schema: z.ZodType<Req<C>> | null, fn: Handler<C>): void {
  ipcMain.handle(channel, async (event, payload: unknown): Promise<IpcEnvelope<Res<C>>> => {
    if (!isTrustedUrl(event.senderFrame?.url ?? '')) {
      return { ok: false, error: 'Request rejected.' }
    }
    try {
      const req = (schema ? schema.parse(payload) : undefined) as Req<C>
      const data = await fn(req, event)
      return { ok: true, data }
    } catch (e) {
      if (e instanceof z.ZodError) {
        console.error(`[ipc] invalid payload for ${channel}:`, e.issues)
        return { ok: false, error: 'The request was not valid.' }
      }
      if (!(e instanceof UserError)) console.error(`[ipc] ${channel} failed:`, e)
      const message = e instanceof Error ? e.message : String(e)
      const code = e instanceof UserError ? e.code : 'ERROR'
      return { ok: false, error: `${code}::${message}` }
    }
  })
}

const win = (e: IpcMainInvokeEvent): BrowserWindow | undefined => BrowserWindow.fromWebContents(e.sender) ?? undefined

async function pickFolder(e: IpcMainInvokeEvent, title: string): Promise<string | null> {
  const w = win(e)
  const opts: Electron.OpenDialogOptions = {
    title,
    defaultPath: defaultLocation(),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate']
  }
  const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
}

async function saveDialog(e: IpcMainInvokeEvent, opts: Electron.SaveDialogOptions): Promise<string | null> {
  const w = win(e)
  const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  return res.filePath
}

function readCsvFile(file: string): { filename: string; text: string } {
  const stat = fs.statSync(file)
  if (stat.size > MAX_CSV_BYTES) {
    throw new UserError(`This file is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB. Split it into smaller quizzes.`)
  }
  const buf = fs.readFileSync(file)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  return { filename: path.basename(file), text }
}

function mirrorQuiz(result: ImportResult, moduleId: number, csv: string): void {
  const { dataDir, db } = requireDb()
  const m = modules.getModule(db, moduleId)
  writeMirror(dataDir, m.name, result.title, result.versionNo, csv)
}

const restoreTokens = new Map<string, string>()

function localStamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function localDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function registerIpc(): void {
  // ----- App -----
  handle('app:boot', null, () => bootState())
  handle('app:version', null, () => app.getVersion())
  handle('app:systemDark', null, () => nativeTheme.shouldUseDarkColors)
  handle('app:openReleases', null, async () => {
    await shell.openExternal(RELEASES_URL)
  })
  handle('app:setTitleBarTheme', z.object({ dark: z.boolean() }).strict(), (req, e) => {
    const w = win(e)
    if (w) applyTitleBarTheme(w, req.dark)
  })

  // ----- First run and recovery -----
  handle('setup:inspectDefault', null, () => rememberInspection(inspectLocation(defaultLocation())))
  handle('setup:pickFolder', null, async (_r, e) => {
    const dir = await pickFolder(e, 'Choose where to keep your Tally data')
    return dir ? rememberInspection(inspectLocation(dir)) : null
  })
  handle('setup:locate', null, async (_r, e) => {
    const dir = await pickFolder(e, `Locate your "${DATA_FOLDER_NAME}" folder`)
    return dir ? rememberInspection(inspectLocation(dir)) : null
  })
  handle('setup:create', z.object({ token: z.string().max(64) }).strict(), async (req) => {
    const i = takeInspection(req.token)
    // Re-check at the moment of creation; the folder may have changed.
    const now = inspectLocation(i.location)
    if (now.status === 'existing') throw new UserError('This folder already contains Tally data. Choose "Use this existing data" instead.')
    if (now.status !== 'new') throw new UserError(now.detail ?? 'Tally cannot use this folder.')
    const db = createDataFolder(now.dataDir, app.getVersion())
    adopt(db, now.dataDir, true)
    await afterOpen()
    return bootState()
  })
  handle('setup:useExisting', z.object({ token: z.string().max(64) }).strict(), async (req) => {
    const i = takeInspection(req.token)
    const now = inspectLocation(i.location)
    if (now.status !== 'existing') throw new UserError(now.detail ?? 'No Tally data was found in this folder.')
    const res = openDataFolder(now.dataDir, app.getVersion())
    if (!res.ok) throw new UserError(res.reason)
    adopt(res.db, now.dataDir, true)
    ctx.upgrade = res.upgrade
      ? { fromVersion: res.upgrade.fromVersion, toVersion: res.upgrade.toVersion, backup: res.upgrade.backup }
      : null
    await afterOpen()
    return bootState()
  })
  handle('setup:retry', null, async () => {
    const s = tryOpenConfigured()
    if (s.kind === 'ready') await afterOpen()
    return s
  })

  // ----- Modules -----
  handle('modules:list', z.object({ includeArchived: z.boolean() }).strict(), (req) =>
    modules.listModules(requireDb().db, req.includeArchived)
  )
  handle('modules:create', moduleInput, (req) => modules.createModule(requireDb().db, req))
  handle('modules:update', z.object({ id, input: moduleInput }).strict(), (req) =>
    modules.updateModule(requireDb().db, req.id, req.input)
  )
  handle('modules:archive', z.object({ id, archived: z.boolean() }).strict(), (req) =>
    modules.archiveModule(requireDb().db, req.id, req.archived)
  )
  handle('modules:delete', z.object({ id, confirmName: text(200) }).strict(), async (req) => {
    const { db, dataDir } = requireDb()
    const m = modules.getModule(db, req.id)
    if (req.confirmName.trim() !== m.name) throw new UserError('The name you typed does not match the module name.')
    await createBackup(db, dataDir, 'pre-delete')
    modules.deleteModule(db, req.id, req.confirmName)
  })
  handle('modules:detail', z.object({ id }).strict(), (req) => analytics.moduleDetail(requireDb().db, req.id))

  // ----- Quizzes -----
  handle('quizzes:detail', z.object({ id }).strict(), (req) => quizzes.quizDetail(requireDb().db, req.id))
  handle('quizzes:rename', z.object({ id, title: text(200), description: nullableText(2000) }).strict(), (req) =>
    quizzes.renameQuiz(requireDb().db, req.id, req.title, req.description)
  )
  handle('quizzes:archive', z.object({ id, archived: z.boolean() }).strict(), (req) =>
    quizzes.archiveQuiz(requireDb().db, req.id, req.archived)
  )
  handle('quizzes:delete', z.object({ id }).strict(), async (req) => {
    const { db, dataDir } = requireDb()
    await createBackup(db, dataDir, 'pre-delete')
    quizzes.deleteQuiz(db, req.id)
  })
  handle('quizzes:all', null, () => analytics.quizOptions(requireDb().db))

  // ----- Import -----
  handle('import:pickFile', null, async (_r, e) => {
    const w = win(e)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a quiz CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV files', extensions: ['csv', 'txt'] }]
    }
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return null
    return readCsvFile(res.filePaths[0])
  })
  handle('import:preview', z.object({ moduleId: id, filename, text: csvText }).strict(), (req) =>
    quizzes.previewImport(requireDb().db, req.moduleId, req.filename, req.text)
  )
  handle(
    'import:commit',
    z
      .object({
        moduleId: id,
        filename,
        text: csvText,
        title: text(200),
        mode: z.enum(['new', 'version']),
        targetQuizId: id.nullable()
      })
      .strict(),
    (req) => {
      const result = quizzes.commitImport(requireDb().db, req)
      mirrorQuiz(result, req.moduleId, req.text)
      return result
    }
  )
  handle('import:sample', null, () => {
    const { db } = requireDb()
    const name = 'Foundations of computing'
    const existing = modules.listModules(db, true).find((m) => m.name.toLowerCase() === name.toLowerCase())
    const mod =
      existing ??
      modules.createModule(db, {
        name,
        code: 'SAMPLE',
        colour: 'cobalt',
        description: 'The sample quiz that ships with Tally: logic, sets, relations and complexity.'
      })
    if (mod.archivedAt) modules.archiveModule(db, mod.id, false)
    const preview = quizzes.previewImport(db, mod.id, 'example_quiz.csv', exampleCsv)
    if (preview.duplicateOf) {
      return { quizId: preview.duplicateOf.quizId, versionNo: preview.duplicateOf.versionNo, title: preview.duplicateOf.title, moduleId: mod.id }
    }
    const result = quizzes.commitImport(db, {
      moduleId: mod.id,
      filename: 'example_quiz.csv',
      text: exampleCsv,
      title: 'Logic, sets and complexity',
      mode: 'new',
      targetQuizId: null
    })
    mirrorQuiz(result, mod.id, exampleCsv)
    return { ...result, moduleId: mod.id }
  })

  // ----- Attempts -----
  handle(
    'attempts:start',
    z
      .object({
        quizId: id,
        settings: settingsSchema,
        practiceFromAttemptId: id.nullable(),
        replaceInProgress: z.boolean()
      })
      .strict(),
    (req) => {
      const { db } = requireDb()
      const attemptId = attempts.startAttempt(db, req)
      return attempts.getSession(db, attemptId)
    }
  )
  handle('attempts:session', z.object({ id }).strict(), (req) => attempts.getSession(requireDb().db, req.id))
  handle(
    'attempts:answer',
    z.object({ attemptId: id, questionId: id, selected: z.array(id).max(5) }).strict(),
    (req) => attempts.saveAnswer(requireDb().db, req)
  )
  handle('attempts:reveal', z.object({ attemptId: id, questionId: id }).strict(), async (req) => {
    const { db } = requireDb()
    const fb = attempts.revealAnswer(db, req.attemptId, req.questionId)
    if (fb.written && !fb.written.marking && attemptUsesAi(db, req.attemptId)) {
      await ai.markOne(db, req.attemptId, req.questionId)
      return attempts.revealAnswer(db, req.attemptId, req.questionId)
    }
    return fb
  })
  handle(
    'attempts:answerWritten',
    z.object({ attemptId: id, questionId: id, text: z.string().max(8000) }).strict(),
    (req) => attempts.saveWritten(requireDb().db, req.attemptId, req.questionId, req.text)
  )
  handle('attempts:markWritten', z.object({ attemptId: id, questionId: id }).strict(), async (req) => {
    const { db } = requireDb()
    await ai.markOne(db, req.attemptId, req.questionId)
    return attempts.revealAnswer(db, req.attemptId, req.questionId)
  })
  handle(
    'attempts:adjustMarks',
    z.object({ attemptId: id, questionId: id, awarded: z.array(z.number().min(0).max(1000)).max(20) }).strict(),
    (req) => {
      const { db } = requireDb()
      attempts.adjustMarking(db, req.attemptId, req.questionId, req.awarded)
      return attempts.getResult(db, req.attemptId)
    }
  )
  handle('attempts:markPending', z.object({ id }).strict(), async (req) => {
    const { db } = requireDb()
    const r = await ai.markAll(db, req.id)
    if (r.failed > 0 && attempts.unmarkedWritten(db, req.id).length > 0) {
      throw new UserError(`${r.failed} written ${r.failed === 1 ? 'answer' : 'answers'} could not be marked by the AI. Mark ${r.failed === 1 ? 'it' : 'them'} yourself, or try again.`, 'AI')
    }
    return attempts.getResult(db, req.id)
  })
  handle('attempts:flag', z.object({ attemptId: id, questionId: id, flagged: z.boolean() }).strict(), (req) =>
    attempts.setFlag(requireDb().db, req.attemptId, req.questionId, req.flagged)
  )
  handle(
    'attempts:tick',
    z
      .object({
        attemptId: id,
        questionId: id.nullable(),
        seconds: z.number().min(0).max(attempts.MAX_TICK_SECONDS),
        position: z.number().int().min(0).max(10000),
        visit: z.boolean().optional()
      })
      .strict(),
    (req) => attempts.tick(requireDb().db, req)
  )
  handle('attempts:submit', z.object({ id }).strict(), async (req) => {
    const { db } = requireDb()
    attempts.submitAttempt(db, req.id)
    if (attemptUsesAi(db, req.id) && attempts.unmarkedWritten(db, req.id).length > 0) {
      // Any answer the AI cannot mark stays pending for the student to mark.
      await ai.markAll(db, req.id).catch(() => undefined)
    }
    return attempts.getResult(db, req.id)
  })
  handle('attempts:abandon', z.object({ id }).strict(), (req) => attempts.abandonAttempt(requireDb().db, req.id))
  handle('attempts:result', z.object({ id }).strict(), (req) => attempts.getResult(requireDb().db, req.id))
  handle('attempts:inProgress', null, () => attempts.inProgress(requireDb().db))

  // ----- Analytics and history -----
  handle(
    'stats:dashboard',
    z.object({ moduleId: id.nullable(), range: z.enum(['30d', '90d', '1y', 'all']) }).strict(),
    (req) => analytics.dashboard(requireDb().db, req.moduleId, req.range)
  )
  handle('history:list', historyFilter, (req) => analytics.history(requireDb().db, req as HistoryFilter))
  handle('history:export', historyFilter, async (req, e) => {
    const rows = analytics.history(requireDb().db, req as HistoryFilter)
    const file = await saveDialog(e, {
      title: 'Export attempt history',
      defaultPath: path.join(app.getPath('downloads'), `Tally history ${localStamp()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (!file) return { saved: false }
    const header = [
      'module',
      'quiz',
      'version',
      'attempt',
      'practice',
      'marking',
      'started_local',
      'submitted_local',
      'started_utc',
      'submitted_utc',
      'duration_seconds',
      'marks_awarded',
      'marks_available',
      'percentage',
      'questions'
    ]
    const body = rows.map((r) => [
      r.moduleName,
      r.quizTitle,
      r.versionNo,
      r.attemptNumber ?? '',
      r.isPractice ? 'yes' : 'no',
      r.markingMode,
      localDateTime(r.startedAt),
      localDateTime(r.submittedAt),
      r.startedAt,
      r.submittedAt ?? '',
      r.durationSeconds,
      r.marksAwarded ?? '',
      r.marksAvailable,
      r.percentage ?? '',
      r.questionCount
    ])
    // Neutralise spreadsheet formula injection from quiz titles.
    const safe = body.map((row) =>
      row.map((v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v))
    )
    fs.writeFileSync(file, '﻿' + toCsv([header, ...safe]), 'utf8')
    return { saved: true, path: file, rows: rows.length }
  })

  // ----- AI (OpenRouter) -----
  handle('ai:status', null, () => aiSettings())
  handle('ai:saveKey', z.object({ key: z.string().trim().min(10).max(300) }).strict(), async (req) => {
    const key = req.key.trim()
    if (!/^sk-or-[A-Za-z0-9_-]+$/.test(key)) {
      throw new UserError('That does not look like an OpenRouter key. Keys start with "sk-or-".')
    }
    const info = await verifyKey(key).catch((e: unknown) => {
      throw new UserError(e instanceof Error ? e.message : String(e), 'AI')
    })
    saveKey(key)
    const model = await ai.ensureModel()
    return { label: info.label, freeTier: info.freeTier, model }
  })
  handle('ai:forgetKey', null, () => forgetKey())
  handle('ai:models', null, async () => {
    try {
      return ai.toAiModels(await ai.models())
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : String(e), 'AI')
    }
  })
  handle('ai:setModel', z.object({ model: z.string().min(3).max(200).regex(/^[\w.\-/:]+$/) }).strict(), (req) => setModel(req.model))
  handle('ai:setMarking', z.object({ on: z.boolean() }).strict(), (req) => setAiMarking(req.on))
  handle('ai:testModel', z.object({ model: z.string().min(3).max(200).regex(/^[\w.\-/:]+$/) }).strict(), async (req) => {
    const key = loadKey()
    if (!key) throw new UserError('Add an OpenRouter key first.', 'NO_AI')
    return ai.testModel(key, req.model)
  })
  handle('ai:openKeysPage', null, async () => {
    await shell.openExternal('https://openrouter.ai/settings/keys')
  })
  handle('ai:pickSources', null, async (_r, e) => {
    const w = win(e)
    const opts: Electron.OpenDialogOptions = {
      title: 'Add study material',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Study material', extensions: SOURCE_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return []
    const out = []
    for (const f of res.filePaths.slice(0, 10)) {
      const st = fs.statSync(f)
      if (st.size > MAX_SOURCE_BYTES) throw new UserError(`“${path.basename(f)}” is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB.`)
      try {
        out.push(await ai.addSource(path.basename(f), new Uint8Array(fs.readFileSync(f))))
      } catch (err) {
        throw new UserError(err instanceof Error ? err.message : String(err))
      }
    }
    return out
  })
  handle(
    'ai:addSource',
    z
      .object({
        name: z.string().min(1).max(255),
        bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array && v.byteLength <= MAX_SOURCE_BYTES, 'File too large')
      })
      .strict(),
    async (req) => {
      try {
        return await ai.addSource(req.name, req.bytes)
      } catch (err) {
        throw new UserError(err instanceof Error ? err.message : String(err))
      }
    }
  )
  handle('ai:dropSource', z.object({ token: z.string().max(64) }).strict(), (req) => ai.dropSource(req.token))
  handle(
    'ai:generate',
    z
      .object({
        moduleId: id,
        topic: z.string().trim().min(3).max(2000),
        count: z.number().int().min(3).max(40),
        difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
        format: z.enum(['choice', 'mixed', 'written']),
        instructions: z.string().max(2000).nullable(),
        sourceTokens: z.array(z.string().max(64)).max(10)
      })
      .strict(),
    (req) => ai.generate(requireDb().db, req)
  )

  // ----- Onboarding -----
  handle('onboarding:get', null, () => {
    if (!ctx.db) return true
    return ctx.db.prepare(`SELECT value FROM settings WHERE key = 'onboarding_done'`).pluck().get() === '1'
  })
  handle('onboarding:done', null, () => {
    requireDb()
      .db.prepare(`INSERT INTO settings (key, value) VALUES ('onboarding_done', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`)
      .run()
  })

  // ----- Updates (only ever on request) -----
  handle('updates:check', null, () => checkForUpdates())
  handle('updates:open', z.object({ url: z.string().url().max(500) }).strict(), async (req) => {
    if (!isOfferedDownload(req.url)) throw new UserError('That link was not offered by the update check.')
    await shell.openExternal(req.url)
  })
  handle('updates:getAutoCheck', null, () => {
    if (!ctx.db) return false
    return ctx.db.prepare(`SELECT value FROM settings WHERE key = 'update_check_on_start'`).pluck().get() === '1'
  })
  handle('updates:setAutoCheck', z.object({ enabled: z.boolean() }).strict(), (req) => {
    requireDb().db
      .prepare(`INSERT INTO settings (key, value) VALUES ('update_check_on_start', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(req.enabled ? '1' : '0')
  })

  // ----- Settings -----
  handle('settings:getTheme', null, () => {
    if (!ctx.db) return 'system'
    const v = ctx.db.prepare(`SELECT value FROM settings WHERE key = 'theme'`).pluck().get() as string | undefined
    return v === 'light' || v === 'dark' ? v : 'system'
  })
  handle('settings:setTheme', z.object({ theme: z.enum(['system', 'light', 'dark']) }).strict(), (req) => {
    const { db } = requireDb()
    db.prepare(`INSERT INTO settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(req.theme)
    nativeTheme.themeSource = req.theme
  })

  // ----- Data -----
  handle('data:info', null, () => {
    const { db, dataDir } = requireDb()
    return dataInfo(db, dataDir)
  })
  handle('data:showInFolder', null, () => {
    const { dataDir } = requireDb()
    shell.showItemInFolder(path.join(dataDir, DB_FILE))
  })
  handle('data:backupNow', null, async () => {
    const { db, dataDir } = requireDb()
    return { filename: await createBackup(db, dataDir, 'manual') }
  })
  handle('data:export', null, async (_r, e) => {
    const { db } = requireDb()
    const file = await saveDialog(e, {
      title: 'Export your Tally data',
      defaultPath: path.join(app.getPath('documents'), `Tally backup ${localStamp()}.sqlite`),
      filters: [{ name: 'Tally data', extensions: ['sqlite'] }]
    })
    if (!file) return { saved: false }
    await backupTo(db, file)
    return { saved: true, path: file }
  })
  handle('data:move', null, async (_r, e) => {
    const { db, dataDir } = requireDb()
    const picked = await pickFolder(e, 'Choose where to move your Tally data')
    if (!picked) return { moved: false }
    const inspected = inspectLocation(picked)
    if (inspected.status === 'existing' || inspected.status === 'invalid') {
      throw new UserError('That folder already contains a Tally database. Choose an empty folder.')
    }
    if (inspected.status === 'not-writable') throw new UserError('Tally cannot write to that folder.')
    const target = inspected.dataDir
    await createBackup(db, dataDir, 'pre-move')
    const opened = await copyDataFolder(db, dataDir, target)
    const oldDir = dataDir
    adopt(opened, target, true)
    removeOldData(oldDir)
    return { moved: true, dataDir: target }
  })
  handle('data:pickRestore', null, async (_r, e) => {
    const w = win(e)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a Tally data file to restore',
      properties: ['openFile'],
      filters: [{ name: 'Tally data', extensions: ['sqlite', 'db'] }]
    }
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return null
    const file = res.filePaths[0]
    const check = checkDatabaseFile(file)
    if (!check.valid || !check.summary) throw new UserError(check.reason ?? 'That file is not Tally data.')
    const token = randomUUID()
    restoreTokens.set(token, file)
    return { token, filename: path.basename(file), summary: check.summary, schemaVersion: check.schemaVersion }
  })
  handle('data:restore', z.object({ token: z.string().max(64) }).strict(), async (req) => {
    const file = restoreTokens.get(req.token)
    if (!file) throw new UserError('Choose the file to restore again.')
    restoreTokens.delete(req.token)
    const { db, dataDir } = requireDb()
    const check = checkDatabaseFile(file)
    if (!check.valid) throw new UserError(check.reason ?? 'That file is not Tally data.')
    const backup = await createBackup(db, dataDir, 'pre-restore')
    const live = path.join(dataDir, DB_FILE)
    const staged = path.join(dataDir, `${DB_FILE}.restore`)
    // Copy the chosen file consistently via the backup API before touching live data.
    const source = new (await import('better-sqlite3')).default(file, { readonly: true, fileMustExist: true })
    try {
      fs.rmSync(staged, { force: true })
      await source.backup(staged)
    } finally {
      source.close()
    }
    const stagedCheck = checkDatabaseFile(staged)
    if (!stagedCheck.valid) {
      fs.rmSync(staged, { force: true })
      throw new UserError('The copy of that file failed verification, so nothing was changed.')
    }
    closeDb()
    fs.rmSync(`${live}-journal`, { force: true })
    fs.renameSync(staged, live)
    try {
      const restored = openDatabase(live)
      recordAppVersion(restored, app.getVersion())
      adopt(restored, dataDir, false)
    } catch (err) {
      // Put the previous data back.
      fs.copyFileSync(path.join(dataDir, 'backups', backup), live)
      adopt(openDatabase(live), dataDir, false)
      throw new UserError(`The restored data could not be opened, so your previous data was put back. (${String(err)})`)
    }
    return { restored: true, backup }
  })

  // ----- Help -----
  handle('help:saveSample', z.object({ which: z.enum(['template', 'example']) }).strict(), async (req, e) => {
    const name = req.which === 'template' ? 'tally-template.csv' : 'tally-example-quiz.csv'
    const file = await saveDialog(e, {
      title: req.which === 'template' ? 'Save the quiz template' : 'Save the sample quiz',
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (!file) return { saved: false }
    fs.writeFileSync(file, req.which === 'template' ? templateCsv : exampleCsv, 'utf8')
    return { saved: true, path: file }
  })
  handle('help:copy', z.object({ text: text(100_000) }).strict(), (req) => {
    clipboard.writeText(req.text)
  })
}
