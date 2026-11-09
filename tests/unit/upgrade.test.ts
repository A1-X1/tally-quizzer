import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APPLICATION_ID, MIGRATIONS, SCHEMA_VERSION } from '../../src/main/db/schema'
import { readVersions } from '../../src/main/db/connection'
import { createDataFolder, listBackups, openDataFolder, DATA_FOLDER_NAME } from '../../src/main/storage'
import { compareVersions, pickAsset } from '../../src/main/updates'
import * as attempts from '../../src/main/services/attempts'
import { dashboard } from '../../src/main/services/analytics'
import { quizDetail } from '../../src/main/services/quizzes'
import { readSample, seedQuiz, tmpDir } from './helpers'

/** Build a data folder exactly as version 1 of the schema left it. */
function v1Folder(): string {
  const dir = path.join(tmpDir(), DATA_FOLDER_NAME)
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true })
  const db = new Database(path.join(dir, 'userdata.sqlite'))
  db.pragma('journal_mode = DELETE')
  db.pragma(`application_id = ${APPLICATION_ID}`)
  MIGRATIONS[0](db)
  db.pragma('user_version = 1')
  db.prepare(`INSERT INTO modules (name, colour, created_at) VALUES ('Old', 'plum', '2026-01-01T00:00:00Z')`).run()
  db.prepare(`INSERT INTO settings (key, value) VALUES ('app_version', '1.0.0')`).run()
  db.close()
  return dir
}

describe('pre-upgrade check', () => {
  it('backs up before migrating an older database, then migrates it', () => {
    const dir = v1Folder()
    const original = fs.readFileSync(path.join(dir, 'userdata.sqlite'))
    const res = openDataFolder(dir, '1.1.0')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.upgrade).toMatchObject({ fromVersion: '1.0.0', toVersion: '1.1.0', fromSchema: 1, toSchema: SCHEMA_VERSION })
    const backup = path.join(dir, 'backups', res.upgrade!.backup)
    expect(fs.readFileSync(backup).equals(original)).toBe(true)
    expect(listBackups(dir).map((b) => b.reason)).toContain('pre-upgrade')
    expect(res.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(res.db.prepare('SELECT colour FROM modules').pluck().get()).toBe('violet')
    expect(res.db.prepare('SELECT visit_count FROM responses LIMIT 0').columns().map((c) => c.name)).toEqual(['visit_count'])
    res.db.close()
    expect(readVersions(path.join(dir, 'userdata.sqlite'))).toEqual({ schemaVersion: SCHEMA_VERSION, appVersion: '1.1.0' })
  })

  it('backs up when the app version changes even without a schema change, and not otherwise', () => {
    const dir = path.join(tmpDir(), DATA_FOLDER_NAME)
    createDataFolder(dir, '1.0.0').close()
    const same = openDataFolder(dir, '1.0.0')
    expect(same.ok && same.upgrade).toBe(null)
    if (same.ok) same.db.close()
    const next = openDataFolder(dir, '1.0.1')
    expect(next.ok && next.upgrade?.fromSchema).toBe(SCHEMA_VERSION)
    if (next.ok) next.db.close()
  })

  it('puts the original back if the migration fails', () => {
    const dir = v1Folder()
    const file = path.join(dir, 'userdata.sqlite')
    // Sabotage: a table that makes migration 2's CREATE INDEX collide.
    const raw = new Database(file)
    raw.exec('CREATE INDEX attempts_started ON attempts(id)')
    raw.close()
    const before = fs.readFileSync(file)
    const res = openDataFolder(dir, '1.1.0')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/left as it was/)
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    expect(readVersions(file).schemaVersion).toBe(1)
  })
})

