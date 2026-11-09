import { MAX_QUESTIONS } from '../../shared/api'
import {
  OPTION_LABELS,
  type CsvIssue,
  type MarkPoint,
  type OptionLabel,
  type ParsedQuestion,
  type QuestionType
} from '../../shared/types'
import { parseCsv } from './parse'

export const REQUIRED_COLUMNS = [
  'question',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'option_e',
  'type',
  'correct'
] as const
export const OPTIONAL_COLUMNS = ['marks', 'explanation', 'topic', 'model_answer', 'mark_scheme'] as const
const KNOWN = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS])
const OPTION_COLUMNS = ['option_a', 'option_b', 'option_c', 'option_d', 'option_e'] as const

export const MAX_FIELD_LENGTH = 4000
export const MAX_ERRORS = 200

export interface QuizValidation {
  ok: boolean
  errors: CsvIssue[]
  questions: ParsedQuestion[]
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
  }
  return dp[a.length][b.length]
}

function closestColumn(name: string): string | null {
  let best: string | null = null
  let bestScore = Infinity
  for (const k of KNOWN) {
    const d = levenshtein(name, k)
    if (d < bestScore) {
      bestScore = d
      best = k
    }
  }
  return bestScore <= 3 ? best : null
}

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * Validate a whole quiz CSV without saving anything.
 * Collects every error it can find rather than stopping at the first.
 */
