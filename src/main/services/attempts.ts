import type { DB } from '../db/connection'
import { nowIso } from '../db/connection'
import { markQuestion, percentage, shuffle } from '../marking'
import { blankMarking, markingTotal } from '../ai/mark'
import {
  OPTION_LABELS,
  type AnswerRequest,
  type AttemptListRow,
  type AttemptResult,
  type AttemptSession,
  type AttemptSettings,
  type ModuleColour,
  type QuestionFeedback,
  type QuestionType,
  type ReviewQuestion,
  type AttemptTiming,
  type MarkPoint,
  type WrittenMarking,
  type WrittenReview,
  type TopicTiming,
  type SessionQuestion,
  type StartAttemptRequest,
  type TickRequest
} from '../../shared/types'
import { ATTEMPT_SELECT, getAttemptRow, mapAttempt, type RawAttemptRow, UserError } from './rows'

interface RawAttempt {
  id: number
  quiz_id: number
  quiz_version_id: number
  attempt_number: number | null
  status: string
  is_practice: number
  marking_mode: 'strict' | 'partial'
  feedback_mode: 'end' | 'each'
  settings_json: string
  started_at: string
  submitted_at: string | null
  duration_seconds: number
  marks_available: number
  current_position: number
}

interface RawResponse {
  id: number
  question_id: number
  display_position: number
  option_order_json: string
  selected_option_ids_json: string
  is_correct: number | null
  marks_awarded: number | null
  time_spent_seconds: number
  flagged: number
  revealed_at: string | null
  answered_at: string | null
  visit_count: number
  answer_changes: number
  first_answer_seconds: number | null
  prompt: string
  type: QuestionType
  marks: number
  explanation: string | null
  topic: string | null
  model_answer: string | null
  mark_scheme_json: string | null
  written_answer: string | null
  marking_json: string | null
  marked_by: string | null
}

interface RawOption {
  id: number
  question_id: number
  label: string
  text: string
  is_correct: number
}

/** Hard ceiling on a single active-time tick, so a stuck renderer cannot inflate time. */
export const MAX_TICK_SECONDS = 30

function loadAttempt(db: DB, id: number): RawAttempt {
  const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as RawAttempt | undefined
  if (!a) throw new UserError('That attempt no longer exists.', 'NOT_FOUND')
  return a
}

function requireInProgress(a: RawAttempt): void {
  if (a.status !== 'in_progress') throw new UserError('This attempt has already finished.', 'NOT_IN_PROGRESS')
}

function parseIds(json: string): number[] {
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []
  } catch {
    return []
  }
}

function nextAttemptNumber(db: DB, quizId: number): number {
  return (
    ((db
      .prepare('SELECT MAX(attempt_number) FROM attempts WHERE quiz_id = ?')
      .pluck()
      .get(quizId) as number | null) ?? 0) + 1
  )
}

