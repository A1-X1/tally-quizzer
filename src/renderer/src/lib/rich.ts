export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'math'; value: string; display: boolean }

/**
 * Split quiz text into plain text, `code` and $maths$ / $$display maths$$.
 * An unmatched delimiter is kept as literal text; \$ is a literal dollar sign.
 */
export function tokenize(input: string): Segment[] {
  const out: Segment[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) out.push({ kind: 'text', value: buf })
    buf = ''
  }
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (ch === '\\' && input[i + 1] === '$') {
      buf += '$'
      i += 2
      continue
    }
    if (ch === '`') {
      const end = input.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ kind: 'code', value: input.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (ch === '$') {
      const display = input[i + 1] === '$'
      const open = display ? 2 : 1
      const close = display ? '$$' : '$'
      let j = i + open
      let end = -1
      while (j < input.length) {
        if (input[j] === '\\') {
          j += 2
          continue
        }
        if (input.startsWith(close, j)) {
          end = j
          break
        }
        j++
      }
      const body = end >= 0 ? input.slice(i + open, end) : ''
      if (end >= 0 && body.trim() !== '') {
        flush()
        out.push({ kind: 'math', value: body, display })
        i = end + close.length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}