export function validateQuizCsv(text: string): QuizValidation {
  const errors: CsvIssue[] = []
  const add = (issue: CsvIssue): void => {
    if (errors.length < MAX_ERRORS) errors.push(issue)
  }

  if (text.includes('\u0000')) {
    add({
      row: null,
      column: null,
      message: 'This file contains binary data, not text.',
      fix: 'Save the quiz from your spreadsheet as "CSV UTF-8 (comma delimited)" and import that file.'
    })
    return { ok: false, errors, questions: [] }
  }

  const parsed = parseCsv(text)
  if (parsed.error) {
    // Translate the physical line into a spreadsheet row if possible.
    const rowIndex = parsed.records.length + 1
    add({
      row: rowIndex,
      column: null,
      message: `${parsed.error.message} (starts on line ${parsed.error.line} of the file)`,
      fix: 'Make sure every field that starts with a double quote also ends with one, and write a literal quote inside a quoted field as two quotes ("").'
    })
    return { ok: false, errors, questions: [] }
  }

  const records = parsed.records
  if (records.length === 0) {
    add({
      row: null,
      column: null,
      message: 'The file is empty.',
      fix: 'Start from the template in Help and add at least one question below the header row.'
    })
    return { ok: false, errors, questions: [] }
  }

  // ----- Header -----
  const header = records[0].fields.map(normaliseHeader)
  const index = new Map<string, number>()
  header.forEach((h, i) => {
    if (h === '') {
      add({
        row: 1,
        column: `column ${i + 1}`,
        message: `Header cell ${i + 1} is blank.`,
        fix: 'Give every column a header, or delete the empty column.'
      })
      return
    }
    if (index.has(h)) {
      add({
        row: 1,
        column: h,
        message: `The column "${h}" appears more than once.`,
        fix: `Keep one "${h}" column and delete the other.`
      })
      return
    }
    if (!KNOWN.has(h)) {
      const near = closestColumn(h)
      add({
        row: 1,
        column: h,
        message: `"${h}" is not a column Tally understands.`,
        fix: near
          ? `Did you mean "${near}"? Rename the header, or delete the column.`
          : `Delete this column. Allowed columns are: ${[...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(', ')}.`
      })
    }
    index.set(h, i)
  })
  const missing = REQUIRED_COLUMNS.filter((c) => !index.has(c))
  for (const m of missing) {
    add({
      row: 1,
      column: m,
      message: `The required column "${m}" is missing.`,
      fix: `Add a "${m}" column. The header row must contain: ${REQUIRED_COLUMNS.join(',')}.`
    })
  }
  if (missing.length > 0 || errors.length > 0) {
    return { ok: false, errors, questions: [] }
  }

  const get = (fields: string[], col: string): string => {
    const i = index.get(col)
    return i === undefined ? '' : (fields[i] ?? '').trim()
  }

  // ----- Rows -----
  const questions: ParsedQuestion[] = []
  const dataRecords = records.slice(1)
  if (dataRecords.length === 0) {
    add({
      row: null,
      column: null,
      message: 'The file has a header but no questions.',
      fix: 'Add one question per row below the header.'
    })
  }
  if (dataRecords.length > MAX_QUESTIONS) {
    add({
      row: null,
      column: null,
      message: `The file has ${dataRecords.length} questions; the limit is ${MAX_QUESTIONS}.`,
      fix: 'Split the questions into several smaller quizzes.'
    })
    return { ok: false, errors, questions: [] }
  }

  dataRecords.forEach((rec, idx) => {
    const row = idx + 2
    const f = rec.fields
    let rowOk = true
    const err = (column: string | null, message: string, fix: string): void => {
      rowOk = false
      add({ row, column, message, fix })
    }

    if (f.length > header.length) {
      const extra = f.slice(header.length).some((v) => v.trim() !== '')
      if (extra) {
        err(
          null,
          `This row has ${f.length} fields but the header has ${header.length}.`,
          'A value probably contains an unquoted comma. Wrap any text that contains a comma in double quotes.'
        )
        return
      }
    } else if (f.length < header.length) {
      err(
        null,
        `This row has ${f.length} fields but the header has ${header.length}.`,
        'Fill in every column for this question, leaving optional ones empty with consecutive commas.'
      )
      return
    }

    for (const col of header) {
      const v = get(f, col)
      if (v.length > MAX_FIELD_LENGTH) {
        err(col, `This value is ${v.length} characters long.`, `Shorten it to at most ${MAX_FIELD_LENGTH} characters.`)
      }
    }

    const prompt = get(f, 'question')
    if (prompt === '') err('question', 'The question text is empty.', 'Write the question in the "question" column.')

    const typeRaw = get(f, 'type').toLowerCase()
    let type: QuestionType | null = null
    if (typeRaw === 'single' || typeRaw === 'multi' || typeRaw === 'written') type = typeRaw
    else if (typeRaw === '') err('type', 'The type is empty.', 'Write "single" (one answer), "multi" (several answers) or "written" (a typed answer).')
    else err('type', `"${get(f, 'type')}" is not a valid type.`, 'Use "single", "multi" or "written".')

    const optionTexts = OPTION_COLUMNS.map((c) => get(f, c))
    const marksRaw = index.has('marks') ? get(f, 'marks') : ''
    let marks: number | null = null
    if (marksRaw !== '') {
      const v = Number(marksRaw)
      if (!/^\d*\.?\d+$/.test(marksRaw) || !Number.isFinite(v) || v <= 0) {
        err('marks', `"${marksRaw}" is not a positive number.`, 'Use a number greater than 0, such as 1 or 2.5, or leave it empty.')
      } else if (v > 1000) {
        err('marks', `${marksRaw} marks is more than the limit of 1000.`, 'Use a smaller number of marks.')
      } else {
        marks = v
      }
    }
    const explanation = index.has('explanation') ? get(f, 'explanation') || null : null
    const topic = index.has('topic') ? get(f, 'topic') || null : null

    // ----- Written questions -----
    if (type === 'written') {
      const filled = OPTION_COLUMNS.filter((_, i) => optionTexts[i] !== '')
      if (filled.length > 0) {
        err(filled[0], 'Written questions do not have options.', 'Leave option_a to option_e empty for a written question, or change its type to "single" or "multi".')
      }
      if (get(f, 'correct') !== '') {
        err('correct', 'Written questions do not use the "correct" column.', 'Leave "correct" empty and put the expected answer in "model_answer" and the marking points in "mark_scheme".')
      }
      const modelAnswer = index.has('model_answer') ? get(f, 'model_answer') : ''
      if (!index.has('model_answer') || modelAnswer === '') {
        err('model_answer', 'A written question needs a model answer.', 'Add a "model_answer" column with a full-mark answer, written as a student should.')
      }
      const schemeRaw = index.has('mark_scheme') ? get(f, 'mark_scheme') : ''
      const scheme = parseMarkScheme(schemeRaw)
      if (!index.has('mark_scheme') || schemeRaw === '') {
        err('mark_scheme', 'A written question needs a mark scheme.', 'Add a "mark_scheme" column listing each creditworthy point with its marks, for example: [2] Names the mitochondrion; [1] Mentions ATP.')
      } else if (!scheme.ok) {
        err('mark_scheme', scheme.error, 'Write each point as [marks] description, separated by semicolons: [2] First point; [1] Second point.')
      } else if (marks !== null) {
        const total = scheme.points.reduce((a, b) => a + b.marks, 0)
        if (Math.abs(total - marks) > 1e-9) {
          err('marks', `The marks (${marks}) do not match the mark scheme total (${total}).`, 'Make "marks" equal the sum of the points in "mark_scheme", or leave "marks" empty.')
        }
      }
      if (rowOk && scheme.ok) {
        questions.push({
          row,
          prompt,
          type,
          marks: marks ?? scheme.points.reduce((a, b) => a + b.marks, 0),
          explanation,
          topic,
          modelAnswer,
          markScheme: scheme.points,
          options: []
        })
      }
      return
    }

    // ----- Choice questions -----
    OPTION_COLUMNS.forEach((c, i) => {
      if (optionTexts[i] === '') {
        err(
          c,
          `Option ${OPTION_LABELS[i]} is empty.`,
          'Every multiple-choice question needs exactly five non-empty options. Add a plausible distractor.'
        )
      }
    })
    const seen = new Map<string, number>()
    optionTexts.forEach((t, i) => {
      if (t === '') return
      const key = t.toLowerCase().replace(/\s+/g, ' ')
      const prev = seen.get(key)
      if (prev !== undefined) {
        err(
          OPTION_COLUMNS[i],
          `Option ${OPTION_LABELS[i]} is the same as option ${OPTION_LABELS[prev]} ("${t}").`,
          'Options within a question must be distinct. Replace one of them.'
        )
      } else {
        seen.set(key, i)
      }
    })

    const correctRaw = get(f, 'correct')
    const letters: OptionLabel[] = []
    let correctOk = true
    if (correctRaw === '') {
      correctOk = false
      err('correct', 'No correct answer is given.', 'Write the letter of the correct option, for example C, or A;C;E for several.')
    } else {
      if (/[,|/]/.test(correctRaw) || /[a-e]\s+[a-e]/i.test(correctRaw)) {
        correctOk = false
        err('correct', `"${correctRaw}" uses the wrong separator.`, 'Separate several letters with semicolons, for example A;C;E.')
      } else {
        const parts = correctRaw.split(';').map((p) => p.trim().toUpperCase())
        for (const p of parts) {
          if (p === '') {
            correctOk = false
            err('correct', `"${correctRaw}" has an empty entry.`, 'Remove the extra semicolon, for example A;C rather than A;;C.')
            break
          }
          if (!(OPTION_LABELS as readonly string[]).includes(p)) {
            correctOk = false
            err('correct', `"${p}" is not an option letter.`, 'Use only the letters A, B, C, D and E.')
            continue
          }
          if (letters.includes(p as OptionLabel)) {
            correctOk = false
            err('correct', `The letter ${p} is listed twice.`, 'List each correct letter once.')
            continue
          }
          letters.push(p as OptionLabel)
        }
      }
      if (correctOk && type === 'single' && letters.length !== 1) {
        err(
          'correct',
          `A single-answer question must have exactly one correct letter, but this one has ${letters.length} (${letters.join(';')}).`,
          'Keep one letter, or change the type to "multi".'
        )
      }
    }

    if (rowOk && type) {
      questions.push({
        row,
        prompt,
        type,
        marks: marks ?? 1,
        explanation,
        topic,
        options: OPTION_LABELS.map((label, i) => ({
          label,
          text: optionTexts[i],
          isCorrect: letters.includes(label)
        }))
      })
    }
  })

  if (errors.length >= MAX_ERRORS) {
    errors[MAX_ERRORS - 1] = {
      row: null,
      column: null,
      message: `There are more than ${MAX_ERRORS} problems; only the first ${MAX_ERRORS - 1} are shown.`,
      fix: 'Check that the file is a Tally quiz CSV and that its header row matches the template.'
    }
  }

  return { ok: errors.length === 0, errors, questions: errors.length === 0 ? questions : [] }
}