describe('update check helpers', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('0.9', '1.0.0')).toBe(-1)
  })

  it('picks the right file for each computer', () => {
    const assets = ['Tally-Setup-1.1.0.exe', 'Tally-1.1.0-arm64.dmg', 'Tally-1.1.0-x64.dmg', 'Tally-1.1.0-x86_64.AppImage'].map((name) => ({
      name,
      browser_download_url: `https://github.com/A1-X1/tally-quizzer/releases/download/v1.1.0/${name}`,
      size: 1
    }))
    expect(pickAsset(assets, 'win32', 'x64')?.name).toBe('Tally-Setup-1.1.0.exe')
    expect(pickAsset(assets, 'darwin', 'arm64')?.name).toBe('Tally-1.1.0-arm64.dmg')
    expect(pickAsset(assets, 'darwin', 'x64')?.name).toBe('Tally-1.1.0-x64.dmg')
    expect(pickAsset(assets, 'linux', 'x64')?.name).toBe('Tally-1.1.0-x86_64.AppImage')
  })
})

describe('time metrics', () => {
  it('records visits, answer changes and time to first answer, and summarises time by topic', () => {
    const dir = path.join(tmpDir(), DATA_FOLDER_NAME)
    const db = createDataFolder(dir, '1.0.0')
    const { quizId } = seedQuiz(db, readSample('example_quiz.csv'))
    const a = attempts.startAttempt(db, {
      quizId,
      settings: { shuffleQuestions: false, shuffleOptions: false, feedback: 'end', timeLimitMinutes: null, marking: 'strict' },
      practiceFromAttemptId: null,
      replaceInProgress: false
    })
    const [q1, q2] = attempts.getSession(db, a).questions
    attempts.tick(db, { attemptId: a, questionId: q1.id, seconds: 0, position: 0, visit: true })
    attempts.tick(db, { attemptId: a, questionId: q1.id, seconds: 8, position: 0 })
    attempts.saveAnswer(db, { attemptId: a, questionId: q1.id, selected: [q1.options[0].id] })
    attempts.tick(db, { attemptId: a, questionId: q1.id, seconds: 4, position: 0 })
    attempts.saveAnswer(db, { attemptId: a, questionId: q1.id, selected: [q1.options[2].id] })
    attempts.tick(db, { attemptId: a, questionId: q2.id, seconds: 0, position: 1, visit: true })
    attempts.tick(db, { attemptId: a, questionId: q2.id, seconds: 20, position: 1 })
    attempts.tick(db, { attemptId: a, questionId: q1.id, seconds: 0, position: 0, visit: true })
    attempts.submitAttempt(db, a)

    const r = attempts.getResult(db, a)
    expect(r.questions[0]).toMatchObject({ timeSpent: 12, visits: 2, answerChanges: 1, firstAnswerSeconds: 8, isCorrect: true })
    expect(r.questions[1]).toMatchObject({ timeSpent: 20, visits: 1, answerChanges: 0, firstAnswerSeconds: null })
    expect(r.timing.questionSeconds).toBe(32)
    expect(r.timing.topics[0]).toMatchObject({ topic: 'Propositional logic', seconds: 32, share: 100 })
    expect(r.timing.rightPerQuestion).toBe(12)
    expect(r.timing.answerChanges).toBe(1)

    const d = quizDetail(db, quizId)
    expect(d.timing.questions[0]).toMatchObject({ position: 1, seen: 1, perQuestion: 12, accuracy: 100 })
    expect(d.timing.topics.find((t) => t.topic === 'Propositional logic')?.seconds).toBe(32)
    expect(d.timing.attempts).toHaveLength(1)

    const p = dashboard(db, null, 'all').patterns
    expect(p.activity).toHaveLength(84)
    expect(p.activity.reduce((s, x) => s + x.attempts, 0)).toBe(1)
    expect(p.distribution.reduce((a2, b) => a2 + b, 0)).toBe(1)
    expect(p.timeByModule[0].seconds).toBe(32)
    expect(p.types.map((t) => t.type).sort()).toEqual(['multi', 'single'])
    expect(p.weekly).toHaveLength(12)
    db.close()
  })
})
