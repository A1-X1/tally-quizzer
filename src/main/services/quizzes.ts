import { createHash } from 'node:crypto'
import type { DB } from '../db/connection'
import { nowIso } from '../db/connection'
import { normaliseForHash, suggestTitle, validateQuizCsv } from '../csv/validate'
import { MAX_CSV_BYTES } from '../../shared/api'
import type {
  ImportPreview,
  ImportRequest,
  ImportResult,
  ModuleColour,
  QuizDetail,
  QuizVersionInfo
} from '../../shared/types'
import { getModule, getQuizRow } from './modules'
import { quizTiming } from './analytics'
import { ATTEMPT_SELECT, mapAttempt, type RawAttemptRow, UserError } from './rows'

export function sha256(text: string): string {
  return createHash('sha256').update(normaliseForHash(text), 'utf8').digest('hex')
}

export function assertCsvSize(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
    throw new UserError(
      `This file is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB. Split it into smaller quizzes.`
    )
  }
}

function moduleQuizzes(db: DB, moduleId: number): ImportPreview['moduleQuizzes'] {
  return db
    .prepare(
      `SELECT q.id AS quizId, q.title, MAX(v.version_no) AS versionNo
       FROM quizzes q JOIN quiz_versions v ON v.quiz_id = q.id
       WHERE q.module_id = ? GROUP BY q.id ORDER BY q.title COLLATE NOCASE`
    )
    .all(moduleId) as ImportPreview['moduleQuizzes']
}

function findDuplicate(db: DB, moduleId: number, hash: string): ImportPreview['duplicateOf'] {
  const dup = db
    .prepare(
      `SELECT q.id AS quizId, q.title, v.version_no AS versionNo
       FROM quiz_versions v JOIN quizzes q ON q.id = v.quiz_id
       WHERE q.module_id = ? AND v.content_sha256 = ? ORDER BY v.id LIMIT 1`
    )
    .get(moduleId, hash) as ImportPreview['duplicateOf'] | undefined
  return dup ?? null
}

export function previewImport(db: DB, moduleId: number, filename: string, text: string): ImportPreview {
  getModule(db, moduleId)
  assertCsvSize(text)
  const v = validateQuizCsv(text)
  const hash = sha256(text)
  const qs = v.questions
  const topics = [...new Set(qs.map((q) => q.topic).filter((t): t is string => !!t))]
  // Prefer a varied sample: the first single and the first multi question, then the rest.
  const firstSingle = qs.find((q) => q.type === 'single')
  const firstMulti = qs.find((q) => q.type === 'multi')
  const firstWritten = qs.find((q) => q.type === 'written')
  const sample = [firstSingle, firstMulti, firstWritten, ...qs]
    .filter((q, i, arr): q is NonNullable<typeof q> => !!q && arr.indexOf(q) === i)
    .slice(0, 4)
  return {
    ok: v.ok,
    errors: v.errors,
    filename,
    sha256: hash,
    suggestedTitle: suggestTitle(filename),
    questionCount: qs.length,
    totalMarks: qs.reduce((s, q) => s + q.marks, 0),
    singleCount: qs.filter((q) => q.type === 'single').length,
    multiCount: qs.filter((q) => q.type === 'multi').length,
    writtenCount: qs.filter((q) => q.type === 'written').length,
    topics,
    sample,
    duplicateOf: v.ok ? findDuplicate(db, moduleId, hash) : null,
    moduleQuizzes: moduleQuizzes(db, moduleId)
  }
}

