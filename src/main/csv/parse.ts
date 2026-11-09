/**
 * A small RFC 4180 CSV reader.
 *
 * Handles a UTF-8 BOM, LF / CRLF / CR line endings, quoted fields containing
 * commas, doubled quotes and line breaks. Each record carries the 1-based line
 * on which it starts so errors can point at the right place in a spreadsheet.
 */

export interface CsvRecord {
  /** 1-based physical line where the record starts. */
  line: number
  fields: string[]
}

export interface CsvParseResult {
  records: CsvRecord[]
  error: { line: number; message: string } | null
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function parseCsv(input: string): CsvParseResult {
  const text = stripBom(input)
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false
  let quotedField = false
  let line = 1
  let recordLine = 1
  let quoteStartLine = 1
  let i = 0
  const n = text.length

  const endField = (): void => {
    fields.push(field)
    field = ''
    quotedField = false
  }
  const endRecord = (): void => {
    endField()
    // Skip records that are completely empty (blank lines).
    if (!(fields.length === 1 && fields[0] === '')) {
      records.push({ line: recordLine, fields })
    }
    fields = []
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      if (ch === '\r') {
        // Normalise CRLF / CR inside quoted fields to LF.
        field += '\n'
        if (text[i + 1] === '\n') i++
        i++
        line++
        continue
      }
      if (ch === '\n') line++
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      if (field.trim() === '' && !quotedField) {
        // Opening quote. Leading spaces before a quote are discarded.
        field = ''
        inQuotes = true
        quotedField = true
        quoteStartLine = line
        i++
        continue
      }
      // A stray quote in the middle of an unquoted field: keep it literally.
      field += ch
      i++
      continue
    }
    if (ch === ',') {
      endField()
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      endRecord()
      if (ch === '\r' && text[i + 1] === '\n') i++
      i++
      line++
      recordLine = line
      continue
    }
    if (quotedField) {
      // Characters after a closing quote, e.g. "abc"def. Allow trailing spaces only.
      if (ch === ' ' || ch === '\t') {
        i++
        continue
      }
      return {
        records,
        error: {
          line,
          message: 'Unexpected text after a closing double quote.'
        }
      }
    }
    field += ch
    i++
  }

  if (inQuotes) {
    return {
      records,
      error: {
        line: quoteStartLine,
        message: 'A quoted field is never closed.'
      }
    }
  }
  if (field !== '' || fields.length > 0 || quotedField) endRecord()
  return { records, error: null }
}

/** Escape a value for CSV output. */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}
