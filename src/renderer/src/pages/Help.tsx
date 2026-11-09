import { useEffect, useState } from 'react'
import templateCsv from '../../../../samples/template.csv?raw'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { QuestionPreview } from '../components/QuestionView'
import { useToast } from '../components/ui'
import { href } from '../lib/router'
import type { ParsedQuestion } from '../../../shared/types'

export const AI_PROMPT = `Create a multiple-choice quiz as raw CSV from the material I provide.

Topic: [TOPIC]
Number of questions: [NUMBER]
Difficulty: [EASY / MEDIUM / HARD / MIXED]
Source material: [PASTE NOTES OR ATTACH FILES]

Output only the CSV, in a single code block or as a downloadable .csv file. Do not add commentary.

Use exactly this header:
question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic

Rules:
- Every question must have exactly five distinct, non-empty options.
- type must be "single" or "multi".
- A single question must have exactly one correct letter.
- A multi question must have one or more correct letters, separated by semicolons, for example A;C;E.
- Use a mix of single and multi questions unless told otherwise.
- marks must be a positive number. Use 1 for simple recall and more for multi-step or multi-answer questions.
- Wrap any field containing a comma, quote, or line break in double quotes. Escape a double quote by doubling it.
- Write mathematics in LaTeX using $...$ and code in backticks.
- Every explanation must say why the correct answer is right and address the main misconception.
- topic must be a short subtopic name, used consistently.
- Base every question on the source material. Make distractors plausible and avoid "all of the above" or "none of the above".
- Vary the position of the correct answers.
- Check every row against these rules before responding.

Follow the structure of this example:
${templateCsv.trim()}`

const SECTIONS = [
  { id: 'start', label: 'Quick start' },
  { id: 'csv', label: 'CSV columns' },
  { id: 'files', label: 'Template and sample' },
  { id: 'errors', label: 'Import errors' },
  { id: 'ai', label: 'Create quizzes with AI' },
  { id: 'data', label: 'Data and devices' }
]

const SINGLE_EXAMPLE: ParsedQuestion = {
  row: 2,
  prompt: 'Which connective is false only when the antecedent is true and the consequent is false?',
  type: 'single',
  marks: 1,
  topic: 'Propositional logic',
  explanation: 'An implication P → Q fails only when P is true and Q is false.',
  options: [
    { label: 'A', text: 'Conjunction', isCorrect: false },
    { label: 'B', text: 'Disjunction', isCorrect: false },
    { label: 'C', text: 'Implication', isCorrect: true },
    { label: 'D', text: 'Biconditional', isCorrect: false },
    { label: 'E', text: 'Exclusive or', isCorrect: false }
  ]
}

const MULTI_EXAMPLE: ParsedQuestion = {
  row: 3,
  prompt: 'Which of these are tautologies?',
  type: 'multi',
  marks: 2,
  topic: 'Propositional logic',
  explanation: 'A, C and E are true under every assignment; B is a contradiction and D is contingent.',
  options: [
    { label: 'A', text: '$P \\lor \\neg P$', isCorrect: true },
    { label: 'B', text: '$P \\land \\neg P$', isCorrect: false },
    { label: 'C', text: '$P \\to P$', isCorrect: true },
    { label: 'D', text: '$P \\to Q$', isCorrect: false },
    { label: 'E', text: '$\\neg(P \\land \\neg P)$', isCorrect: true }
  ]
}

const COLUMNS: { name: string; required: boolean; rule: string }[] = [
  { name: 'question', required: true, rule: 'The question text. Maths in $…$, code in backticks.' },
  { name: 'option_a … option_e', required: true, rule: 'Five options. All must be filled in and different from each other.' },
  { name: 'type', required: true, rule: 'single (one correct answer, radio buttons) or multi (one or more, tick boxes).' },
  { name: 'correct', required: true, rule: 'The correct letters, separated by semicolons: C, or A;C;E. Case does not matter.' },
  { name: 'marks', required: false, rule: 'A positive number such as 1, 2 or 0.5. Empty means 1.' },
  { name: 'explanation', required: false, rule: 'Shown after the question is marked. Say why the answer is right.' },
  { name: 'topic', required: false, rule: 'A short subtopic name, used for the per-topic breakdown.' }
]

