import { useCallback, useEffect, useRef, useState } from 'react'
import type { AttemptSession, QuestionFeedback, SessionQuestion } from '../../../shared/types'
import { api, errorCode, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { TypeBadge } from '../components/QuestionView'
import { MarkingTable } from '../components/Marking'
import { RichText } from '../components/RichText'
import { Dialog, ErrorNote, Loading, useToast } from '../components/ui'
import { fmtClock, fmtMarks } from '../lib/format'
import { go } from '../lib/router'

const FLUSH_EVERY = 5

export function TakeQuiz({ id }: { id: number }) {
  const [session, setSession] = useState<AttemptSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [exitOpen, setExitOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [checking, setChecking] = useState(false)
  const toast = useToast()

  const pending = useRef(0)
  const indexRef = useRef(0)
  const sessionRef = useRef<AttemptSession | null>(null)
  const submittedRef = useRef(false)

  useEffect(() => {
    api('attempts:session', { id })
      .then((s) => {
        setSession(s)
        sessionRef.current = s
        const start = Math.min(s.currentPosition, s.questions.length - 1)
        setIndex(Math.max(0, start))
        indexRef.current = Math.max(0, start)
        setElapsed(s.durationSeconds)
        const q = s.questions[Math.max(0, start)]
        if (q) void api('attempts:tick', { attemptId: s.id, questionId: q.id, seconds: 0, position: Math.max(0, start), visit: true }).catch(() => undefined)
      })
      .catch((e: unknown) => {
        if (errorCode(e) === 'NOT_IN_PROGRESS') go({ name: 'result', id }, true)
        else setError(errorMessage(e))
      })
  }, [id])

  /** Send the active seconds counted so far, attributed to the question on screen. */
  const flush = useCallback(async (): Promise<void> => {
    const s = sessionRef.current
    if (!s || pending.current <= 0) return
    const seconds = pending.current
    pending.current = 0
    const q = s.questions[indexRef.current] as SessionQuestion | undefined
    try {
      await api('attempts:tick', { attemptId: s.id, questionId: q ? q.id : null, seconds, position: indexRef.current })
    } catch {
      pending.current += seconds
    }
  }, [])

  // Count only active time: the window is visible and focused.
  useEffect(() => {
    if (!session) return
    const t = setInterval(() => {
      if (submittedRef.current) return
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        pending.current += 1
        setElapsed((e) => e + 1)
        if (pending.current >= FLUSH_EVERY) void flush()
      }
    }, 1000)
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onHide)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onHide)
      void flush()
    }
  }, [session, flush])

  const goTo = useCallback(
    (i: number): void => {
      const s = sessionRef.current
      if (!s) return
      const next = Math.max(0, Math.min(s.questions.length, i))
      void flush().then(() => {
        indexRef.current = next
        setIndex(next)
        if (next < s.questions.length) {
          void api('attempts:tick', { attemptId: s.id, questionId: s.questions[next].id, seconds: 0, position: next, visit: true }).catch(
            () => undefined
          )
        }
      })
    },
    [flush]
  )

  const updateQuestion = (qid: number, patch: Partial<SessionQuestion>): void => {
    setSession((s) => {
      if (!s) return s
      const n = { ...s, questions: s.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) }
      sessionRef.current = n
      return n
    })
  }

  const select = useCallback(
    (q: SessionQuestion, optionId: number): void => {
      const s = sessionRef.current
      if (!s || q.feedback) return
      const selected =
        q.type === 'single'
          ? q.selected.includes(optionId)
            ? q.selected
            : [optionId]
          : q.selected.includes(optionId)
            ? q.selected.filter((x) => x !== optionId)
            : [...q.selected, optionId]
      updateQuestion(q.id, { selected })
      setSaveState('saving')
      api('attempts:answer', { attemptId: s.id, questionId: q.id, selected })
        .then(() => setSaveState('saved'))
        .catch((e: unknown) => {
          setSaveState('error')
          toast(`Your answer was not saved: ${errorMessage(e)}`, 'bad')
        })
    },
    [toast]
  )

  const reveal = useCallback(
    async (q: SessionQuestion): Promise<void> => {
      const s = sessionRef.current
      if (!s || q.feedback) return
      setChecking(true)
      try {
        const fb: QuestionFeedback = await api('attempts:reveal', { attemptId: s.id, questionId: q.id })
        updateQuestion(q.id, { feedback: fb })
      } catch (e) {
        toast(errorMessage(e), 'bad')
        // The answer is locked even if AI marking failed; show the model answer.
        const fb = await api('attempts:session', { id: s.id }).then((x) => x.questions.find((y) => y.id === q.id)?.feedback ?? null).catch(() => null)
        if (fb) updateQuestion(q.id, { feedback: fb })
      } finally {
        setChecking(false)
      }
    },
    [toast]
  )

  const toggleFlag = useCallback(
    (q: SessionQuestion): void => {
      const s = sessionRef.current
      if (!s) return
      updateQuestion(q.id, { flagged: !q.flagged })
      void api('attempts:flag', { attemptId: s.id, questionId: q.id, flagged: !q.flagged }).catch((e: unknown) =>
        toast(errorMessage(e), 'bad')
      )
    },
    [toast]
  )

  const submit = useCallback(async (): Promise<void> => {
    const s = sessionRef.current
    if (!s || submittedRef.current) return
    setSubmitting(true)
    await flush()
    submittedRef.current = true
    try {
      await api('attempts:submit', { id: s.id })
      go({ name: 'result', id: s.id }, true)
    } catch (e) {
      submittedRef.current = false
      setSubmitting(false)
      toast(errorMessage(e), 'bad')
    }
  }, [flush, toast])

  // Time limit: submit automatically when the active-time budget is spent.
  const limit = session?.settings.timeLimitMinutes ? session.settings.timeLimitMinutes * 60 : null
  useEffect(() => {
    if (limit !== null && elapsed >= limit && !submittedRef.current) {
      toast('Time is up. Your attempt has been submitted.', 'info')
      void submit()
    }
  }, [elapsed, limit, submit, toast])

  // Keyboard controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = sessionRef.current
      if (!s || exitOpen || submitting) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && target.tagName === 'TEXTAREA' && e.key === 'Escape') {
        target.blur()
        return
      }
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (document.querySelector('dialog[open]')) return
      const i = indexRef.current
      const q = s.questions[i] as SessionQuestion | undefined
      const key = e.key.toLowerCase()
      if (q) {
        const letter = 'abcde'.indexOf(key)
        const digit = '12345'.indexOf(key)
        const pick = letter >= 0 ? letter : digit
        if (pick >= 0 && q.options[pick]) {
          e.preventDefault()
          select(q, q.options[pick].id)
          return
        }
        if (key === 'f') {
          e.preventDefault()
          toggleFlag(q)
          return
        }
        if (key === 'enter') {
          if (target && target.tagName === 'BUTTON' && !target.classList.contains('opt')) return
          e.preventDefault()
          if (s.settings.feedback === 'each' && !q.feedback && (q.selected.length > 0 || q.writtenAnswer.trim())) void reveal(q)
          else goTo(i + 1)
          return
        }
      }
      if (key === 'arrowright') {
        e.preventDefault()
        goTo(i + 1)
      } else if (key === 'arrowleft') {
        e.preventDefault()
        goTo(i - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exitOpen, submitting, select, toggleFlag, reveal, goTo])

  if (error) {
    return (
      <div className="page">
        <ErrorNote>{error}</ErrorNote>
      </div>
    )
  }
  if (!session) return <Loading label="Opening your attempt" />

  const total = session.questions.length
  const onReview = index >= total
  const q = onReview ? null : session.questions[index]
  const isAnswered = (x: SessionQuestion): boolean => (x.type === 'written' ? x.writtenAnswer.trim().length > 0 : x.selected.length > 0)
  const answered = session.questions.filter(isAnswered).length
  const unanswered = session.questions.filter((x) => !isAnswered(x))
  const writtenToMark = session.settings.aiMarking ? session.questions.filter((x) => x.type === 'written' && x.writtenAnswer.trim() && !x.feedback?.written?.marking).length : 0
  const flagged = session.questions.filter((x) => x.flagged)
  const remaining = limit !== null ? Math.max(0, limit - elapsed) : null

  return (
    <div className="take">
      <header className="take-bar">
        <button type="button" className="take-exit" onClick={() => setExitOpen(true)} aria-label="Exit quiz">
          <Icon name="close" size={18} />
          <span>Exit</span>
        </button>
        <div className="take-title">
          <span className="take-quiz">{session.quizTitle}</span>
          <span className="take-sub">
            {session.isPractice ? (
              <span className="tag tag-practice">Practice</span>
            ) : (
              <span className="faint">Attempt {session.projectedAttemptNumber}</span>
            )}
          </span>
        </div>
        <div className="take-progress" aria-label={`${answered} of ${total} answered`}>
          <span className="num">
            {onReview ? 'Review' : `${index + 1} / ${total}`}
          </span>
          <span className="take-progress-track" aria-hidden="true">
            <span className="take-progress-fill" style={{ width: `${(answered / total) * 100}%` }} />
          </span>
        </div>
        <div
          className={remaining !== null && remaining <= 60 ? 'take-timer is-low' : 'take-timer'}
          role="timer"
          aria-label={remaining !== null ? 'Time remaining' : 'Time elapsed'}
          data-testid="timer"
        >
          <Icon name="clock" size={16} />
          <span className="num">{fmtClock(remaining ?? elapsed)}</span>
        </div>
        <span className={`take-save take-save-${saveState}`} aria-live="polite">
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'}
        </span>
      </header>

      <div className="take-body">
        <nav className="navigator" aria-label="Questions">
          <ol>
            {session.questions.map((x, i) => {
              const cls = [
                'nav-q',
                i === index ? 'is-current' : '',
                isAnswered(x) ? 'is-answered' : '',
                x.flagged ? 'is-flagged' : '',
                x.feedback ? (x.feedback.isCorrect ? 'is-right' : 'is-wrong') : ''
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    className={cls}
                    onClick={() => goTo(i)}
                    aria-current={i === index ? 'step' : undefined}
                    aria-label={`Question ${i + 1}${isAnswered(x) ? ', answered' : ', not answered'}${x.flagged ? ', flagged' : ''}`}
                  >
                    <span className="num">{i + 1}</span>
                  </button>
                </li>
              )
            })}
            <li>
              <button
                type="button"
                className={onReview ? 'nav-q nav-q-submit is-current' : 'nav-q nav-q-submit'}
                onClick={() => goTo(total)}
                aria-label="Review and submit"
              >
                <Icon name="check" size={14} weight={2.4} />
              </button>
            </li>
          </ol>
        </nav>

        {q ? (
          <article className="question" aria-labelledby="q-prompt" key={q.id}>
            <div className="question-meta">
              <span className="question-n num">{String(index + 1).padStart(2, '0')}</span>
              <TypeBadge type={q.type} />
              <span className="faint num">
                {fmtMarks(q.marks)} {q.marks === 1 ? 'mark' : 'marks'}
              </span>
              {q.topic ? <span className="tag">{q.topic}</span> : null}
              <button
                type="button"
                className={q.flagged ? 'flag-btn is-on' : 'flag-btn'}
                aria-pressed={q.flagged}
                onClick={() => toggleFlag(q)}
              >
                <Icon name="flag" size={16} />
                {q.flagged ? 'Flagged' : 'Flag'}
                <kbd>F</kbd>
              </button>
            </div>
            <h1 id="q-prompt" className="question-prompt">
              <RichText text={q.prompt} />
            </h1>
            {q.type === 'written' ? (
              <WrittenAnswer
                key={q.id}
                q={q}
                attemptId={session.id}
                onChange={(text) => updateQuestion(q.id, { writtenAnswer: text })}
                onSaveState={setSaveState}
              />
            ) : null}
            {q.type === 'written' ? null : (
            <div
              className={`options options-${q.type}`}
              role={q.type === 'single' ? 'radiogroup' : 'group'}
              aria-labelledby="q-prompt"
            >
              {q.options.map((o) => {
                const on = q.selected.includes(o.id)
                const fb = q.feedback
                const isRight = fb?.correctOptionIds.includes(o.id) ?? false
                const state = fb ? (isRight ? (on ? 'right' : 'missed') : on ? 'wrong' : 'idle') : on ? 'on' : 'idle'
                return (
                  <button
                    type="button"
                    key={o.id}
                    className={`opt opt-${state}`}
                    role={q.type === 'single' ? 'radio' : 'checkbox'}
                    aria-checked={on}
                    aria-disabled={!!fb}
                    onClick={() => select(q, o.id)}
                    data-testid={`option-${o.label}`}
                  >
                    <span className={`opt-key opt-key-${q.type}`} aria-hidden="true">
                      {o.label}
                    </span>
                    <span className="opt-text">
                      <RichText text={o.text} />
                    </span>
                    {fb && (isRight || on) ? (
                      <span className="opt-verdict">
                        {isRight ? (on ? 'Correct' : 'Correct answer') : 'Not correct'}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            )}

            {q.feedback?.written ? <WrittenFeedback q={q} aiMarking={!!session.settings.aiMarking} /> : null}

            {q.feedback && !q.feedback.written ? (
              <div className={q.feedback.isCorrect ? 'feedback is-right' : 'feedback is-wrong'} role="status">
                <p className="feedback-verdict">
                  <Icon name={q.feedback.isCorrect ? 'check' : 'cross'} size={18} weight={2.4} />
                  {q.feedback.isCorrect
                    ? 'Correct.'
                    : q.feedback.marksAwarded > 0
                      ? `Partly right: ${fmtMarks(q.feedback.marksAwarded)} of ${fmtMarks(q.marks)} marks.`
                      : 'Not quite.'}
                </p>
                {q.feedback.explanation ? (
                  <p className="feedback-expl">
                    <RichText text={q.feedback.explanation} />
                  </p>
                ) : null}
              </div>
            ) : null}

            <footer className="question-foot">
              <button type="button" className="btn btn-ghost" onClick={() => goTo(index - 1)} disabled={index === 0}>
                <Icon name="arrowLeft" size={16} /> Previous
              </button>
              <span className="faint small hint-keys">
                <kbd>A</kbd>–<kbd>E</kbd> answer · <kbd>←</kbd> <kbd>→</kbd> move
              </span>
              {session.settings.feedback === 'each' && !q.feedback ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!isAnswered(q) || checking}
                  onClick={() => void reveal(q)}
                >
                  {checking ? 'Marking…' : 'Check answer'} <kbd className="kbd-on">Enter</kbd>
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => goTo(index + 1)} data-testid="next">
                  {index === total - 1 ? 'Review answers' : 'Next'} <kbd className="kbd-on">Enter</kbd>
                </button>
              )}
            </footer>
          </article>
        ) : (
          <section className="review-submit" aria-labelledby="submit-h">
            <h1 id="submit-h" className="page-title">Ready to submit?</h1>
            <p className="lede">
              {answered === total
                ? `All ${total} questions answered.`
                : `${answered} of ${total} questions answered.`}{' '}
              {flagged.length ? `${flagged.length} flagged for another look.` : ''}
            </p>
            {unanswered.length ? (
              <div className="submit-list">
                <h2 className="mini-h">Unanswered</h2>
                <ul className="jump-list">
                  {unanswered.map((x) => (
                    <li key={x.id}>
                      <button type="button" className="jump" onClick={() => goTo(session.questions.indexOf(x))}>
                        <span className="num">{session.questions.indexOf(x) + 1}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="muted small">Unanswered questions score zero.</p>
              </div>
            ) : null}
            {session.questions.some((x) => x.type === 'written') ? (
              <p className="muted small submit-note">
                {session.settings.aiMarking
                  ? `Written answers are marked by the AI against each mark scheme when you submit${writtenToMark > 2 ? '; this can take a minute' : ''}. You can change any mark afterwards.`
                  : 'You will mark your written answers yourself against the mark scheme on the next page.'}
              </p>
            ) : null}
            {flagged.length ? (
              <div className="submit-list">
                <h2 className="mini-h">Flagged</h2>
                <ul className="jump-list">
                  {flagged.map((x) => (
                    <li key={x.id}>
                      <button type="button" className="jump jump-flag" onClick={() => goTo(session.questions.indexOf(x))}>
                        <span className="num">{session.questions.indexOf(x) + 1}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="submit-actions">
              <button type="button" className="btn btn-ghost" onClick={() => goTo(total - 1)}>
                <Icon name="arrowLeft" size={16} /> Back to questions
              </button>
              <button type="button" className="btn btn-primary btn-xl" onClick={() => void submit()} disabled={submitting} data-testid="submit">
                {submitting ? (writtenToMark ? 'Marking written answers…' : 'Submitting…') : 'Submit attempt'}
              </button>
            </div>
          </section>
        )}
      </div>

      <Dialog
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Leave this attempt?"
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-danger"
              onClick={async () => {
                submittedRef.current = true
                await api('attempts:abandon', { id: session.id })
                toast('Attempt discarded.', 'info')
                go({ name: 'quiz', id: session.quizId }, true)
              }}
            >
              Discard attempt
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setExitOpen(false)}>
              Keep going
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                await flush()
                go({ name: 'dashboard' })
              }}
              data-testid="save-exit"
            >
              Save and exit
            </button>
          </>
        }
      >
        <p>
          Your answers are saved as you go. Save and exit to resume later from the dashboard, or discard the attempt
          so it is not counted.
        </p>
      </Dialog>
    </div>
  )
}

function WrittenAnswer({
  q,
  attemptId,
  onChange,
  onSaveState
}: {
  q: SessionQuestion
  attemptId: number
  onChange: (text: string) => void
  onSaveState: (s: 'saved' | 'saving' | 'error') => void
}) {
  const [text, setText] = useState(q.writtenAnswer)
  const locked = !!q.feedback
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(text)
  const save = useCallback(
    (value: string) => {
      onSaveState('saving')
      api('attempts:answerWritten', { attemptId, questionId: q.id, text: value })
        .then(() => onSaveState('saved'))
        .catch(() => onSaveState('error'))
    },
    [attemptId, q.id, onSaveState]
  )
  useEffect(
    () => () => {
      // Save immediately when leaving the question.
      if (timer.current) {
        clearTimeout(timer.current)
        save(latest.current)
      }
    },
    [save]
  )
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return (
    <div className="written-answer">
      <label className="sr-only" htmlFor={`wa-${q.id}`}>
        Your answer
      </label>
      <textarea
        id={`wa-${q.id}`}
        className="input textarea written-input"
        rows={8}
        maxLength={8000}
        value={text}
        readOnly={locked}
        placeholder="Type your answer. Aim for the points a marker would look for."
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          latest.current = v
          onChange(v)
          onSaveState('saving')
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            timer.current = null
            save(v)
          }, 600)
        }}
        data-testid="written-input"
      />
      <div className="written-meta faint small">
        <span className="num">{words} {words === 1 ? 'word' : 'words'}</span>
        <span>
          Worth {fmtMarks(q.marks)} {q.marks === 1 ? 'mark' : 'marks'}. Keyboard shortcuts pause while you type; press <kbd>Esc</kbd> to leave the box.
        </span>
      </div>
    </div>
  )
}

function WrittenFeedback({ q, aiMarking }: { q: SessionQuestion; aiMarking: boolean }) {
  const w = q.feedback?.written
  if (!w) return null
  const m = w.marking
  const total = m ? m.points.reduce((s, p) => s + p.awarded, 0) : null
  return (
    <div className={`feedback feedback-written ${m ? (total !== null && total >= q.marks ? 'is-right' : 'is-wrong') : ''}`} role="status">
      {m ? (
        <p className="feedback-verdict">
          {fmtMarks(total ?? 0)} of {fmtMarks(q.marks)} marks
          <span className="faint small"> · {m.markedBy === 'ai' ? 'marked by AI' : m.markedBy === 'auto' ? 'no answer' : 'marked by you'}</span>
        </p>
      ) : (
        <p className="feedback-verdict">
          {aiMarking ? 'The AI could not mark this answer. ' : ''}Mark it yourself on the results page.
        </p>
      )}
      <MarkingTable scheme={w.markScheme} marking={m} />
      {m?.feedback ? <p className="feedback-expl">{m.feedback}</p> : null}
      <div className="model-answer">
        <span className="mini-h">Model answer</span>
        <p>
          <RichText text={w.modelAnswer} />
        </p>
      </div>
    </div>
  )
}
