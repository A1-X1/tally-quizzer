import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDatabase, type DB } from '../../src/main/db/connection'
import { createModule } from '../../src/main/services/modules'
import { commitImport } from '../../src/main/services/quizzes'

export const SAMPLES = path.resolve(__dirname, '../../samples')
export const readSample = (name: string): string => fs.readFileSync(path.join(SAMPLES, name), 'utf8')

export function tmpDir(prefix = 'tally-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function freshDb(): { db: DB; dir: string; file: string } {
  const dir = tmpDir()
  const file = path.join(dir, 'userdata.sqlite')
  return { db: createDatabase(file), dir, file }
}

export function seedQuiz(db: DB, csv = readSample('example_quiz.csv'), title = 'Logic') {
  const m = createModule(db, { name: `Module ${Math.random().toString(36).slice(2, 7)}`, code: null, colour: 'cobalt', description: null })
  const r = commitImport(db, { moduleId: m.id, filename: 'quiz.csv', text: csv, title, mode: 'new', targetQuizId: null })
  return { moduleId: m.id, quizId: r.quizId }
}

/** Build a CSV from rows of the standard columns. */
export function csv(rows: string[][], header = 'question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic'): string {
  return [header, ...rows.map((r) => r.join(','))].join('\n')
}