export function startAttempt(db: DB, req: StartAttemptRequest, random: () => number = Math.random): number {
  const quiz = db
    .prepare('SELECT q.id, q.archived_at, m.archived_at AS m_archived FROM quizzes q JOIN modules m ON m.id = q.module_id WHERE q.id = ?')
    .get(req.quizId) as { id: number; archived_at: string | null; m_archived: string | null } | undefined
  if (!quiz) throw new UserError('That quiz no longer exists.', 'NOT_FOUND')
  if (quiz.archived_at || quiz.m_archived) throw new UserError('Restore this quiz from the archive before taking it.')

  let versionId: number
  let questionIds: number[]
  let parentId: number | null = null
  const isPractice = req.practiceFromAttemptId !== null

  if (req.practiceFromAttemptId !== null) {
    const src = loadAttempt(db, req.practiceFromAttemptId)
    if (src.quiz_id !== req.quizId || src.status !== 'submitted') {
      throw new UserError('Practice runs can only be started from a finished attempt of this quiz.')
    }
    versionId = src.quiz_version_id
    parentId = src.id
    questionIds = db
      .prepare(
        `SELECT r.question_id FROM responses r JOIN questions q ON q.id = r.question_id
         WHERE r.attempt_id = ? AND COALESCE(r.is_correct, 0) = 0 ORDER BY q.position`
      )
      .pluck()
      .all(src.id) as number[]
    if (questionIds.length === 0) throw new UserError('Every answer in that attempt was right, so there is nothing to practise.')
  } else {
    const v = db
      .prepare('SELECT id FROM quiz_versions WHERE quiz_id = ? ORDER BY version_no DESC LIMIT 1')
      .get(req.quizId) as { id: number } | undefined
    if (!v) throw new UserError('This quiz has no questions.')
    versionId = v.id
    questionIds = db
      .prepare(
        `SELECT id FROM questions WHERE quiz_version_id = ?
           AND (@types = 'all' OR (@types = 'written' AND type = 'written') OR (@types = 'choice' AND type <> 'written'))
         ORDER BY position`
      )
      .pluck()
      .all(versionId, { types: req.settings.questionTypes ?? 'all' }) as number[]
    if (questionIds.length === 0) throw new UserError('This quiz has no questions of that kind.')
  }

  const existing = db
    .prepare(`SELECT id FROM attempts WHERE quiz_id = ? AND status = 'in_progress'`)
    .pluck()
    .all(req.quizId) as number[]

  const s: AttemptSettings = {
    shuffleQuestions: req.settings.shuffleQuestions,
    shuffleOptions: req.settings.shuffleOptions,
    feedback: req.settings.feedback,
    timeLimitMinutes: req.settings.timeLimitMinutes,
    marking: req.settings.marking,
    aiMarking: req.settings.aiMarking ?? false,
    questionTypes: req.settings.questionTypes ?? 'all'
  }

  const tx = db.transaction((): number => {
    if (existing.length > 0) {
      if (!req.replaceInProgress) {
        throw new UserError('You already have an unfinished attempt at this quiz.', 'IN_PROGRESS')
      }
      db.prepare(`UPDATE attempts SET status = 'abandoned' WHERE quiz_id = ? AND status = 'in_progress'`).run(req.quizId)
    }
    const order = s.shuffleQuestions ? shuffle(questionIds, random) : questionIds
    const marks = db
      .prepare(`SELECT COALESCE(SUM(marks), 0) FROM questions WHERE id IN (${order.map(() => '?').join(',')})`)
      .pluck()
      .get(...order) as number
    const info = db
      .prepare(
        `INSERT INTO attempts (quiz_id, quiz_version_id, attempt_number, status, is_practice, marking_mode,
           feedback_mode, settings_json, started_at, marks_available, parent_attempt_id)
         VALUES (?, ?, NULL, 'in_progress', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.quizId, versionId, isPractice ? 1 : 0, s.marking, s.feedback, JSON.stringify(s), nowIso(), marks, parentId)
    const attemptId = Number(info.lastInsertRowid)
    const optStmt = db.prepare('SELECT id FROM options WHERE question_id = ? ORDER BY label')
    const insR = db.prepare(
      `INSERT INTO responses (attempt_id, question_id, display_position, option_order_json)
       VALUES (?, ?, ?, ?)`
    )
    order.forEach((qid, i) => {
      const opts = optStmt.pluck().all(qid) as number[]
      const optOrder = s.shuffleOptions ? shuffle(opts, random) : opts
      insR.run(attemptId, qid, i + 1, JSON.stringify(optOrder))
    })
    return attemptId
  })
  return tx()
}

function loadResponses(db: DB, attemptId: number): { responses: RawResponse[]; options: Map<number, RawOption[]> } {
  const responses = db
    .prepare(
      `SELECT r.*, q.prompt, q.type, q.marks, q.explanation, q.topic, q.model_answer, q.mark_scheme_json
       FROM responses r JOIN questions q ON q.id = r.question_id
       WHERE r.attempt_id = ? ORDER BY r.display_position`
    )
    .all(attemptId) as RawResponse[]
  const options = new Map<number, RawOption[]>()
  const all = db
    .prepare(
      `SELECT o.* FROM options o JOIN responses r ON r.question_id = o.question_id WHERE r.attempt_id = ?`
    )
    .all(attemptId) as RawOption[]
  for (const o of all) {
    const list = options.get(o.question_id) ?? []
    list.push(o)
    options.set(o.question_id, list)
  }
  return { responses, options }
}

function orderedOptions(r: RawResponse, options: Map<number, RawOption[]>): RawOption[] {
  const byId = new Map((options.get(r.question_id) ?? []).map((o) => [o.id, o]))
  const order = parseIds(r.option_order_json)
  const list = order.map((id) => byId.get(id)).filter((o): o is RawOption => !!o)
  // Guard against a malformed order: fall back to label order.
  return list.length === 5 ? list : [...byId.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function schemeOf(r: RawResponse): MarkPoint[] {
  try {
    const v = JSON.parse(r.mark_scheme_json ?? '[]') as MarkPoint[]
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function markingOf(r: RawResponse): WrittenMarking | null {
  if (!r.marking_json) return null
  try {
    return JSON.parse(r.marking_json) as WrittenMarking
  } catch {
    return null
  }
}

function writtenReview(r: RawResponse): WrittenReview {
  return { modelAnswer: r.model_answer ?? '', markScheme: schemeOf(r), marking: markingOf(r) }
}

function feedbackFor(r: RawResponse, opts: RawOption[], mode: 'strict' | 'partial'): QuestionFeedback {
  if (r.type === 'written') {
    const m = markingOf(r)
    const total = m ? markingTotal(m) : 0
    return { correctOptionIds: [], marksAwarded: total, isCorrect: total >= r.marks, explanation: r.explanation, written: writtenReview(r) }
  }
  const correct = opts.filter((o) => o.is_correct === 1).map((o) => o.id)
  const outcome = markQuestion(correct, parseIds(r.selected_option_ids_json), r.marks, mode)
  return {
    correctOptionIds: correct,
    marksAwarded: outcome.marksAwarded,
    isCorrect: outcome.isCorrect,
    explanation: r.explanation
  }
}

export function getSession(db: DB, id: number): AttemptSession {
  const a = loadAttempt(db, id)
  requireInProgress(a)
  const meta = db
    .prepare(
      `SELECT q.title, m.name, m.colour, v.version_no FROM quizzes q JOIN modules m ON m.id = q.module_id
       JOIN quiz_versions v ON v.id = ? WHERE q.id = ?`
    )
    .get(a.quiz_version_id, a.quiz_id) as { title: string; name: string; colour: string; version_no: number }
  const { responses, options } = loadResponses(db, id)
  const questions: SessionQuestion[] = responses.map((r) => {
    const opts = orderedOptions(r, options)
    return {
      id: r.question_id,
      displayPosition: r.display_position,
      prompt: r.prompt,
      type: r.type,
      marks: r.marks,
      topic: r.topic,
      options: opts.map((o, i) => ({ id: o.id, label: OPTION_LABELS[i], text: o.text })),
      selected: parseIds(r.selected_option_ids_json),
      flagged: r.flagged === 1,
      timeSpent: Math.round(r.time_spent_seconds),
      writtenAnswer: r.written_answer ?? '',
      feedback: r.revealed_at ? feedbackFor(r, opts, a.marking_mode) : null
    }
  })
  return {
    id: a.id,
    quizId: a.quiz_id,
    quizTitle: meta.title,
    moduleName: meta.name,
    moduleColour: meta.colour as ModuleColour,
    versionNo: meta.version_no,
    isPractice: a.is_practice === 1,
    projectedAttemptNumber: a.is_practice === 1 ? null : nextAttemptNumber(db, a.quiz_id),
    settings: JSON.parse(a.settings_json) as AttemptSettings,
    startedAt: a.started_at,
    durationSeconds: Math.round(a.duration_seconds),
    currentPosition: a.current_position,
    marksAvailable: a.marks_available,
    questions
  }
}

function loadResponse(db: DB, attemptId: number, questionId: number): RawResponse {
  const r = db
    .prepare(
      `SELECT r.*, q.prompt, q.type, q.marks, q.explanation, q.topic, q.model_answer, q.mark_scheme_json
       FROM responses r JOIN questions q ON q.id = r.question_id
       WHERE r.attempt_id = ? AND r.question_id = ?`
    )
    .get(attemptId, questionId) as RawResponse | undefined
  if (!r) throw new UserError('That question is not part of this attempt.')
  return r
}

export function saveAnswer(db: DB, req: AnswerRequest): void {
  const a = loadAttempt(db, req.attemptId)
  requireInProgress(a)
  const r = loadResponse(db, req.attemptId, req.questionId)
  if (r.revealed_at) throw new UserError('You have already checked this answer.', 'LOCKED')
  const valid = new Set(parseIds(r.option_order_json))
  const selected = [...new Set(req.selected)]
  if (!selected.every((id) => valid.has(id))) throw new UserError('That option does not belong to this question.')
  if (r.type === 'single' && selected.length > 1) throw new UserError('Choose only one option for this question.')
  const previous = parseIds(r.selected_option_ids_json)
  const changed =
    previous.length > 0 && (previous.length !== selected.length || previous.some((id) => !selected.includes(id)))
  db.prepare(
    `UPDATE responses SET selected_option_ids_json = ?, answered_at = ?,
       answer_changes = answer_changes + ?,
       first_answer_seconds = COALESCE(first_answer_seconds, CASE WHEN ? > 0 THEN time_spent_seconds END)
     WHERE id = ?`
  ).run(JSON.stringify(selected), selected.length ? nowIso() : null, changed ? 1 : 0, selected.length, r.id)
}

export function revealAnswer(db: DB, attemptId: number, questionId: number): QuestionFeedback {
  const a = loadAttempt(db, attemptId)
  requireInProgress(a)
  if (a.feedback_mode !== 'each') throw new UserError('Answers are shown at the end of this attempt.')
  const r = loadResponse(db, attemptId, questionId)
  if (r.type === 'written') {
    if (!r.revealed_at) {
      db.prepare('UPDATE responses SET revealed_at = ? WHERE id = ?').run(nowIso(), r.id)
      if (!(r.written_answer ?? '').trim()) applyMarking(db, attemptId, questionId, blankMarking(schemeOf(r)))
    }
    return feedbackFor(loadResponse(db, attemptId, questionId), [], a.marking_mode)
  }
  const { options } = loadResponses(db, attemptId)
  const fb = feedbackFor(r, orderedOptions(r, options), a.marking_mode)
  if (!r.revealed_at) {
    db.prepare('UPDATE responses SET revealed_at = ?, is_correct = ?, marks_awarded = ? WHERE id = ?').run(
      nowIso(),
      fb.isCorrect ? 1 : 0,
      fb.marksAwarded,
      r.id
    )
  }
  return fb
}

export function setFlag(db: DB, attemptId: number, questionId: number, flagged: boolean): void {
  const a = loadAttempt(db, attemptId)
  requireInProgress(a)
  const r = loadResponse(db, attemptId, questionId)
  db.prepare('UPDATE responses SET flagged = ? WHERE id = ?').run(flagged ? 1 : 0, r.id)
}

export function tick(db: DB, req: TickRequest): void {
  const a = loadAttempt(db, req.attemptId)
  if (a.status !== 'in_progress') return
  const seconds = Math.min(Math.max(req.seconds, 0), MAX_TICK_SECONDS)
  const tx = db.transaction(() => {
    db.prepare('UPDATE attempts SET duration_seconds = duration_seconds + ?, current_position = ? WHERE id = ?').run(
      seconds,
      Math.max(0, Math.floor(req.position)),
      a.id
    )
    if (req.questionId !== null) {
      db.prepare(
        `UPDATE responses SET time_spent_seconds = time_spent_seconds + ?, visit_count = visit_count + ?
         WHERE attempt_id = ? AND question_id = ?`
      ).run(seconds, req.visit ? 1 : 0, a.id, req.questionId)
    }
  })
  tx()
}

export function submitAttempt(db: DB, id: number, now: string = nowIso()): void {
  const a = loadAttempt(db, id)
  requireInProgress(a)
  const { responses, options } = loadResponses(db, id)
  const tx = db.transaction(() => {
    let awarded = 0
    const upd = db.prepare('UPDATE responses SET is_correct = ?, marks_awarded = ? WHERE id = ?')
    for (const r of responses) {
      if (r.type === 'written') {
        let m = markingOf(r)
        if (!m && !(r.written_answer ?? '').trim()) {
          m = blankMarking(schemeOf(r))
          db.prepare(`UPDATE responses SET marking_json = ?, marked_by = 'auto' WHERE id = ?`).run(JSON.stringify(m), r.id)
        }
        const got = m ? markingTotal(m) : 0
        awarded += got
        upd.run(m && got >= r.marks ? 1 : 0, got, r.id)
        continue
      }
      const opts = options.get(r.question_id) ?? []
      const correct = opts.filter((o) => o.is_correct === 1).map((o) => o.id)
      const out = markQuestion(correct, parseIds(r.selected_option_ids_json), r.marks, a.marking_mode)
      awarded += out.marksAwarded
      upd.run(out.isCorrect ? 1 : 0, out.marksAwarded, r.id)
    }
    awarded = Math.round(awarded * 10000) / 10000
    const number = a.is_practice === 1 ? null : nextAttemptNumber(db, a.quiz_id)
    db.prepare(
      `UPDATE attempts SET status = 'submitted', submitted_at = ?, marks_awarded = ?, percentage = ?,
         attempt_number = ? WHERE id = ?`
    ).run(now, awarded, percentage(awarded, a.marks_available), number, id)
    recomputeAttempt(db, id)
  })
  tx()
}

// ---------------------------------------------------------------------------
// Written answers

export function saveWritten(db: DB, attemptId: number, questionId: number, text: string): void {
  const a = loadAttempt(db, attemptId)
  requireInProgress(a)
  const r = loadResponse(db, attemptId, questionId)
  if (r.type !== 'written') throw new UserError('That question is not a written question.')
  if (r.revealed_at) throw new UserError('You have already checked this answer.', 'LOCKED')
  const previous = (r.written_answer ?? '').trim()
  const next = text.slice(0, 8000)
  const changed = previous !== '' && previous !== next.trim()
  db.prepare(
    `UPDATE responses SET written_answer = ?, answered_at = ?, answer_changes = answer_changes + ?,
       selected_option_ids_json = '[]',
       first_answer_seconds = COALESCE(first_answer_seconds, CASE WHEN ? > 0 THEN time_spent_seconds END)
     WHERE id = ?`
  ).run(next, next.trim() ? nowIso() : null, changed && !previous.startsWith(next.trim()) && !next.trim().startsWith(previous) ? 1 : 0, next.trim().length, r.id)
}

/** Written answers in a submitted attempt that still have no marking. */
export function unmarkedWritten(db: DB, attemptId: number): {
  questionId: number
  prompt: string
  marks: number
  scheme: MarkPoint[]
  modelAnswer: string
  answer: string
}[] {
  return (
    db
      .prepare(
        `SELECT r.*, q.prompt, q.type, q.marks, q.explanation, q.topic, q.model_answer, q.mark_scheme_json
         FROM responses r JOIN questions q ON q.id = r.question_id
         WHERE r.attempt_id = ? AND q.type = 'written' AND r.marking_json IS NULL
           AND TRIM(COALESCE(r.written_answer, '')) <> ''
         ORDER BY r.display_position`
      )
      .all(attemptId) as RawResponse[]
  ).map((r) => ({
    questionId: r.question_id,
    prompt: r.prompt,
    marks: r.marks,
    scheme: schemeOf(r),
    modelAnswer: r.model_answer ?? '',
    answer: r.written_answer ?? ''
  }))
}

/** Store a marking for one written answer and update the attempt's totals. */
export function applyMarking(db: DB, attemptId: number, questionId: number, marking: WrittenMarking): void {
  const r = loadResponse(db, attemptId, questionId)
  if (r.type !== 'written') throw new UserError('That question is not a written question.')
  const scheme = schemeOf(r)
  if (marking.points.length !== scheme.length) throw new UserError('The marks do not match the mark scheme.')
  const clean: WrittenMarking = {
    ...marking,
    points: marking.points.map((p, i) => ({ ...p, awarded: Math.min(scheme[i].marks, Math.max(0, Math.round(p.awarded * 2) / 2)) }))
  }
  const total = markingTotal(clean)
  const tx = db.transaction(() => {
    db.prepare('UPDATE responses SET marking_json = ?, marked_by = ?, marks_awarded = ?, is_correct = ? WHERE id = ?').run(
      JSON.stringify(clean),
      clean.markedBy,
      total,
      total >= r.marks ? 1 : 0,
      r.id
    )
    recomputeAttempt(db, attemptId)
  })
  tx()
}

/** Adjust the marks for a written answer by hand (self-marking or disagreeing with the AI). */
export function adjustMarking(db: DB, attemptId: number, questionId: number, awarded: number[]): void {
  const r = loadResponse(db, attemptId, questionId)
  const scheme = schemeOf(r)
  if (awarded.length !== scheme.length) throw new UserError('Give a mark for every point in the mark scheme.')
  const prev = markingOf(r)
  const marking: WrittenMarking = prev
    ? { ...prev, points: prev.points.map((p, i) => ({ ...p, awarded: awarded[i] })), edited: true, markedAt: nowIso() }
    : {
        points: scheme.map((_, i) => ({ awarded: awarded[i], evidence: '', reason: '' })),
        feedback: '',
        markedBy: 'self',
        model: null,
        markedAt: nowIso(),
        edited: false
      }
  applyMarking(db, attemptId, questionId, marking)
}

/** Re-total a submitted attempt after a written answer is (re)marked. */
export function recomputeAttempt(db: DB, attemptId: number): void {
  const a = loadAttempt(db, attemptId)
  if (a.status !== 'submitted') return
  const t = db
    .prepare(
      `SELECT COALESCE(SUM(r.marks_awarded), 0) AS awarded,
              SUM(q.type = 'written' AND r.marking_json IS NULL) AS pending
       FROM responses r JOIN questions q ON q.id = r.question_id WHERE r.attempt_id = ?`
    )
    .get(attemptId) as { awarded: number; pending: number | null }
  const awarded = Math.round(t.awarded * 10000) / 10000
  db.prepare('UPDATE attempts SET marks_awarded = ?, percentage = ?, needs_marking = ? WHERE id = ?').run(
    awarded,
    percentage(awarded, a.marks_available),
    t.pending ?? 0,
    attemptId
  )
}

export function abandonAttempt(db: DB, id: number): void {
  const a = loadAttempt(db, id)
  requireInProgress(a)
  db.prepare(`UPDATE attempts SET status = 'abandoned' WHERE id = ?`).run(id)
}

export function inProgress(db: DB): AttemptListRow[] {
  return (
    db
      .prepare(
        `${ATTEMPT_SELECT} WHERE a.status = 'in_progress' AND q.archived_at IS NULL AND m.archived_at IS NULL
         ORDER BY a.started_at DESC`
      )
      .all() as RawAttemptRow[]
  ).map(mapAttempt)
}

export function getResult(db: DB, id: number): AttemptResult {
  const a = loadAttempt(db, id)
  if (a.status !== 'submitted') throw new UserError('This attempt has not been submitted.', 'NOT_SUBMITTED')
  const row = getAttemptRow(db, id)
  const { responses, options } = loadResponses(db, id)

  const questions: ReviewQuestion[] = responses.map((r) => {
    const opts = orderedOptions(r, options)
    const selected = parseIds(r.selected_option_ids_json)
    return {
      id: r.question_id,
      displayPosition: r.display_position,
      prompt: r.prompt,
      type: r.type,
      marks: r.marks,
      topic: r.topic,
      explanation: r.explanation,
      options: opts.map((o, i) => ({ id: o.id, label: OPTION_LABELS[i], text: o.text, isCorrect: o.is_correct === 1 })),
      selected,
      marksAwarded: r.marks_awarded ?? 0,
      isCorrect: r.is_correct === 1,
      answered: r.type === 'written' ? !!(r.written_answer ?? '').trim() : selected.length > 0,
      timeSpent: Math.round(r.time_spent_seconds),
      flagged: r.flagged === 1,
      visits: r.visit_count,
      answerChanges: r.answer_changes,
      firstAnswerSeconds: r.first_answer_seconds === null ? null : Math.round(r.first_answer_seconds),
      writtenAnswer: r.type === 'written' ? (r.written_answer ?? '') : null,
      written: r.type === 'written' ? writtenReview(r) : null
    }
  })

  const topicMap = new Map<string, { awarded: number; available: number; questions: number }>()
  for (const q of questions) {
    if (!q.topic) continue
    const t = topicMap.get(q.topic) ?? { awarded: 0, available: 0, questions: 0 }
    t.awarded += q.marksAwarded
    t.available += q.marks
    t.questions += 1
    topicMap.set(q.topic, t)
  }
  const topics = [...topicMap.entries()].map(([topic, t]) => ({
    topic,
    awarded: Math.round(t.awarded * 100) / 100,
    available: t.available,
    percentage: percentage(t.awarded, t.available),
    questions: t.questions
  }))

  let previous: AttemptResult['previous'] = null
  let best: AttemptResult['best'] = null
  if (a.is_practice === 0 && a.attempt_number !== null) {
    const prev = db
      .prepare(
        `SELECT attempt_number, percentage FROM attempts WHERE quiz_id = ? AND attempt_number < ?
         ORDER BY attempt_number DESC LIMIT 1`
      )
      .get(a.quiz_id, a.attempt_number) as { attempt_number: number; percentage: number } | undefined
    if (prev) previous = { attemptNumber: prev.attempt_number, percentage: prev.percentage }
    const b = db
      .prepare(
        `SELECT attempt_number, percentage FROM attempts WHERE quiz_id = ? AND attempt_number IS NOT NULL
         ORDER BY percentage DESC, attempt_number ASC LIMIT 1`
      )
      .get(a.quiz_id) as { attempt_number: number; percentage: number } | undefined
    if (b) best = { attemptNumber: b.attempt_number, percentage: b.percentage }
  }

  return {
    attempt: row,
    settings: JSON.parse(a.settings_json) as AttemptSettings,
    previous,
    best,
    topics,
    questions,
    wrongCount: questions.filter((q) => !q.isCorrect).length,
    timing: timingFor(questions),
    needsMarking: questions.filter((q) => q.written && !q.written.marking).length
  }
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r1 = (n: number): number => Math.round(n * 10) / 10

/** Where the time went in one attempt: overall, right versus wrong, and by topic. */
export function timingFor(questions: ReviewQuestion[]): AttemptTiming {
  const secs = questions.map((q) => q.timeSpent)
  const total = secs.reduce((a, b) => a + b, 0)
  const sorted = [...secs].sort((a, b) => a - b)
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0
  const right = avg(questions.filter((q) => q.isCorrect).map((q) => q.timeSpent))
  const wrong = avg(questions.filter((q) => !q.isCorrect).map((q) => q.timeSpent))
  const map = new Map<string, { seconds: number; questions: number; awarded: number; available: number }>()
  for (const q of questions) {
    const key = q.topic ?? 'No topic'
    const t = map.get(key) ?? { seconds: 0, questions: 0, awarded: 0, available: 0 }
    t.seconds += q.timeSpent
    t.questions += 1
    t.awarded += q.marksAwarded
    t.available += q.marks
    map.set(key, t)
  }
  const topics: TopicTiming[] = [...map.entries()]
    .map(([topic, t]) => ({
      topic,
      seconds: t.seconds,
      share: total > 0 ? r1((t.seconds / total) * 100) : 0,
      questions: t.questions,
      perQuestion: r1(t.seconds / t.questions),
      percentage: percentage(t.awarded, t.available)
    }))
    .sort((a, b) => b.seconds - a.seconds)
  return {
    questionSeconds: total,
    perQuestion: questions.length ? r1(total / questions.length) : 0,
    median: r1(median),
    rightPerQuestion: right === null ? null : r1(right),
    wrongPerQuestion: wrong === null ? null : r1(wrong),
    answerChanges: questions.reduce((s, q) => s + q.answerChanges, 0),
    topics
  }
}