/**
 * Parse a mark scheme written as "[2] First point; [1] Second point".
 * Semicolons inside a point are allowed as long as the next point starts with [n].
 */
export function parseMarkScheme(raw: string): { ok: true; points: MarkPoint[] } | { ok: false; error: string } {
  const text = raw.trim()
  if (!text) return { ok: false, error: 'The mark scheme is empty.' }
  if (!text.startsWith('[')) return { ok: false, error: 'The mark scheme must start with the marks for the first point, such as [1].' }
  const points: MarkPoint[] = []
  const re = /\[\s*(\d+(?:\.\d+)?)\s*(?:marks?)?\s*\]\s*([\s\S]*?)(?=\s*;?\s*\[\s*\d+(?:\.\d+)?\s*(?:marks?)?\s*\]|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const marks = Number(m[1])
    const desc = m[2].replace(/;\s*$/, '').trim()
    if (!desc) return { ok: false, error: `Point ${points.length + 1} has marks but no description.` }
    if (!(marks > 0)) return { ok: false, error: `Point ${points.length + 1} must be worth more than 0 marks.` }
    points.push({ text: desc, marks })
    if (points.length > 20) return { ok: false, error: 'The mark scheme has more than 20 points.' }
  }
  if (points.length === 0) return { ok: false, error: 'No marking points were found.' }
  return { ok: true, points }
}

export function formatMarkScheme(points: MarkPoint[]): string {
  return points.map((p) => `[${p.marks}] ${p.text.replace(/\s+/g, ' ').trim()}`).join('; ')
}

export function suggestTitle(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!base) return 'Untitled quiz'
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** Text normalised for hashing so that line-ending or BOM differences do not create a new version. */
export function normaliseForHash(text: string): string {
  let t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  t = t.replace(/\r\n?/g, '\n')
  return t.replace(/\n+$/, '')
}
