import fs from 'node:fs'
import path from 'node:path'
import { checkDatabaseFile, createDatabase, integrityOk, openDatabase, summarise, type DB } from './db/connection'
import type { BackupInfo, DataInfo, FolderInspection } from '../shared/types'
import { randomUUID } from 'node:crypto'

export const DATA_FOLDER_NAME = 'Tally Data'
export const DB_FILE = 'userdata.sqlite'
export const BACKUP_DIR = 'backups'
export const QUIZ_DIR = 'quizzes'
export const BACKUPS_TO_KEEP = 10

// ---------------------------------------------------------------------------
// config.json – holds only the selected data folder.

export interface AppConfig {
  dataDir: string | null
}

export function readConfig(configFile: string): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { dataDir?: unknown }
    return { dataDir: typeof raw.dataDir === 'string' && raw.dataDir ? raw.dataDir : null }
  } catch {
    return { dataDir: null }
  }
}

export function writeConfig(configFile: string, config: AppConfig): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true })
  const tmp = `${configFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ dataDir: config.dataDir }, null, 2))
  fs.renameSync(tmp, configFile)
}

// ---------------------------------------------------------------------------
// Folder inspection. The renderer only ever receives tokens for folders that
// the main process has itself inspected, never the ability to name a path.

const inspections = new Map<string, FolderInspection>()

export function rememberInspection(i: Omit<FolderInspection, 'token'>): FolderInspection {
  const token = randomUUID()
  const full = { ...i, token }
  inspections.set(token, full)
  return full
}

export function takeInspection(token: string): FolderInspection {
  const i = inspections.get(token)
  if (!i) throw new Error('That folder choice has expired. Choose the folder again.')
  return i
}

function canWrite(dir: string): boolean {
  // Walk up to the nearest existing ancestor and test it.
  let d = dir
  while (!fs.existsSync(d)) {
    const parent = path.dirname(d)
    if (parent === d) return false
    d = parent
  }
  try {
    fs.accessSync(d, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Work out which Tally Data folder a chosen location refers to.
 *  - the location itself, if it already holds userdata.sqlite;
 *  - <location>/Tally Data, otherwise.
 */
export function inspectLocation(location: string): Omit<FolderInspection, 'token'> {
  const direct = path.join(location, DB_FILE)
  const dataDir = fs.existsSync(direct) ? location : path.join(location, DATA_FOLDER_NAME)
  const dbFile = path.join(dataDir, DB_FILE)
  if (fs.existsSync(dbFile)) {
    const check = checkDatabaseFile(dbFile)
    if (!check.valid) {
      return { location, dataDir, status: 'invalid', detail: check.reason ?? 'The database could not be read.' }
    }
    return { location, dataDir, status: 'existing', summary: check.summary ?? undefined }
  }
  if (!canWrite(dataDir)) {
    return { location, dataDir, status: 'not-writable', detail: 'Tally cannot write to this folder.' }
  }
  return { location, dataDir, status: 'new' }
}

export function ensureDataLayout(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(path.join(dataDir, BACKUP_DIR), { recursive: true })
  fs.mkdirSync(path.join(dataDir, QUIZ_DIR), { recursive: true })
}

/** Create a new data folder. Refuses to touch an existing database. */
export function createDataFolder(dataDir: string): DB {
  const dbFile = path.join(dataDir, DB_FILE)
  if (fs.existsSync(dbFile)) throw new Error('This folder already contains Tally data.')
  ensureDataLayout(dataDir)
  return createDatabase(dbFile)
}

export type OpenResult = { ok: true; db: DB } | { ok: false; reason: string }

/** Open an existing data folder. Never creates a database. */
export function openDataFolder(dataDir: string): OpenResult {
  const dbFile = path.join(dataDir, DB_FILE)
  if (!fs.existsSync(dataDir)) return { ok: false, reason: 'The folder could not be found. It may be on a drive that is not connected, or it may have been moved or renamed.' }
  if (!fs.existsSync(dbFile)) return { ok: false, reason: `The folder exists but ${DB_FILE} is missing from it.` }
  const check = checkDatabaseFile(dbFile)
  if (!check.valid) return { ok: false, reason: check.reason ?? 'The database could not be read.' }
  try {
    const db = openDatabase(dbFile)
    // Missing sub-folders are harmless; recreate them.
    fs.mkdirSync(path.join(dataDir, BACKUP_DIR), { recursive: true })
    fs.mkdirSync(path.join(dataDir, QUIZ_DIR), { recursive: true })
    return { ok: true, db }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------------
// Backups

function stamp(d = new Date()): string {
  const p = (n: number, l = 2): string => String(n).padStart(l, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(
    d.getUTCMinutes()
  )}${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds(), 3)}`
}

