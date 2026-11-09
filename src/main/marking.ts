import type { MarkingMode } from '../shared/types'

export interface MarkOutcome {
  marksAwarded: number
  isCorrect: boolean
}

const round = (n: number): number => Math.round(n * 10000) / 10000

/**
 * Mark one question.
 *
 * strict  – full marks only for exactly the correct set of options.
 * partial – max(0, (correct selected − incorrect selected) / total correct) × marks.
 *
 * `isCorrect` is true only when the selection is exactly right, in either mode.
 */
export function markQuestion(
  correctIds: readonly number[],
  selectedIds: readonly number[],
  marks: number,
  mode: MarkingMode
): MarkOutcome {
  const correct = new Set(correctIds)
  const selected = new Set(selectedIds)
  let hits = 0
  let misses = 0
  for (const id of selected) {
    if (correct.has(id)) hits++
    else misses++
  }
  const exact = hits === correct.size && misses === 0 && correct.size > 0
  if (mode === 'strict') {
    return { marksAwarded: exact ? marks : 0, isCorrect: exact }
  }
  if (correct.size === 0) return { marksAwarded: 0, isCorrect: false }
  const fraction = Math.max(0, (hits - misses) / correct.size)
  return { marksAwarded: round(fraction * marks), isCorrect: exact }
}

export function percentage(awarded: number, available: number): number {
  if (available <= 0) return 0
  return Math.round((awarded / available) * 1000) / 10
}

/** Fisher–Yates shuffle with an injectable random source (for tests). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
