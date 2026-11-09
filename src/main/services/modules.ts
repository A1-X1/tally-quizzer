import type { DB } from '../db/connection'
import { nowIso } from '../db/connection'
import type { ModuleColour, ModuleInput, ModuleRow, QuizRow } from '../../shared/types'
import { mean, round1, trendOf, UserError } from './rows'

interface RawModule {
  id: number
  name: string
  code: string | null
  colour: string
  description: string | null
  created_at: string
  archived_at: string | null
}

const OFFICIAL = `a.status = 'submitted' AND a.is_practice = 0`

export function listModules(db: DB, includeArchived: boolean): ModuleRow[] {
  const mods = db
    .prepare(
      `SELECT * FROM modules ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
       ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE`
    )
    .all() as RawModule[]
  return mods.map((m) => buildModuleRow(db, m))
}

export function getModule(db: DB, id: number): ModuleRow {
  const m = db.prepare('SELECT * FROM modules WHERE id = ?').get(id) as RawModule | undefined
  if (!m) throw new UserError('That module no longer exists.', 'NOT_FOUND')
  return buildModuleRow(db, m)
}

function buildModuleRow(db: DB, m: RawModule): ModuleRow {
  const quizCount = db
    .prepare('SELECT COUNT(*) FROM quizzes WHERE module_id = ? AND archived_at IS NULL')
    .pluck()
    .get(m.id) as number
  const scores = db
    .prepare(
      `SELECT a.percentage, a.submitted_at FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
       WHERE q.module_id = ? AND q.archived_at IS NULL AND ${OFFICIAL}
       ORDER BY a.submitted_at`
    )
    .all(m.id) as { percentage: number; submitted_at: string }[]
  const pct = scores.map((s) => s.percentage)
  return {
    id: m.id,
    name: m.name,
    code: m.code,
    colour: m.colour as ModuleColour,
    description: m.description,
    createdAt: m.created_at,
    archivedAt: m.archived_at,
    quizCount,
    attemptCount: scores.length,
    average: round1(mean(pct)),
    latest: pct.length ? pct[pct.length - 1] : null,
    trend: trendOf(pct),
    lastStudied: scores.length ? scores[scores.length - 1].submitted_at : null
  }
}

function clean(input: ModuleInput): ModuleInput {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new UserError('Give the module a name.')
  return {
    name,
    code: input.code?.trim() || null,
    colour: input.colour,
    description: input.description?.trim() || null
  }
}

function assertUniqueName(db: DB, name: string, exceptId: number | null): void {
  const clash = db
    .prepare('SELECT id FROM modules WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(name, exceptId)
  if (clash) throw new UserError(`You already have a module called "${name}".`)
}

export function createModule(db: DB, input: ModuleInput): ModuleRow {
  const m = clean(input)
  assertUniqueName(db, m.name, null)
  const info = db
    .prepare(
      'INSERT INTO modules (name, code, colour, description, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(m.name, m.code, m.colour, m.description, nowIso())
  return getModule(db, Number(info.lastInsertRowid))
}

export function updateModule(db: DB, id: number, input: ModuleInput): ModuleRow {
  getModule(db, id)
  const m = clean(input)
  assertUniqueName(db, m.name, id)
  db.prepare('UPDATE modules SET name = ?, code = ?, colour = ?, description = ? WHERE id = ?').run(
    m.name,
    m.code,
    m.colour,
    m.description,
    id
  )
  return getModule(db, id)
}

export function archiveModule(db: DB, id: number, archived: boolean): void {
  getModule(db, id)
  db.prepare('UPDATE modules SET archived_at = ? WHERE id = ?').run(archived ? nowIso() : null, id)
}

export function deleteModule(db: DB, id: number, confirmName: string): void {
  const m = getModule(db, id)
  if (confirmName.trim() !== m.name) {
    throw new UserError('The name you typed does not match the module name.')
  }
  db.prepare('DELETE FROM modules WHERE id = ?').run(id)
}

// ---------------------------------------------------------------------------
// Quizzes within a module

interface RawQuiz {
  id: number
  module_id: number
  title: string
  description: string | null
  created_at: string
  archived_at: string | null
  version_no: number
  question_count: number
  total_marks: number
}

const QUIZ_SELECT = `
  SELECT q.*, v.version_no, v.question_count, v.total_marks
  FROM quizzes q
  JOIN quiz_versions v ON v.quiz_id = q.id
    AND v.version_no = (SELECT MAX(version_no) FROM quiz_versions WHERE quiz_id = q.id)
`

function buildQuizRow(db: DB, q: RawQuiz): QuizRow {
  const scores = db
    .prepare(
      `SELECT a.percentage, a.submitted_at FROM attempts a WHERE a.quiz_id = ? AND ${OFFICIAL}
       ORDER BY a.submitted_at`
    )
    .all(q.id) as { percentage: number; submitted_at: string }[]
  const pct = scores.map((s) => s.percentage)
  const inProgress = db
    .prepare(`SELECT id FROM attempts WHERE quiz_id = ? AND status = 'in_progress' ORDER BY id DESC`)
    .pluck()
    .get(q.id) as number | undefined
  return {
    id: q.id,
    moduleId: q.module_id,
    title: q.title,
    description: q.description,
    createdAt: q.created_at,
    archivedAt: q.archived_at,
    versionNo: q.version_no,
    questionCount: q.question_count,
    totalMarks: q.total_marks,
    attemptCount: scores.length,
    best: pct.length ? Math.max(...pct) : null,
    latest: pct.length ? pct[pct.length - 1] : null,
    average: round1(mean(pct)),
    lastAttempted: scores.length ? scores[scores.length - 1].submitted_at : null,
    inProgressAttemptId: inProgress ?? null
  }
}

export function listQuizzes(db: DB, moduleId: number, includeArchived = false): QuizRow[] {
  const rows = db
    .prepare(
      `${QUIZ_SELECT} WHERE q.module_id = ? ${includeArchived ? '' : 'AND q.archived_at IS NULL'}
       ORDER BY q.archived_at IS NOT NULL, q.created_at DESC`
    )
    .all(moduleId) as RawQuiz[]
  return rows.map((q) => buildQuizRow(db, q))
}

export function getQuizRow(db: DB, id: number): QuizRow {
  const q = db.prepare(`${QUIZ_SELECT} WHERE q.id = ?`).get(id) as RawQuiz | undefined
  if (!q) throw new UserError('That quiz no longer exists.', 'NOT_FOUND')
  return buildQuizRow(db, q)
}
