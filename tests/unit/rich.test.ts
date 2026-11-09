import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/renderer/src/lib/rich'

describe('rich text tokenizer', () => {
  it('splits inline and display maths and code', () => {
    expect(tokenize('If $x^2$ then `f(x)` and $$\\sum_i i$$.')).toEqual([
      { kind: 'text', value: 'If ' },
      { kind: 'math', value: 'x^2', display: false },
      { kind: 'text', value: ' then ' },
      { kind: 'code', value: 'f(x)' },
      { kind: 'text', value: ' and ' },
      { kind: 'math', value: '\\sum_i i', display: true },
      { kind: 'text', value: '.' }
    ])
  })

  it('keeps unmatched delimiters and escaped dollars as text', () => {
    expect(tokenize('costs $5')).toEqual([{ kind: 'text', value: 'costs $5' }])
    expect(tokenize('a \\$ b')).toEqual([{ kind: 'text', value: 'a $ b' }])
    expect(tokenize('one ` tick')).toEqual([{ kind: 'text', value: 'one ` tick' }])
  })

  it('treats HTML as plain text', () => {
    expect(tokenize('<script>alert(1)</script>')).toEqual([{ kind: 'text', value: '<script>alert(1)</script>' }])
  })

  it('handles an escaped dollar inside maths', () => {
    expect(tokenize('$a \\$ b$')).toEqual([{ kind: 'math', value: 'a \\$ b', display: false }])
  })
})
