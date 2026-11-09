import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDatabaseFile, createDatabase, migrate, openDatabase } from '../../src/main/db/connection'
import { APPLICATION_ID, SCHEMA_VERSION } from '../../src/main/db/schema'
import * as attempts from '../../src/main/services/attempts'
import { dashboard, history, moduleDetail } from '../../src/main/services/analytics'
import { createModule, deleteModule, listModules, archiveModule, updateModule } from '../../src/main/services/modules'
import { commitImport, previewImport, quizDetail } from '../../src/main/services/quizzes'
import type { AttemptSettings } from '../../src/shared/types'
import { csv, freshDb, readSample, seedQuiz, tmpDir } from './helpers'

const STRICT: AttemptSettings = {
  shuffleQuestions: false,
  shuffleOptions: false,
  feedback: 'end',
  timeLimitMinutes: null,
  marking: 'strict'
}

function answerAllCorrectly(db: Database.Database, attemptId: number, except: number[] = []): void {
  const s = attempts.getSession(db, attemptId)
  for (const q of s.questions) {
    if (except.includes(q.displayPosition)) continue
    const correct = db
      .prepare('SELECT id FROM options WHERE question_id = ? AND is_correct = 1')
      .pluck()
      .all(q.id) as number[]
    attempts.saveAnswer(db, { attemptId, questionId: q.id, selected: q.type === 'single' ? [correct[0]] : correct })
  }
}

describe('runtime', () => {
  it('runs the database tests under Electron’s Node, the ABI the app ships with', () => {
    expect(process.versions.electron).toBeTruthy()
    const db = new Database(':memory:')
    expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 })
    db.close()
  })
})

