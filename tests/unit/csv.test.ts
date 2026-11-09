import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from '../../src/main/csv/parse'
import { normaliseForHash, suggestTitle, validateQuizCsv } from '../../src/main/csv/validate'
import { csv, readSample } from './helpers'

const HEADER = 'question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic'
const row = (over: Partial<Record<string, string>> = {}): string[] => {
  const base: Record<string, string> = {
    question: 'Q?',
    option_a: 'a',
    option_b: 'b',
    option_c: 'c',
    option_d: 'd',
    option_e: 'e',
    type: 'single',
    correct: 'A',
    marks: '1',
    explanation: '',
    topic: ''
  }
  const merged = { ...base, ...over }
  return HEADER.split(',').map((h) => merged[h] ?? '')
}
const errorsFor = (text: string) => validateQuizCsv(text).errors

describe('parseCsv', () => {
  it('parses simple records and strips a BOM', () => {
    const r = parseCsv('﻿a,b\r\n1,2\r\n')
    expect(r.error).toBeNull()
    expect(r.records.map((x) => x.fields)).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('handles quoted commas, doubled quotes and multi-line fields', () => {
    const r = parseCsv('a,b\n"x, y","he said ""hi"""\n"line 1\nline 2",z\n')
    expect(r.records[1].fields).toEqual(['x, y', 'he said "hi"'])
    expect(r.records[2].fields).toEqual(['line 1\nline 2', 'z'])
    expect(r.records[2].line).toBe(3)
  })

  it('normalises CRLF inside quoted fields and handles a lone CR', () => {
    const r = parseCsv('a\r"x\r\ny"\r')
    expect(r.records.map((x) => x.fields[0])).toEqual(['a', 'x\ny'])
  })

  it('skips blank lines and keeps empty fields', () => {
    const r = parseCsv('a,b,c\n\n1,,3\n\n')
    expect(r.records.map((x) => x.fields)).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3']
    ])
  })

  it('reports an unclosed quote with its starting line', () => {
    const r = parseCsv('a,b\n1,"never closed\n2,3')
    expect(r.error?.line).toBe(2)
  })

  it('reports text after a closing quote', () => {
    expect(parseCsv('"a"b,c').error).not.toBeNull()
  })

  it('round-trips through toCsv', () => {
    const rows = [['a,b', 'c"d', 'e\nf', ' lead']]
    const back = parseCsv(toCsv(rows)).records[0].fields
    expect(back).toEqual(rows[0])
  })
})

