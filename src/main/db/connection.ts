import Database from 'better-sqlite3'
import fs from 'node:fs'
import type { DataSummary } from '../../shared/types'
import { APPLICATION_ID, MIGRATIONS, REQUIRED_TABLES, SCHEMA_VERSION } from './schema'

export type DB = Database.Database

function configure(db: DB): void {
  // DELETE journal keeps the database a single file, which is safer in synced folders.
  db.pragma('journal_mode = DELETE')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('synchronous = FULL')
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `This data was created by a newer version of Tally (schema ${current}). Update Tally to open it.`
    )
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    const step = db.transaction(() => {
      MIGRATIONS[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })
    step()
  }
  if ((db.pragma('application_id', { simple: true }) as number) !== APPLICATION_ID) {
    db.pragma(`application_id = ${APPLICATION_ID}`)
  }
}

/** Create a brand-new database. Refuses if the file already exists. */
export function createDatabase(file: string): DB {
  if (fs.existsSync(file)) throw new Error('A database already exists at this location.')
  const db = new Database(file)
  configure(db)
  db.pragma(`application_id = ${APPLICATION_ID}`)
  migrate(db)
  return db
}

/** Open an existing Tally database. Never creates a file. */
export function openDatabase(file: string): DB {
  if (!fs.existsSync(file)) throw new Error('The database file does not exist.')
  const db = new Database(file, { fileMustExist: true })
  try {
    configure(db)
    migrate(db)
  } catch (e) {
    db.close()
    throw e
  }
  return db
}

export interface DatabaseCheck {
  valid: boolean
  reason: string | null
  schemaVersion: number
  summary: DataSummary | null
}

export function summarise(db: DB): DataSummary {
  const one = (sql: string): number => (db.prepare(sql).pluck().get() as number | null) ?? 0
  const last = db
    .prepare(
      `SELECT MAX(t) FROM (
         SELECT MAX(COALESCE(submitted_at, started_at)) AS t FROM attempts
         UNION ALL SELECT MAX(imported_at) FROM quiz_versions
       )`
    )
    .pluck()
    .get() as string | null
  return {
    modules: one('SELECT COUNT(*) FROM modules'),
    quizzes: one('SELECT COUNT(*) FROM quizzes'),
    attempts: one(`SELECT COUNT(*) FROM attempts WHERE status = 'submitted'`),
    lastActivity: last
  }
}

/**
 * Inspect a file without modifying it: is it a readable, intact Tally database?
 */
export function checkDatabaseFile(file: string): DatabaseCheck {
  if (!fs.existsSync(file)) {
    return { valid: false, reason: 'The file does not exist.', schemaVersion: 0, summary: null }
  }
  let db: DB | null = null
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    db.pragma('busy_timeout = 5000')
    const integrity = db.pragma('integrity_check', { simple: true }) as string
    if (integrity !== 'ok') {
      return { valid: false, reason: `The database is damaged (${integrity}).`, schemaVersion: 0, summary: null }
    }
    const appId = db.pragma('application_id', { simple: true }) as number
    const version = db.pragma('user_version', { simple: true }) as number
    const tables = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).pluck().all() as string[])
    )
    const hasTables = REQUIRED_TABLES.every((t) => tables.has(t))
    if (appId !== APPLICATION_ID || !hasTables) {
      return {
        valid: false,
        reason: 'This is an SQLite database, but not one created by Tally.',
        schemaVersion: version,
        summary: null
      }
    }
    if (version > SCHEMA_VERSION) {
      return {
        valid: false,
        reason: `This data was created by a newer version of Tally (schema ${version}). Update Tally to open it.`,
        schemaVersion: version,
        summary: null
      }
    }
    return { valid: true, reason: null, schemaVersion: version, summary: summarise(db) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const reason = /not a database|file is encrypted/i.test(msg)
      ? 'This file is not an SQLite database.'
      : `The database could not be read: ${msg}`
    return { valid: false, reason, schemaVersion: 0, summary: null }
  } finally {
    db?.close()
  }
}

export function integrityOk(db: DB): boolean {
  return (db.pragma('integrity_check', { simple: true }) as string) === 'ok'
}

export function nowIso(): string {
  return new Date().toISOString()
}