describe('schema and migrations', () => {
  it('creates a single-file database with the expected pragmas', () => {
    const { db, file } = freshDb()
    expect(db.pragma('journal_mode', { simple: true })).toBe('delete')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(db.pragma('application_id', { simple: true })).toBe(APPLICATION_ID)
    db.close()
    expect(fs.existsSync(`${file}-wal`)).toBe(false)
  })

  it('migrates an unversioned database and is idempotent', () => {
    const file = path.join(tmpDir(), 'old.sqlite')
    const raw = new Database(file)
    expect(raw.pragma('user_version', { simple: true })).toBe(0)
    migrate(raw)
    migrate(raw)
    expect(raw.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    raw.close()
    expect(checkDatabaseFile(file).valid).toBe(true)
  })

  it('refuses a database from a newer version', () => {
    const { db, file } = freshDb()
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    expect(checkDatabaseFile(file).valid).toBe(false)
    expect(() => openDatabase(file)).toThrow(/newer version/)
  })

  it('never creates a database when opening, and never overwrites when creating', () => {
    const dir = tmpDir()
    const file = path.join(dir, 'userdata.sqlite')
    expect(() => openDatabase(file)).toThrow()
    expect(fs.existsSync(file)).toBe(false)
    createDatabase(file).close()
    expect(() => createDatabase(file)).toThrow(/already exists/)
  })

  it('recognises foreign and corrupt files', () => {
    const dir = tmpDir()
    const foreign = path.join(dir, 'foreign.sqlite')
    const f = new Database(foreign)
    f.exec('CREATE TABLE x (a)')
    f.close()
    expect(checkDatabaseFile(foreign).reason).toMatch(/not one created by Tally/)
    const junk = path.join(dir, 'junk.sqlite')
    fs.writeFileSync(junk, 'this is not sqlite at all, just some text padding '.repeat(200))
    expect(checkDatabaseFile(junk).valid).toBe(false)
  })
})

describe('modules', () => {
  it('creates, updates, archives and deletes with name confirmation', () => {
    const { db } = freshDb()
    const m = createModule(db, { name: '  Discrete   Maths ', code: ' MATH1 ', colour: 'teal', description: '' })
    expect(m).toMatchObject({ name: 'Discrete Maths', code: 'MATH1', description: null, colour: 'teal' })
    expect(() => createModule(db, { name: 'discrete maths', code: null, colour: 'cobalt', description: null })).toThrow(/already have/)
    updateModule(db, m.id, { name: 'Discrete Mathematics', code: null, colour: 'violet', description: 'Logic' })
    archiveModule(db, m.id, true)
    expect(listModules(db, false)).toHaveLength(0)
    expect(listModules(db, true)[0].archivedAt).not.toBeNull()
    expect(() => deleteModule(db, m.id, 'wrong')).toThrow(/does not match/)
    deleteModule(db, m.id, 'Discrete Mathematics')
    expect(listModules(db, true)).toHaveLength(0)
  })
})

describe('import and versioning', () => {
  it('saves a quiz, its questions, options and original CSV in one go', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db)
    const d = quizDetail(db, quizId)
    expect(d.version).toMatchObject({ versionNo: 1, questionCount: 12, singleCount: 8, multiCount: 4 })
    const stored = db.prepare('SELECT csv_text FROM quiz_versions WHERE quiz_id = ?').pluck().get(quizId)
    expect(stored).toBe(readSample('example_quiz.csv'))
    expect(db.prepare('SELECT COUNT(*) FROM options').pluck().get()).toBe(60)
  })

  it('detects the same file in the same module, regardless of line endings', () => {
    const { db } = freshDb()
    const { moduleId } = seedQuiz(db)
    const crlf = readSample('example_quiz.csv').replace(/\n/g, '\r\n')
    const p = previewImport(db, moduleId, 'again.csv', crlf)
    expect(p.duplicateOf?.title).toBe('Logic')
    expect(() =>
      commitImport(db, { moduleId, filename: 'again.csv', text: crlf, title: 'Other', mode: 'new', targetQuizId: null })
    ).toThrow(/already in this module/)
  })

  it('saves a changed file as a new version without altering past attempts', () => {
    const { db } = freshDb()
    const { moduleId, quizId } = seedQuiz(db, readSample('template.csv'), 'Logic')
    const a1 = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    answerAllCorrectly(db, a1)
    attempts.submitAttempt(db, a1)
    const before = attempts.getResult(db, a1)

    const p = previewImport(db, moduleId, 'Logic.csv', readSample('example_quiz.csv'))
    expect(p.duplicateOf).toBeNull()
    expect(p.moduleQuizzes.map((q) => q.title)).toContain('Logic')
    const r = commitImport(db, {
      moduleId,
      filename: 'Logic.csv',
      text: readSample('example_quiz.csv'),
      title: 'Logic',
      mode: 'version',
      targetQuizId: quizId
    })
    expect(r).toMatchObject({ quizId, versionNo: 2 })

    const after = attempts.getResult(db, a1)
    expect(after.questions.map((q) => q.prompt)).toEqual(before.questions.map((q) => q.prompt))
    expect(after.attempt.versionNo).toBe(1)
    expect(after.attempt.percentage).toBe(100)

    const a2 = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    expect(attempts.getSession(db, a2).questions).toHaveLength(12)
  })

  it('can create a separate quiz instead, and rolls back on error', () => {
    const { db } = freshDb()
    const { moduleId } = seedQuiz(db, readSample('template.csv'), 'Logic')
    commitImport(db, { moduleId, filename: 'b.csv', text: readSample('example_quiz.csv'), title: 'Logic (2)', mode: 'new', targetQuizId: null })
    expect(db.prepare('SELECT COUNT(*) FROM quizzes').pluck().get()).toBe(2)
    const bad = csv([['Q', 'a', 'b', 'c', 'd', 'e', 'single', 'Z', '1', '', '']])
    expect(() => commitImport(db, { moduleId, filename: 'bad.csv', text: bad, title: 'Bad', mode: 'new', targetQuizId: null })).toThrow()
    expect(db.prepare('SELECT COUNT(*) FROM quizzes').pluck().get()).toBe(2)
  })
})