const ERRORS: { problem: string; fix: string }[] = [
  {
    problem: 'This row has 12 fields but the header has 11.',
    fix: 'A value contains a comma but is not in double quotes. Wrap it: "Paris, France".'
  },
  {
    problem: 'A single-answer question must have exactly one correct letter.',
    fix: 'Keep one letter in correct, or change type to multi.'
  },
  {
    problem: '"A,C" uses the wrong separator.',
    fix: 'Use semicolons between letters: A;C.'
  },
  { problem: 'Option D is the same as option B.', fix: 'Every option in a question must be different. Replace one.' },
  { problem: 'Option E is empty.', fix: 'All five options are required. Add a plausible wrong answer.' },
  {
    problem: 'The required column "correct" is missing.',
    fix: 'Check the header row is exactly the one in the template, spelled the same way.'
  },
  {
    problem: 'A quoted field is never closed.',
    fix: 'A field that starts with " must end with ". Write a quote inside a field as "".'
  },
  {
    problem: 'Odd characters such as Ã© instead of é.',
    fix: 'Save from your spreadsheet as "CSV UTF-8". Tally reads UTF-8 with or without a BOM.'
  }
]

export function HelpPage({ section }: { section: string | null }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (section) document.getElementById(`help-${section}`)?.scrollIntoView({ block: 'start' })
  }, [section])

  const copy = async (): Promise<void> => {
    try {
      await api('help:copy', { text: AI_PROMPT })
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    } catch (e) {
      toast(errorMessage(e), 'bad')
    }
  }

  const save = async (which: 'template' | 'example'): Promise<void> => {
    try {
      const r = await api('help:saveSample', { which })
      if (r.saved) toast('Saved.', 'good')
    } catch (e) {
      toast(errorMessage(e), 'bad')
    }
  }

  return (
    <div className="page help">
      <header className="page-head">
        <div>
          <h1 className="page-title">Help</h1>
          <p className="lede">How to get quizzes into Tally, and how your data is kept.</p>
        </div>
      </header>

      <div className="help-layout">
        <nav className="help-toc" aria-label="Help sections">
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={href({ name: 'help', section: s.id })} className={section === s.id ? 'is-current' : ''}>
                  <span className="num faint">{String(i + 1).padStart(2, '0')}</span> {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="help-body">
          <section id="help-start" className="help-section" aria-labelledby="h-start">
            <h2 id="h-start">Quick start</h2>
            <ol className="steps steps-compact">
              <li>
                <span className="step-n num">1</span>
                <p>
                  <strong>Create a module</strong> for each subject, in <a href={href({ name: 'modules' })}>Modules</a>.
                </p>
              </li>
              <li>
                <span className="step-n num">2</span>
                <p>
                  <strong>Upload a quiz</strong> as a CSV file into that module. Write it in a spreadsheet, start from the
                  template below, or ask an AI to write one from your notes.
                </p>
              </li>
              <li>
                <span className="step-n num">3</span>
                <p>
                  <strong>Take it.</strong> Choose shuffling, when to see answers, a time limit and the marking mode.
                  Close the app mid-quiz and you can resume from the dashboard.
                </p>
              </li>
              <li>
                <span className="step-n num">4</span>
                <p>
                  <strong>Review.</strong> Every attempt keeps your answers, marks and time per question. Practise the
                  ones you got wrong; practice runs never count towards your statistics.
                </p>
              </li>
            </ol>
          </section>

          <section id="help-csv" className="help-section" aria-labelledby="h-csv">
            <h2 id="h-csv">CSV columns</h2>
            <p className="muted">
              One question per row, below a header row. Every question has exactly five options. Columns can be in any
              order.
            </p>
            <table className="table col-table">
              <caption className="sr-only">CSV columns</caption>
              <thead>
                <tr>
                  <th scope="col">Column</th>
                  <th scope="col">Required</th>
                  <th scope="col">What goes in it</th>
                </tr>
              </thead>
              <tbody>
                {COLUMNS.map((c) => (
                  <tr key={c.name}>
                    <td className="mono nowrap">{c.name}</td>
                    <td>{c.required ? 'Yes' : <span className="faint">Optional</span>}</td>
                    <td>{c.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="example-pair">
              <div>
                <h3 className="mini-h">Single answer</h3>
                <pre className="csv-raw">
                  <code>{`...,Conjunction,Disjunction,Implication,Biconditional,Exclusive or,single,C,1,...`}</code>
                </pre>
                <QuestionPreview q={SINGLE_EXAMPLE} />
              </div>
              <div>
                <h3 className="mini-h">Multiple answers</h3>
                <pre className="csv-raw">
                  <code>{`...,$P \\lor \\neg P$,$P \\land \\neg P$,$P \\to P$,$P \\to Q$,$\\neg(P \\land \\neg P)$,multi,A;C;E,2,...`}</code>
                </pre>
                <QuestionPreview q={MULTI_EXAMPLE} />
              </div>
            </div>
          </section>

          <section id="help-files" className="help-section" aria-labelledby="h-files">
            <h2 id="h-files">Template and sample</h2>
            <div className="file-rows">
              <div className="file-row">
                <div>
                  <p className="file-name mono">tally-template.csv</p>
                  <p className="muted small">The header and the two example questions above. Replace them with your own.</p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => save('template')}>
                  <Icon name="download" size={16} /> Save template
                </button>
              </div>
              <div className="file-row">
                <div>
                  <p className="file-name mono">tally-example-quiz.csv</p>
                  <p className="muted small">A 12-question quiz on logic, sets and complexity, with maths and code.</p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => save('example')}>
                  <Icon name="download" size={16} /> Save sample quiz
                </button>
              </div>
            </div>
          </section>

          <section id="help-errors" className="help-section" aria-labelledby="h-errors">
            <h2 id="h-errors">Common import errors</h2>
            <p className="muted">
              Tally checks the whole file before saving and lists every problem with its row and column. The header is
              row 1, as in a spreadsheet.
            </p>
            <table className="table">
              <caption className="sr-only">Common import errors</caption>
              <thead>
                <tr>
                  <th scope="col">You see</th>
                  <th scope="col">Fix</th>
                </tr>
              </thead>
              <tbody>
                {ERRORS.map((e) => (
                  <tr key={e.problem}>
                    <td>{e.problem}</td>
                    <td className="muted">{e.fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section id="help-ai" className="help-section help-ai" aria-labelledby="h-ai">
            <div className="ai-head">
              <div>
                <p className="eyebrow">Fastest way to a quiz</p>
                <h2 id="h-ai">Create quizzes with AI</h2>
              </div>
              <button type="button" className="btn btn-primary" onClick={copy} data-testid="copy-prompt">
                <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy prompt'}
              </button>
            </div>
            <ol className="ai-steps">
              <li>Copy the prompt and paste it into the AI assistant you use.</li>
              <li>Replace the bracketed parts and paste or attach your notes.</li>
              <li>Save the reply as a .csv file and upload it. Tally will point out any row that breaks the rules.</li>
            </ol>
            <pre className="prompt" tabIndex={0} aria-label="AI prompt">
              <code>{AI_PROMPT}</code>
            </pre>
          </section>

          <section id="help-data" className="help-section" aria-labelledby="h-data">
            <h2 id="h-data">Data, backups and moving devices</h2>
            <dl className="qa">
              <dt>Where is my data?</dt>
              <dd>
                In the <span className="mono">Tally Data</span> folder you chose on first launch. Everything is in one
                file, <span className="mono">userdata.sqlite</span>: modules, every version of every quiz (including
                the original CSV), and every attempt. The <span className="mono">quizzes</span> folder holds readable
                copies of your CSVs; it is a convenience and can be deleted. See the path in{' '}
                <a href={href({ name: 'settings' })}>Settings</a>.
              </dd>
              <dt>Backups</dt>
              <dd>
                Tally copies the database into <span className="mono">backups</span> each time it starts and before
                deleting, restoring or moving anything, keeping the latest ten. Use <em>Export my data</em> in Settings
                for a copy you keep elsewhere.
              </dd>
              <dt>Moving to another computer</dt>
              <dd>
                Copy the <span className="mono">Tally Data</span> folder across (or export your data and restore it).
                On the new computer, install Tally and choose that folder on the first screen; Tally offers{' '}
                <em>Use this existing data</em> and never overwrites it.
              </dd>
              <dt>Using a synced folder</dt>
              <dd>
                You can keep <span className="mono">Tally Data</span> in Dropbox, OneDrive, iCloud Drive or similar.{' '}
                <strong>Only run Tally on one computer at a time</strong> against the same folder, and let syncing
                finish before opening it elsewhere. Two copies writing to one file can lose work.
              </dd>
              <dt>Uninstalling or updating</dt>
              <dd>Never touches your data folder.</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
