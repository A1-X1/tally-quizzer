import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDatabaseFile, openDatabase, summarise } from '../../src/main/db/connection'
import {
  backupTo,
  copyDataFolder,
  createBackup,
  createDataFolder,
  inspectLocation,
  listBackups,
  openDataFolder,
  pruneBackups,
  readConfig,
  removeOldData,
  writeConfig,
  writeMirror,
  DATA_FOLDER_NAME
} from '../../src/main/storage'
import { createModule } from '../../src/main/services/modules'
import { seedQuiz, tmpDir } from './helpers'

describe('data folder', () => {
  it('creates the layout inside a chosen location', () => {
    const loc = tmpDir()
    const i = inspectLocation(loc)
    expect(i.status).toBe('new')
    expect(i.dataDir).toBe(path.join(loc, DATA_FOLDER_NAME))
    const db = createDataFolder(i.dataDir)
    db.close()
    for (const p of ['userdata.sqlite', 'quizzes', 'backups']) expect(fs.existsSync(path.join(i.dataDir, p))).toBe(true)
  })

  it('finds existing data whether the parent or the Tally Data folder is chosen', () => {
    const loc = tmpDir()
    const dataDir = path.join(loc, DATA_FOLDER_NAME)
    const db = createDataFolder(dataDir)
    createModule(db, { name: 'Kept', code: null, colour: 'cobalt', description: null })
    db.close()
    const before = fs.readFileSync(path.join(dataDir, 'userdata.sqlite'))
    for (const chosen of [loc, dataDir]) {
      const i = inspectLocation(chosen)
      expect(i.status).toBe('existing')
      expect(i.dataDir).toBe(dataDir)
      expect(i.summary?.modules).toBe(1)
    }
    expect(() => createDataFolder(dataDir)).toThrow(/already contains/)
    expect(fs.readFileSync(path.join(dataDir, 'userdata.sqlite')).equals(before)).toBe(true)
  })

  it('flags an unusable database instead of replacing it', () => {
    const loc = tmpDir()
    fs.writeFileSync(path.join(loc, 'userdata.sqlite'), 'garbage '.repeat(500))
    expect(inspectLocation(loc).status).toBe('invalid')
  })

  it('reports a missing folder without creating anything', () => {
    const gone = path.join(tmpDir(), 'not-here', DATA_FOLDER_NAME)
    const r = openDataFolder(gone)
    expect(r.ok).toBe(false)
    expect(fs.existsSync(gone)).toBe(false)
    const empty = tmpDir()
    expect(openDataFolder(empty).ok).toBe(false)
    expect(fs.existsSync(path.join(empty, 'userdata.sqlite'))).toBe(false)
  })

  it('stores only the data path in config.json', () => {
    const f = path.join(tmpDir(), 'config.json')
    expect(readConfig(f).dataDir).toBeNull()
    writeConfig(f, { dataDir: '/some/where' })
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ dataDir: '/some/where' })
  })
})

describe('backups', () => {
  it('makes verified backups and keeps the latest ten', async () => {
    const dir = path.join(tmpDir(), DATA_FOLDER_NAME)
    const db = createDataFolder(dir)
    seedQuiz(db)
    for (let i = 0; i < 12; i++) {
      await createBackup(db, dir, i === 0 ? 'startup' : 'manual')
      await new Promise((r) => setTimeout(r, 3))
    }
    const list = listBackups(dir)
    expect(list).toHaveLength(10)
    expect(list.every((b) => checkDatabaseFile(path.join(dir, 'backups', b.filename)).valid)).toBe(true)
    expect(list.some((b) => b.reason === 'startup')).toBe(false)
    pruneBackups(dir, 3)
    expect(listBackups(dir)).toHaveLength(3)
    db.close()
  })

  it('exports a consistent copy that restores to the same content', async () => {
    const dir = path.join(tmpDir(), DATA_FOLDER_NAME)
    const db = createDataFolder(dir)
    seedQuiz(db)
    const out = path.join(tmpDir(), 'export.sqlite')
    await backupTo(db, out)
    const check = checkDatabaseFile(out)
    expect(check.valid).toBe(true)
    expect(check.summary).toMatchObject({ modules: 1, quizzes: 1 })

    // Restore: replace the live file with the export after more changes were made.
    createModule(db, { name: 'Later', code: null, colour: 'teal', description: null })
    db.close()
    fs.copyFileSync(out, path.join(dir, 'userdata.sqlite'))
    const restored = openDatabase(path.join(dir, 'userdata.sqlite'))
    expect(summarise(restored).modules).toBe(1)
    restored.close()
  })
})

describe('moving the data folder', () => {
  it('copies, verifies, then removes the old copy', async () => {
    const from = path.join(tmpDir(), DATA_FOLDER_NAME)
    const db = createDataFolder(from)
    seedQuiz(db)
    writeMirror(from, 'M', 'Quiz', 1, 'a,b\n')
    await createBackup(db, from, 'manual')
    const to = path.join(tmpDir(), DATA_FOLDER_NAME)
    const moved = await copyDataFolder(db, from, to)
    expect(summarise(moved)).toMatchObject({ modules: 1, quizzes: 1 })
    expect(fs.existsSync(path.join(to, 'quizzes', 'M', 'Quiz v1.csv'))).toBe(true)
    expect(listBackups(to).length).toBe(1)
    db.close()
    removeOldData(from)
    expect(fs.existsSync(from)).toBe(false)
    moved.close()
  })

  it('refuses a target that already has data or is inside the current folder', async () => {
    const from = path.join(tmpDir(), DATA_FOLDER_NAME)
    const db = createDataFolder(from)
    const other = path.join(tmpDir(), DATA_FOLDER_NAME)
    createDataFolder(other).close()
    await expect(copyDataFolder(db, from, other)).rejects.toThrow(/already contains/)
    await expect(copyDataFolder(db, from, path.join(from, 'nested'))).rejects.toThrow(/outside/)
    db.close()
  })
})
