import { describe, expect, it } from 'vitest'
import { markQuestion, percentage, shuffle } from '../../src/main/marking'

describe('strict marking', () => {
  it('gives full marks only for the exact selection', () => {
    expect(markQuestion([1], [1], 1, 'strict')).toEqual({ marksAwarded: 1, isCorrect: true })
    expect(markQuestion([1], [2], 1, 'strict')).toEqual({ marksAwarded: 0, isCorrect: false })
    expect(markQuestion([1, 3, 5], [1, 3, 5], 2, 'strict')).toEqual({ marksAwarded: 2, isCorrect: true })
    expect(markQuestion([1, 3, 5], [1, 3], 2, 'strict').marksAwarded).toBe(0)
    expect(markQuestion([1, 3, 5], [1, 3, 5, 2], 2, 'strict').marksAwarded).toBe(0)
  })

  it('scores an unanswered question as zero', () => {
    expect(markQuestion([1], [], 3, 'strict')).toEqual({ marksAwarded: 0, isCorrect: false })
  })

  it('ignores selection order and duplicates', () => {
    expect(markQuestion([1, 3], [3, 1, 3], 1, 'strict').isCorrect).toBe(true)
  })
})

describe('partial marking', () => {
  // max(0, (correct selected - incorrect selected) / total correct) × marks
  it('follows the formula', () => {
    expect(markQuestion([1, 3, 5], [1, 3, 5], 3, 'partial')).toEqual({ marksAwarded: 3, isCorrect: true })
    expect(markQuestion([1, 3, 5], [1, 3], 3, 'partial').marksAwarded).toBe(2)
    expect(markQuestion([1, 3, 5], [1, 3, 2], 3, 'partial').marksAwarded).toBe(1)
    expect(markQuestion([1, 3, 5], [1], 2, 'partial').marksAwarded).toBeCloseTo(0.6667, 4)
    expect(markQuestion([1, 3], [1, 2], 2, 'partial').marksAwarded).toBe(0)
  })

  it('never goes below zero', () => {
    expect(markQuestion([1], [2, 3, 4], 2, 'partial').marksAwarded).toBe(0)
  })

  it('marks only an exact selection as correct', () => {
    expect(markQuestion([1, 3, 5], [1, 3], 3, 'partial').isCorrect).toBe(false)
  })

  it('reduces to strict marking for single-answer questions', () => {
    expect(markQuestion([2], [2], 1, 'partial').marksAwarded).toBe(1)
    expect(markQuestion([2], [1], 1, 'partial').marksAwarded).toBe(0)
  })

  it('handles all five options correct', () => {
    expect(markQuestion([1, 2, 3, 4, 5], [1, 2, 3, 4], 5, 'partial').marksAwarded).toBe(4)
  })
})

describe('helpers', () => {
  it('computes percentages to one decimal place', () => {
    expect(percentage(2, 3)).toBe(66.7)
    expect(percentage(0, 0)).toBe(0)
    expect(percentage(13, 13)).toBe(100)
  })

  it('shuffles without losing items and is deterministic with a seeded source', () => {
    let seed = 42
    const rand = (): number => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    const out = shuffle([1, 2, 3, 4, 5, 6], rand)
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6])
    expect(out).not.toEqual([1, 2, 3, 4, 5, 6])
  })
})