export function commitImport(db: DB, req: ImportRequest): ImportResult {
  getModule(db, req.moduleId)
  assertCsvSize(req.text)
  const v = validateQuizCsv(req.text)
  if (!v.ok) throw new UserError('The file has errors. Fix them and import it again.', 'INVALID_CSV')
  const hash = sha256(req.text)
  const dup = findDuplicate(db, req.moduleId, hash)
  if (dup) {
    throw new UserError(
      `This exact file is already in this module as "${dup.title}" (version ${dup.versionNo}).`,
      'DUPLICATE'
    )
  }
  const title = req.title.trim().replace(/\s+/g, ' ')
  if (!title) throw new UserError('Give the quiz a title.')
  if (title.length > 200) throw new UserError('Keep the quiz title under 200 characters.')

  const now = nowIso()
  const totalMarks = v.questions.reduce((s, q) => s + q.marks, 0)

  const tx = db.transaction((): ImportResult => {
    let quizId: number
    let versionNo: number
    if (req.mode === 'version') {
      if (req.targetQuizId === null) throw new UserError('Choose which quiz to add a version to.')
      const target = db
        .prepare('SELECT id, module_id FROM quizzes WHERE id = ?')
        .get(req.targetQuizId) as { id: number; module_id: number } | undefined
      if (!target || target.module_id !== req.moduleId) {
        throw new UserError('That quiz is not in this module.')
      }
      quizId = target.id
      versionNo =
        ((db.prepare('SELECT MAX(version_no) FROM quiz_versions WHERE quiz_id = ?').pluck().get(quizId) as
          | number
          | null) ?? 0) + 1
      db.prepare('UPDATE quizzes SET title = ? WHERE id = ?').run(title, quizId)
    } else {
      const info = db
        .prepare('INSERT INTO quizzes (module_id, title, created_at) VALUES (?, ?, ?)')
        .run(req.moduleId, title, now)
      quizId = Number(info.lastInsertRowid)
      versionNo = 1
    }
    const vInfo = db
      .prepare(
        `INSERT INTO quiz_versions (quiz_id, version_no, content_sha256, source_filename, csv_text,
           question_count, total_marks, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(quizId, versionNo, hash, req.filename.slice(0, 255), req.text, v.questions.length, totalMarks, now)
    const versionId = Number(vInfo.lastInsertRowid)
    const insQ = db.prepare(
      `INSERT INTO questions (quiz_version_id, position, prompt, type, marks, explanation, topic, model_answer, mark_scheme_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insO = db.prepare('INSERT INTO options (question_id, label, text, is_correct) VALUES (?, ?, ?, ?)')
    v.questions.forEach((q, i) => {
      const qInfo = insQ.run(
        versionId,
        i + 1,
        q.prompt,
        q.type,
        q.marks,
        q.explanation,
        q.topic,
        q.type === 'written' ? (q.modelAnswer ?? null) : null,
        q.type === 'written' ? JSON.stringify(q.markScheme ?? []) : null
      )
      const qid = Number(qInfo.lastInsertRowid)
      for (const o of q.options) insO.run(qid, o.label, o.text, o.isCorrect ? 1 : 0)
    })
    return { quizId, versionNo, title }
  })
  return tx()
}

function versionInfo(db: DB, row: {
  id: number
  version_no: number
  source_filename: string | null
  question_count: number
  total_marks: number
  imported_at: string
}): QuizVersionInfo {
  const counts = db
    .prepare(
      `SELECT SUM(type = 'single') AS s, SUM(type = 'multi') AS m, SUM(type = 'written') AS w
       FROM questions WHERE quiz_version_id = ?`
    )
    .get(row.id) as { s: number | null; m: number | null; w: number | null }
  const topics = db
    .prepare(
      `SELECT topic FROM questions WHERE quiz_version_id = ? AND topic IS NOT NULL
       GROUP BY topic ORDER BY MIN(position)`
    )
    .pluck()
    .all(row.id) as string[]
  return {
    id: row.id,
    versionNo: row.version_no,
    sourceFilename: row.source_filename,
    questionCount: row.question_count,
    totalMarks: row.total_marks,
    importedAt: row.imported_at,
    singleCount: counts.s ?? 0,
    multiCount: counts.m ?? 0,
    writtenCount: counts.w ?? 0,
    topics
  }
}

export function quizDetail(db: DB, id: number): QuizDetail {
  const quiz = getQuizRow(db, id)
  const mod = getModule(db, quiz.moduleId)
  const versions = (
    db
      .prepare(
        `SELECT id, version_no, source_filename, question_count, total_marks, imported_at
         FROM quiz_versions WHERE quiz_id = ? ORDER BY version_no DESC`
      )
      .all(id) as Parameters<typeof versionInfo>[1][]
  ).map((r) => versionInfo(db, r))
  const attempts = (
    db
      .prepare(`${ATTEMPT_SELECT} WHERE a.quiz_id = ? AND a.status = 'submitted' ORDER BY a.submitted_at DESC`)
      .all(id) as RawAttemptRow[]
  ).map(mapAttempt)
  const official = attempts.filter((a) => !a.isPractice && a.percentage !== null)
  const bestRow = official.reduce<(typeof official)[number] | null>(
    (b, a) => (b === null || (a.percentage ?? 0) > (b.percentage ?? 0) ? a : b),
    null
  )
  const lastRow = official[0] ?? null
  const pick = (a: (typeof official)[number] | null): QuizDetail['best'] =>
    a ? { percentage: a.percentage ?? 0, attemptNumber: a.attemptNumber ?? 0, submittedAt: a.submittedAt ?? '' } : null
  return {
    quiz,
    module: { id: mod.id, name: mod.name, code: mod.code, colour: mod.colour as ModuleColour },
    version: versions[0],
    versions,
    best: pick(bestRow),
    last: pick(lastRow),
    attempts,
    timing: quizTiming(db, id)
  }
}

export function renameQuiz(db: DB, id: number, title: string, description: string | null): void {
  getQuizRow(db, id)
  const t = title.trim().replace(/\s+/g, ' ')
  if (!t) throw new UserError('Give the quiz a title.')
  db.prepare('UPDATE quizzes SET title = ?, description = ? WHERE id = ?').run(t, description?.trim() || null, id)
}

export function archiveQuiz(db: DB, id: number, archived: boolean): void {
  getQuizRow(db, id)
  db.prepare('UPDATE quizzes SET archived_at = ? WHERE id = ?').run(archived ? nowIso() : null, id)
}

export function deleteQuiz(db: DB, id: number): void {
  getQuizRow(db, id)
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(id)
}

/** Every quiz version with its module and title, for rewriting the readable mirror. */
export function allVersionsForMirror(db: DB): {
  moduleName: string
  title: string
  versionNo: number
  csv: string
}[] {
  return db
    .prepare(
      `SELECT m.name AS moduleName, q.title, v.version_no AS versionNo, v.csv_text AS csv
       FROM quiz_versions v JOIN quizzes q ON q.id = v.quiz_id JOIN modules m ON m.id = q.module_id`
    )
    .all() as { moduleName: string; title: string; versionNo: number; csv: string }[]
}
