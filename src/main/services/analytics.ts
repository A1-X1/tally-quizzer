import type { DB } from '../db/connection'
import { percentage } from '../marking'
import type {
  AttemptListRow,
  Dashboard,
  DateRange,
  HistoryFilter,
  MissedQuestion,
  ModuleColour,
  ModuleDetail,
  ScorePoint,
  TopicStat
} from '../../shared/types'
import { listModules, getModule, listQuizzes } from './modules'
import { inProgress } from './attempts'
import { ATTEMPT_SELECT, mapAttempt, mean, type RawAttemptRow, round1 } from './rows'

const DAY = 24 * 60 * 60 * 1000

export function rangeStart(range: DateRange, now: Date = new Date()): string | null {
  const days = range === '30d' ? 30 : range === '90d' ? 90 : range === '1y' ? 365 : null
  return days === null ? null : new Date(now.getTime() - days * DAY).toISOString()
}

const VISIBLE = `q.archived_at IS NULL AND m.archived_at IS NULL`
const OFFICIAL = `a.status = 'submitted' AND a.is_practice = 0`

function series(db: DB, moduleId: number | null, from: string | null): ScorePoint[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.submitted_at, a.percentage, a.attempt_number, q.title, m.id AS module_id, m.name, m.colour
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id
       WHERE ${OFFICIAL} AND ${VISIBLE}
         AND (@moduleId IS NULL OR m.id = @moduleId)
         AND (@from IS NULL OR a.submitted_at >= @from)
       ORDER BY a.submitted_at`
    )
    .all({ moduleId, from }) as {
    id: number
    submitted_at: string
    percentage: number
    attempt_number: number
    title: string
    module_id: number
    name: string
    colour: string
  }[]
  return rows.map((r) => ({
    attemptId: r.id,
    submittedAt: r.submitted_at,
    percentage: r.percentage,
    quizTitle: r.title,
    moduleId: r.module_id,
    moduleName: r.name,
    moduleColour: r.colour as ModuleColour,
    attemptNumber: r.attempt_number
  }))
}

export function missedQuestions(db: DB, moduleId: number | null, limit = 6): MissedQuestion[] {
  // Questions are grouped by quiz and prompt so that re-uploaded versions accumulate.
  return db
    .prepare(
      `SELECT q.id AS quizId, q.title AS quizTitle, m.name AS moduleName, qu.prompt, MAX(qu.topic) AS topic,
              COUNT(*) AS seen, SUM(COALESCE(r.is_correct, 0) = 0) AS missed
       FROM responses r
       JOIN attempts a ON a.id = r.attempt_id
       JOIN questions qu ON qu.id = r.question_id
       JOIN quizzes q ON q.id = a.quiz_id
       JOIN modules m ON m.id = q.module_id
       WHERE ${OFFICIAL} AND ${VISIBLE} AND (@moduleId IS NULL OR m.id = @moduleId)
       GROUP BY q.id, qu.prompt
       HAVING missed > 0
       ORDER BY (CAST(missed AS REAL) / seen) DESC, missed DESC, seen DESC
       LIMIT @limit`
    )
    .all({ moduleId, limit }) as MissedQuestion[]
}

export function topicStats(db: DB, moduleId: number | null): TopicStat[] {
  const rows = db
    .prepare(
      `SELECT qu.topic, m.id AS moduleId, m.name AS moduleName,
              SUM(COALESCE(r.marks_awarded, 0)) AS awarded, SUM(qu.marks) AS available, COUNT(*) AS answered
       FROM responses r
       JOIN attempts a ON a.id = r.attempt_id
       JOIN questions qu ON qu.id = r.question_id
       JOIN quizzes q ON q.id = a.quiz_id
       JOIN modules m ON m.id = q.module_id
       WHERE ${OFFICIAL} AND ${VISIBLE} AND qu.topic IS NOT NULL
         AND (@moduleId IS NULL OR m.id = @moduleId)
       GROUP BY m.id, qu.topic`
    )
    .all({ moduleId }) as Omit<TopicStat, 'percentage'>[]
  return rows
    .map((r) => ({ ...r, awarded: Math.round(r.awarded * 100) / 100, percentage: percentage(r.awarded, r.available) }))
    .sort((a, b) => a.percentage - b.percentage || b.answered - a.answered)
}

export function dashboard(db: DB, moduleId: number | null, range: DateRange, now: Date = new Date()): Dashboard {
  const all = series(db, null, null)
  const last30 = all.filter((p) => new Date(p.submittedAt).getTime() >= now.getTime() - 30 * DAY)
  const prev30 = all.filter((p) => {
    const t = new Date(p.submittedAt).getTime()
    return t < now.getTime() - 30 * DAY && t >= now.getTime() - 60 * DAY
  })
  let headline: Dashboard['headline']
  if (all.length === 0) {
    headline = { kind: 'empty', average: null, change: null, attemptsInWindow: 0, daysSinceLast: null }
  } else if (last30.length > 0) {
    const avg = mean(last30.map((p) => p.percentage)) ?? 0
    const prevAvg = mean(prev30.map((p) => p.percentage))
    headline = {
      kind: prevAvg === null ? 'recent' : 'recent-with-change',
      average: round1(avg),
      change: prevAvg === null ? null : round1(avg - prevAvg),
      attemptsInWindow: last30.length,
      daysSinceLast: Math.floor((now.getTime() - new Date(all[all.length - 1].submittedAt).getTime()) / DAY)
    }
  } else {
    headline = {
      kind: 'stale',
      average: round1(mean(all.map((p) => p.percentage))),
      change: null,
      attemptsInWindow: 0,
      daysSinceLast: Math.floor((now.getTime() - new Date(all[all.length - 1].submittedAt).getTime()) / DAY)
    }
  }

  const recent = (
    db
      .prepare(`${ATTEMPT_SELECT} WHERE a.status = 'submitted' AND ${VISIBLE} ORDER BY a.submitted_at DESC LIMIT 8`)
      .all() as RawAttemptRow[]
  ).map(mapAttempt)

  const totals = db
    .prepare(
      `SELECT COUNT(DISTINCT a.id) AS attempts,
              COALESCE(SUM(CASE WHEN r.selected_option_ids_json <> '[]' THEN 1 ELSE 0 END), 0) AS answered
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id
       LEFT JOIN responses r ON r.attempt_id = a.id
       WHERE ${OFFICIAL} AND ${VISIBLE}`
    )
    .get() as { attempts: number; answered: number }
  // Time studied includes practice runs and unfinished attempts: it is time spent revising.
  const seconds = db
    .prepare(
      `SELECT COALESCE(SUM(a.duration_seconds), 0) FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
       JOIN modules m ON m.id = q.module_id WHERE ${VISIBLE}`
    )
    .pluck()
    .get() as number

  const hasAnyQuiz = ((db.prepare('SELECT COUNT(*) FROM quizzes WHERE archived_at IS NULL').pluck().get() as number) ?? 0) > 0
  const hasAnyModule =
    ((db.prepare('SELECT COUNT(*) FROM modules WHERE archived_at IS NULL').pluck().get() as number) ?? 0) > 0

  return {
    headline,
    series: series(db, moduleId, rangeStart(range, now)),
    inProgress: inProgress(db),
    modules: listModules(db, false),
    missed: missedQuestions(db, null, 5),
    topics: topicStats(db, null).slice(0, 5),
    recent,
    totals: { attempts: totals.attempts, questionsAnswered: totals.answered, secondsStudied: Math.round(seconds) },
    hasAnyQuiz,
    hasAnyModule
  }
}

export function moduleDetail(db: DB, id: number): ModuleDetail {
  const module = getModule(db, id)
  const quizzes = listQuizzes(db, id, true)
  const attempts = (
    db
      .prepare(`${ATTEMPT_SELECT} WHERE m.id = ? AND a.status = 'submitted' ORDER BY a.submitted_at DESC LIMIT 50`)
      .all(id) as RawAttemptRow[]
  ).map(mapAttempt)
  const weakestQuizzes = quizzes
    .filter((q) => q.archivedAt === null && q.average !== null)
    .sort((a, b) => (a.average ?? 0) - (b.average ?? 0))
    .slice(0, 3)
  // Series and question statistics for an archived module are still shown on its own page.
  const seriesRows = db
    .prepare(
      `SELECT a.id, a.submitted_at, a.percentage, a.attempt_number, q.title
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
       WHERE q.module_id = ? AND q.archived_at IS NULL AND ${OFFICIAL} ORDER BY a.submitted_at`
    )
    .all(id) as { id: number; submitted_at: string; percentage: number; attempt_number: number; title: string }[]
  return {
    module,
    quizzes,
    series: seriesRows.map((r) => ({
      attemptId: r.id,
      submittedAt: r.submitted_at,
      percentage: r.percentage,
      quizTitle: r.title,
      moduleId: module.id,
      moduleName: module.name,
      moduleColour: module.colour,
      attemptNumber: r.attempt_number
    })),
    attempts,
    weakestQuizzes,
    topics: module.archivedAt ? [] : topicStats(db, id).slice(0, 8),
    missed: module.archivedAt ? [] : missedQuestions(db, id, 8)
  }
}

export function history(db: DB, f: HistoryFilter): AttemptListRow[] {
  const rows = db
    .prepare(
      `${ATTEMPT_SELECT}
       WHERE a.status = 'submitted'
         AND (@includePractice = 1 OR a.is_practice = 0)
         AND (@moduleId IS NULL OR m.id = @moduleId)
         AND (@moduleId IS NOT NULL OR m.archived_at IS NULL)
         AND (@quizId IS NULL OR q.id = @quizId)
         AND (@from IS NULL OR a.submitted_at >= @from)
         AND (@to IS NULL OR a.submitted_at < @to)
         AND (@minScore IS NULL OR a.percentage >= @minScore)
         AND (@maxScore IS NULL OR a.percentage <= @maxScore)
       ORDER BY a.submitted_at DESC`
    )
    .all({
      includePractice: f.includePractice ? 1 : 0,
      moduleId: f.moduleId,
      quizId: f.quizId,
      from: f.from,
      to: f.to,
      minScore: f.minScore,
      maxScore: f.maxScore
    }) as RawAttemptRow[]
  return rows.map(mapAttempt)
}

/** Quizzes available as filter options in History, including archived ones. */
export function quizOptions(db: DB): { id: number; title: string; moduleId: number }[] {
  return db
    .prepare('SELECT id, title, module_id AS moduleId FROM quizzes ORDER BY title COLLATE NOCASE')
    .all() as { id: number; title: string; moduleId: number }[]
}