describe('attempts', () => {
  it('marks, numbers and records an attempt; attempt 2 increments', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db)
    const a1 = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    answerAllCorrectly(db, a1, [1, 2])
    attempts.tick(db, { attemptId: a1, questionId: null, seconds: 12, position: 3 })
    attempts.tick(db, { attemptId: a1, questionId: null, seconds: 999, position: 3 })
    attempts.submitAttempt(db, a1)
    const r1 = attempts.getResult(db, a1)
    // 17 marks in total; question 1 (1 mark) and question 2 (2 marks) are unanswered.
    expect(r1.attempt).toMatchObject({ attemptNumber: 1, marksAvailable: 17, marksAwarded: 14, percentage: 82.4 })
    expect(r1.attempt.durationSeconds).toBe(12 + attempts.MAX_TICK_SECONDS)
    expect(r1.wrongCount).toBe(2)
    expect(r1.topics.find((t) => t.topic === 'Propositional logic')).toMatchObject({ awarded: 2, available: 5 })

    const a2 = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    expect(attempts.getSession(db, a2).projectedAttemptNumber).toBe(2)
    answerAllCorrectly(db, a2)
    attempts.submitAttempt(db, a2)
    const r2 = attempts.getResult(db, a2)
    expect(r2.attempt.attemptNumber).toBe(2)
    expect(r2.previous).toEqual({ attemptNumber: 1, percentage: 82.4 })
    expect(r2.best).toEqual({ attemptNumber: 2, percentage: 100 })
  })

  it('enforces unique official attempt numbers per quiz', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db)
    const a1 = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    attempts.submitAttempt(db, a1)
    const a2 = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    attempts.submitAttempt(db, a2)
    expect(() => db.prepare('UPDATE attempts SET attempt_number = 1 WHERE id = ?').run(a2)).toThrow(/UNIQUE/)
  })

  it('applies partial marking and stores the mode on the attempt', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db, readSample('template.csv'))
    const a = attempts.startAttempt(db, { quizId, settings: { ...STRICT, marking: 'partial' }, practiceFromAttemptId: null, replaceInProgress: false })
    const s = attempts.getSession(db, a)
    const multi = s.questions.find((q) => q.type === 'multi')!
    const correct = db.prepare('SELECT id FROM options WHERE question_id = ? AND is_correct = 1 ORDER BY label').pluck().all(multi.id) as number[]
    const wrong = db.prepare('SELECT id FROM options WHERE question_id = ? AND is_correct = 0 ORDER BY label').pluck().all(multi.id) as number[]
    // Two right ticks and one wrong tick out of three correct: (2 - 1) / 3 × 2 marks.
    attempts.saveAnswer(db, { attemptId: a, questionId: multi.id, selected: [correct[0], correct[1], wrong[0]] })
    attempts.submitAttempt(db, a)
    const r = attempts.getResult(db, a)
    expect(r.settings.marking).toBe('partial')
    expect(r.attempt.markingMode).toBe('partial')
    expect(r.attempt.marksAwarded).toBeCloseTo(0.6667, 3)
  })

  it('validates answers', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db, readSample('template.csv'))
    const a = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    const [single, multi] = attempts.getSession(db, a).questions
    expect(() => attempts.saveAnswer(db, { attemptId: a, questionId: single.id, selected: single.options.slice(0, 2).map((o) => o.id) })).toThrow(/only one/)
    expect(() => attempts.saveAnswer(db, { attemptId: a, questionId: single.id, selected: [multi.options[0].id] })).toThrow(/does not belong/)
  })

  it('keeps answers across a restart and resumes', () => {
    const { db, file } = freshDb()
    const { quizId } = seedQuiz(db)
    const a = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    const q = attempts.getSession(db, a).questions[0]
    attempts.saveAnswer(db, { attemptId: a, questionId: q.id, selected: [q.options[2].id] })
    attempts.setFlag(db, a, q.id, true)
    attempts.tick(db, { attemptId: a, questionId: q.id, seconds: 7, position: 4 })
    db.close()

    const again = openDatabase(file)
    expect(attempts.inProgress(again).map((x) => x.id)).toEqual([a])
    const s = attempts.getSession(again, a)
    expect(s.currentPosition).toBe(4)
    expect(s.questions[0]).toMatchObject({ selected: [q.options[2].id], flagged: true, timeSpent: 7 })
    expect(() => attempts.startAttempt(again, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })).toThrow(/unfinished/)
  })

  it('shuffles question and option order per attempt and remembers it', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db)
    let seed = 7
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const a = attempts.startAttempt(db, { quizId, settings: { ...STRICT, shuffleQuestions: true, shuffleOptions: true }, practiceFromAttemptId: null, replaceInProgress: false }, rand)
    const s1 = attempts.getSession(db, a)
    const s2 = attempts.getSession(db, a)
    expect(s1.questions.map((q) => q.id)).toEqual(s2.questions.map((q) => q.id))
    const positions = db.prepare('SELECT position FROM questions WHERE id IN (' + s1.questions.map((q) => q.id).join(',') + ')').pluck().all()
    expect(s1.questions.map((q) => q.options.map((o) => o.label).join(''))).toEqual(s1.questions.map(() => 'ABCDE'))
    expect(positions).toHaveLength(12)
  })

  it('reveals feedback per question and locks the answer', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db, readSample('template.csv'))
    const a = attempts.startAttempt(db, { quizId, settings: { ...STRICT, feedback: 'each' }, practiceFromAttemptId: null, replaceInProgress: false })
    const q = attempts.getSession(db, a).questions[0]
    attempts.saveAnswer(db, { attemptId: a, questionId: q.id, selected: [q.options[2].id] })
    const fb = attempts.revealAnswer(db, a, q.id)
    expect(fb).toMatchObject({ isCorrect: true, marksAwarded: 1 })
    expect(() => attempts.saveAnswer(db, { attemptId: a, questionId: q.id, selected: [q.options[0].id] })).toThrow(/already checked/)
    expect(attempts.getSession(db, a).questions[0].feedback?.isCorrect).toBe(true)
  })

  it('runs practice on wrong answers only and keeps it out of official statistics', () => {
    const { db } = freshDb()
    const { quizId, moduleId } = seedQuiz(db)
    const a1 = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    answerAllCorrectly(db, a1, [1, 2, 3])
    attempts.submitAttempt(db, a1)

    const p = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: a1, replaceInProgress: false })
    const ps = attempts.getSession(db, p)
    expect(ps.isPractice).toBe(true)
    expect(ps.projectedAttemptNumber).toBeNull()
    expect(ps.questions).toHaveLength(3)
    answerAllCorrectly(db, p)
    attempts.submitAttempt(db, p)
    const pr = attempts.getResult(db, p)
    expect(pr.attempt).toMatchObject({ isPractice: true, attemptNumber: null, percentage: 100 })
    expect(pr.best).toBeNull()

    const d = quizDetail(db, quizId)
    expect(d.quiz.attemptCount).toBe(1)
    expect(d.best?.attemptNumber).toBe(1)
    expect(moduleDetail(db, moduleId).series).toHaveLength(1)
    expect(history(db, { moduleId: null, quizId: null, from: null, to: null, minScore: null, maxScore: null, includePractice: false })).toHaveLength(1)
    expect(history(db, { moduleId: null, quizId: null, from: null, to: null, minScore: null, maxScore: null, includePractice: true })).toHaveLength(2)

    // The next official attempt is still number 2.
    const a2 = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    attempts.submitAttempt(db, a2)
    expect(attempts.getResult(db, a2).attempt.attemptNumber).toBe(2)
  })

  it('abandoned attempts get no number and are not counted', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db)
    const a = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    attempts.abandonAttempt(db, a)
    const b = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
    attempts.submitAttempt(db, b)
    expect(attempts.getResult(db, b).attempt.attemptNumber).toBe(1)
  })
})

describe('analytics', () => {
  it('builds a dashboard headline comparing the last 30 days with the 30 before', () => {
    const { db } = freshDb()
    const { quizId } = seedQuiz(db)
    const now = new Date('2026-06-30T12:00:00Z')
    const take = (except: number[], when: string): void => {
      const a = attempts.startAttempt(db, { quizId, settings: STRICT, practiceFromAttemptId: null, replaceInProgress: false })
      answerAllCorrectly(db, a, except)
      attempts.submitAttempt(db, a, when)
    }
    take([1, 2, 3, 4, 5, 6], '2026-05-10T10:00:00Z')
    take([], '2026-06-20T10:00:00Z')
    const d = dashboard(db, null, 'all', now)
    expect(d.headline.kind).toBe('recent-with-change')
    expect(d.headline.average).toBe(100)
    expect(d.headline.change).toBeGreaterThan(0)
    expect(d.series).toHaveLength(2)
    expect(d.totals.attempts).toBe(2)
    expect(d.missed[0].missed).toBe(1)
    expect(d.topics.length).toBeGreaterThan(0)
    expect(dashboard(db, null, '30d', now).series).toHaveLength(1)
  })
})