describe('validateQuizCsv', () => {
  it('accepts the shipped template and example quiz', () => {
    const t = validateQuizCsv(readSample('template.csv'))
    expect(t.errors).toEqual([])
    expect(t.questions).toHaveLength(2)
    expect(t.questions[1]).toMatchObject({ type: 'multi', marks: 2, topic: 'Propositional logic' })
    expect(t.questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(['A', 'C', 'E'])

    const e = validateQuizCsv(readSample('example_quiz.csv'))
    expect(e.errors).toEqual([])
    expect(e.questions).toHaveLength(12)
    expect(e.questions.some((q) => q.type === 'single')).toBe(true)
    expect(e.questions.some((q) => q.type === 'multi')).toBe(true)
  })

  it('accepts CRLF and a BOM', () => {
    const text = '﻿' + readSample('template.csv').replace(/\n/g, '\r\n')
    expect(validateQuizCsv(text).ok).toBe(true)
  })

  it('accepts only the required columns, in any order, with any header case', () => {
    const text = 'TYPE,Correct,question,option_e,option_d,option_c,option_b,option_a\nsingle,b,Q?,e,d,c,b,a\n'
    const v = validateQuizCsv(text)
    expect(v.errors).toEqual([])
    expect(v.questions[0].options.find((o) => o.isCorrect)?.text).toBe('b')
    expect(v.questions[0].marks).toBe(1)
    expect(v.questions[0].topic).toBeNull()
  })

  it('rejects an empty file and a header-only file', () => {
    expect(errorsFor('')[0].message).toMatch(/empty/)
    expect(errorsFor(HEADER)[0].message).toMatch(/no questions/)
  })

  it('reports each missing required column', () => {
    const errs = errorsFor('question,option_a,option_b\nQ,a,b')
    const cols = errs.map((e) => e.column)
    expect(cols).toEqual(expect.arrayContaining(['option_c', 'option_d', 'option_e', 'type', 'correct']))
    expect(errs.every((e) => e.row === 1)).toBe(true)
  })

  it('rejects unknown and duplicate columns with a suggestion', () => {
    const errs = errorsFor(`${HEADER},explaination\n${row().join(',')},x`)
    expect(errs[0].column).toBe('explaination')
    expect(errs[0].fix).toMatch(/explanation/)
    const dup = errorsFor(`${HEADER},topic\n${row().join(',')},x`)
    expect(dup[0].message).toMatch(/more than once/)
  })

  it('reports rows with too many or too few fields', () => {
    const many = errorsFor(csv([[...row(), 'extra']]))
    expect(many[0]).toMatchObject({ row: 2 })
    expect(many[0].fix).toMatch(/comma/)
    const few = errorsFor(csv([row().slice(0, 5)]))
    expect(few[0].row).toBe(2)
  })

  it('requires question text', () => {
    expect(errorsFor(csv([row({ question: '' })]))[0]).toMatchObject({ row: 2, column: 'question' })
  })

  it('requires all five options to be present', () => {
    const errs = errorsFor(csv([row({ option_c: '', option_e: '  ' })]))
    expect(errs.map((e) => e.column)).toEqual(['option_c', 'option_e'])
  })

  it('requires options to be distinct (case and spacing insensitive)', () => {
    const errs = errorsFor(csv([row({ option_d: ' B ' })]))
    expect(errs[0]).toMatchObject({ row: 2, column: 'option_d' })
    expect(errs[0].message).toMatch(/same as option B/)
  })

  it('validates the type column', () => {
    expect(errorsFor(csv([row({ type: '' })]))[0].column).toBe('type')
    expect(errorsFor(csv([row({ type: 'multiple' })]))[0].message).toMatch(/not a valid type/)
    expect(validateQuizCsv(csv([row({ type: ' Multi ', correct: 'a' })])).ok).toBe(true)
  })

  it('parses correct letters case-insensitively and validates them', () => {
    const ok = validateQuizCsv(csv([row({ type: 'multi', correct: 'a; c ;E' })]))
    expect(ok.ok).toBe(true)
    expect(ok.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(['A', 'C', 'E'])

    expect(errorsFor(csv([row({ correct: '' })]))[0].column).toBe('correct')
    expect(errorsFor(csv([row({ correct: 'F' })]))[0].message).toMatch(/not an option letter/)
    expect(errorsFor(csv([row({ type: 'multi', correct: 'A;A' })]))[0].message).toMatch(/twice/)
    expect(errorsFor(csv([row({ type: 'multi', correct: 'A;;C' })]))[0].message).toMatch(/empty entry/)
    expect(errorsFor(csv([row({ type: 'multi', correct: '"A,C"' })]))[0].fix).toMatch(/semicolons/)
  })

  it('requires exactly one correct letter for single questions', () => {
    const e = errorsFor(csv([row({ type: 'single', correct: 'A;B' })]))
    expect(e[0].message).toMatch(/exactly one/)
    expect(e[0].fix).toMatch(/multi/)
  })

  it('allows a multi question with one or all five correct letters', () => {
    expect(validateQuizCsv(csv([row({ type: 'multi', correct: 'D' })])).ok).toBe(true)
    expect(validateQuizCsv(csv([row({ type: 'multi', correct: 'A;B;C;D;E' })])).ok).toBe(true)
  })

  it('validates marks and defaults them to 1', () => {
    expect(validateQuizCsv(csv([row({ marks: '' })])).questions[0].marks).toBe(1)
    expect(validateQuizCsv(csv([row({ marks: '2.5' })])).questions[0].marks).toBe(2.5)
    for (const bad of ['0', '-1', 'two', '1e3', 'NaN']) {
      expect(errorsFor(csv([row({ marks: bad })]))[0].column).toBe('marks')
    }
  })

  it('reports every error with its spreadsheet row, even with multi-line fields above', () => {
    const text = csv([
      row({ question: '"A question\nover two lines"' }),
      row({ type: 'bogus' }),
      row({ option_a: '' })
    ])
    const errs = errorsFor(text)
    expect(errs.map((e) => e.row)).toEqual([3, 4])
    expect(errs.every((e) => e.fix.length > 10)).toBe(true)
  })

  it('saves nothing partial: an invalid file yields no questions', () => {
    const v = validateQuizCsv(csv([row(), row({ correct: 'Z' })]))
    expect(v.ok).toBe(false)
    expect(v.questions).toEqual([])
  })

  it('keeps HTML as plain text for the renderer to escape', () => {
    const v = validateQuizCsv(csv([row({ question: '<img src=x onerror=alert(1)>' })]))
    expect(v.ok).toBe(true)
    expect(v.questions[0].prompt).toBe('<img src=x onerror=alert(1)>')
  })

  it('rejects binary content', () => {
    expect(errorsFor('abc\u0000def')[0].message).toMatch(/binary/)
  })

  it('caps the number of questions', () => {
    const rows = Array.from({ length: 501 }, (_, i) => row({ question: `Q${i}` }))
    expect(errorsFor(csv(rows))[0].message).toMatch(/limit is 500/)
  })
})

describe('helpers', () => {
  it('suggests a title from the file name', () => {
    expect(suggestTitle('week_3-logic.csv')).toBe('Week 3 logic')
    expect(suggestTitle('.csv')).toBe('Untitled quiz')
  })

  it('normalises text for hashing', () => {
    expect(normaliseForHash('﻿a\r\nb\r\n')).toBe(normaliseForHash('a\nb'))
  })
})