const BACKUP_RE = /^userdata-(\d{8})-(\d{6})-(\d{3})-([a-z-]+)\.sqlite$/

/** Write a consistent copy of the live database using SQLite's backup API, then verify it. */
export async function backupTo(db: DB, dest: string): Promise<void> {
  const tmp = `${dest}.partial`
  try {
    fs.rmSync(tmp, { force: true })
    await db.backup(tmp)
    const check = checkDatabaseFile(tmp)
    if (!check.valid) throw new Error(`The copy failed verification: ${check.reason}`)
    fs.renameSync(tmp, dest)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

export async function createBackup(db: DB, dataDir: string, reason: string): Promise<string> {
  const dir = path.join(dataDir, BACKUP_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const name = `userdata-${stamp()}-${reason.replace(/[^a-z-]/g, '')}.sqlite`
  await backupTo(db, path.join(dir, name))
  pruneBackups(dataDir)
  return name
}

export function listBackups(dataDir: string): BackupInfo[] {
  const dir = path.join(dataDir, BACKUP_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .map((f) => {
      const m = BACKUP_RE.exec(f)
      if (!m) return null
      const [, d, t, ms, reason] = m
      const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.${ms}Z`
      let bytes = 0
      try {
        bytes = fs.statSync(path.join(dir, f)).size
      } catch {
        return null
      }
      return { filename: f, createdAt: iso, bytes, reason }
    })
    .filter((b): b is BackupInfo => b !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function pruneBackups(dataDir: string, keep = BACKUPS_TO_KEEP): void {
  const all = listBackups(dataDir)
  for (const b of all.slice(keep)) {
    fs.rmSync(path.join(dataDir, BACKUP_DIR, b.filename), { force: true })
  }
}

export function dataInfo(db: DB, dataDir: string): DataInfo {
  const dbPath = path.join(dataDir, DB_FILE)
  let dbBytes = 0
  try {
    dbBytes = fs.statSync(dbPath).size
  } catch {
    /* ignore */
  }
  return { dataDir, dbPath, dbBytes, backups: listBackups(dataDir), summary: summarise(db) }
}

// ---------------------------------------------------------------------------
// Moving the data folder

/**
 * Copy the data folder to `targetDir`, verify the copy, and return it opened.
 * The caller switches over and then removes the old copy with `removeOldData`.
 */
export async function copyDataFolder(db: DB, fromDir: string, targetDir: string): Promise<DB> {
  if (path.resolve(fromDir) === path.resolve(targetDir)) throw new Error('That is already where your data is.')
  const rel = path.relative(path.resolve(fromDir), path.resolve(targetDir))
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error('Choose a folder outside the current data folder.')
  }
  const targetDb = path.join(targetDir, DB_FILE)
  if (fs.existsSync(targetDb)) throw new Error('The chosen folder already contains Tally data. Choose an empty folder.')
  ensureDataLayout(targetDir)
  await backupTo(db, targetDb)
  for (const sub of [BACKUP_DIR, QUIZ_DIR]) {
    const src = path.join(fromDir, sub)
    if (fs.existsSync(src)) fs.cpSync(src, path.join(targetDir, sub), { recursive: true, force: false, errorOnExist: false })
  }
  const opened = openDatabase(targetDb)
  const a = summarise(db)
  const b = summarise(opened)
  if (!integrityOk(opened) || a.modules !== b.modules || a.quizzes !== b.quizzes || a.attempts !== b.attempts) {
    opened.close()
    throw new Error('The copied data did not match the original, so nothing was moved.')
  }
  return opened
}

/** Remove only the files Tally owns from the old folder, then the folder if it is empty. */
export function removeOldData(dir: string): void {
  fs.rmSync(path.join(dir, DB_FILE), { force: true })
  fs.rmSync(path.join(dir, `${DB_FILE}-journal`), { force: true })
  fs.rmSync(path.join(dir, BACKUP_DIR), { recursive: true, force: true })
  fs.rmSync(path.join(dir, QUIZ_DIR), { recursive: true, force: true })
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  } catch {
    /* leave it */
  }
}

// ---------------------------------------------------------------------------
// Readable mirror of quiz CSVs. Never read back by the app.

const safeName = (s: string): string =>
  s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'Untitled'

export function mirrorFile(dataDir: string, moduleName: string, title: string, versionNo: number): string {
  return path.join(dataDir, QUIZ_DIR, safeName(moduleName), `${safeName(title)} v${versionNo}.csv`)
}

export function writeMirror(dataDir: string, moduleName: string, title: string, versionNo: number, csv: string): void {
  try {
    const file = mirrorFile(dataDir, moduleName, title, versionNo)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, csv, 'utf8')
  } catch {
    // The mirror is a convenience; failing to write it must never break an import.
  }
}
