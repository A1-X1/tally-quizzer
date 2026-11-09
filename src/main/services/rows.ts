import type { DB } from '../db/connection'
import type { AttemptListRow, AttemptStatus, MarkingMode, ModuleColour } from '../../shared/types'

export class UserError extends Error {
  constructor(
    message: string,
    public code: string = 'USER'
  ) {
    super(message)
  }
}

export const ATTEMPT_SELECT = `
  SELECT a.id, a.quiz_id, q.title AS quiz_title, m.id AS module_id, m.name AS module_name,
         m.colour AS module_colour, v.version_no, a.attempt_number, a.is_practice, a.status,
         a.marking_mode, a.started_at, a.submitted_at, a.duration_seconds, a.marks_awarded,
         a.marks_available, a.percentage,
         (SELECT COUNT(*) FROM responses r WHERE r.attempt_id = a.id) AS question_count
  FROM attempts a
  JOIN quizzes q ON q.id = a.quiz_id
  JOIN modules m ON m.id = q.module_id
  JOIN quiz_versions v ON v.id = a.quiz_version_id
`

export interface RawAttemptRow {
  id: number
  quiz_id: number
  quiz_title: string
  module_id: number
  module_name: string
  module_colour: string
  version_no: number
  attempt_number: number | null
  is_practice: number
  status: string
  marking_mode: string
  started_at: string
  submitted_at: string | null
  duration_seconds: number
  marks_awarded: number | null
  marks_available: number
  percentage: number | null
  question_count: number
}

export function mapAttempt(r: RawAttemptRow): AttemptListRow {
  return {
    id: r.id,
    quizId: r.quiz_id,
    quizTitle: r.quiz_title,
    moduleId: r.module_id,
    moduleName: r.module_name,
    moduleColour: r.module_colour as ModuleColour,
    versionNo: r.version_no,
    attemptNumber: r.attempt_number,
    isPractice: r.is_practice === 1,
    status: r.status as AttemptStatus,
    markingMode: r.marking_mode as MarkingMode,
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    durationSeconds: Math.round(r.duration_seconds),
    marksAwarded: r.marks_awarded,
    marksAvailable: r.marks_available,
    percentage: r.percentage,
    questionCount: r.question_count
  }
}

export function getAttemptRow(db: DB, id: number): AttemptListRow {
  const r = db.prepare(`${ATTEMPT_SELECT} WHERE a.id = ?`).get(id) as RawAttemptRow | undefined
  if (!r) throw new UserError('That attempt no longer exists.', 'NOT_FOUND')
  return mapAttempt(r)
}

export const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length

export const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10)

/** Change in points between the mean of the latest three and the three before them. */
export function trendOf(chronological: number[]): number | null {
  if (chronological.length < 2) return null
  const recent = chronological.slice(-3)
  const before = chronological.slice(-6, -3)
  if (before.length === 0) {
    return round1(chronological[chronological.length - 1] - chronological[0])
  }
  return round1((mean(recent) ?? 0) - (mean(before) ?? 0))
}
