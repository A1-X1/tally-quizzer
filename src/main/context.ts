import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db/connection'
import type { BootState, ThemePreference, UpgradeNotice } from '../shared/types'
import { openDataFolder, readConfig, writeConfig, createBackup, writeMirror, mirrorFile } from './storage'
import { allVersionsForMirror } from './services/quizzes'

/** Process-wide state owned by the main process. */
export const ctx: {
  db: DB | null
  dataDir: string | null
  missingReason: string | null
  upgrade: UpgradeNotice | null
} = { db: null, dataDir: null, missingReason: null, upgrade: null }

export const configFile = (): string => path.join(app.getPath('userData'), 'config.json')

export function defaultLocation(): string {
  return process.env.TALLY_DEFAULT_LOCATION || app.getPath('documents')
}

export function requireDb(): { db: DB; dataDir: string } {
  if (!ctx.db || !ctx.dataDir) throw new Error('Your data folder is not open.')
  return { db: ctx.db, dataDir: ctx.dataDir }
}

export function getTheme(): ThemePreference {
  if (!ctx.db) return 'system'
  const v = ctx.db.prepare(`SELECT value FROM settings WHERE key = 'theme'`).pluck().get() as string | undefined
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function closeDb(): void {
  if (ctx.db) {
    try {
      ctx.db.close()
    } catch {
      /* already closed */
    }
  }
  ctx.db = null
}

export function bootState(): BootState {
  if (ctx.db && ctx.dataDir) return { kind: 'ready', dataDir: ctx.dataDir, theme: getTheme(), upgrade: ctx.upgrade }
  const cfg = readConfig(configFile())
  if (!cfg.dataDir) return { kind: 'setup', defaultLocation: defaultLocation() }
  return { kind: 'missing', dataDir: cfg.dataDir, reason: ctx.missingReason ?? 'The data folder could not be opened.' }
}

/** Try to open the data folder named in config.json. Never creates anything. */
export function tryOpenConfigured(): BootState {
  const cfg = readConfig(configFile())
  if (!cfg.dataDir) return bootState()
  if (ctx.db && ctx.dataDir === cfg.dataDir) return bootState()
  closeDb()
  const res = openDataFolder(cfg.dataDir, app.getVersion())
  if (res.ok) {
    adopt(res.db, cfg.dataDir, false)
    ctx.upgrade = res.upgrade
      ? { fromVersion: res.upgrade.fromVersion, toVersion: res.upgrade.toVersion, backup: res.upgrade.backup }
      : null
  } else {
    ctx.dataDir = null
    ctx.missingReason = res.reason
  }
  return bootState()
}

/** Make `db` the live database and remember its folder. */
export function adopt(db: DB, dataDir: string, persist: boolean): void {
  closeDb()
  ctx.db = db
  ctx.dataDir = dataDir
  ctx.missingReason = null
  if (persist) writeConfig(configFile(), { dataDir })
}

let startupBackupDone = false

/** Run once per launch after the database opens: backup and restore the readable mirror. */
export async function afterOpen(): Promise<void> {
  if (!ctx.db || !ctx.dataDir) return
  const { db, dataDir } = { db: ctx.db, dataDir: ctx.dataDir }
  if (!startupBackupDone) {
    startupBackupDone = true
    try {
      await createBackup(db, dataDir, 'startup')
    } catch (e) {
      console.warn('Startup backup failed:', e)
    }
  }
  try {
    for (const v of allVersionsForMirror(db)) {
      if (!fs.existsSync(mirrorFile(dataDir, v.moduleName, v.title, v.versionNo))) {
        writeMirror(dataDir, v.moduleName, v.title, v.versionNo, v.csv)
      }
    }
  } catch {
    /* the mirror is optional */
  }
}
