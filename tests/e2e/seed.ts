// Builds a realistic data folder for the design review screenshots: several
// modules, real questions, and attempts spread over three months.
import fs from 'node:fs'
import path from 'node:path'
import type { DB } from '../../src/main/db/connection'
import { createDataFolder, writeConfig } from '../../src/main/storage'
import { createModule } from '../../src/main/services/modules'
import { commitImport } from '../../src/main/services/quizzes'
import * as attempts from '../../src/main/services/attempts'
import { toCsv } from '../../src/main/csv/parse'
import type { ModuleColour } from '../../src/shared/types'

type Q = [prompt: string, options: string[], type: 'single' | 'multi', correct: string, marks: number, explanation: string, topic: string]

const HEADER = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'type', 'correct', 'marks', 'explanation', 'topic']
const toQuizCsv = (qs: Q[]): string => toCsv([HEADER, ...qs.map(([p, o, t, c, m, e, tp]) => [p, ...o, t, c, m, e, tp])])

const LINEAR: Q[] = [
  ['What is the determinant of $\\begin{pmatrix} 2 & 1 \\\\ 4 & 3 \\end{pmatrix}$?', ['$2$', '$10$', '$-2$', '$6$', '$5$'], 'single', 'A', 1, '$2 \\cdot 3 - 1 \\cdot 4 = 2$.', 'Determinants'],
  ['Which of these are always true for an invertible $n \\times n$ matrix $A$?', ['$\\det A \\neq 0$', '$A$ is symmetric', 'The columns of $A$ are linearly independent', '$\\operatorname{rank} A = n$', '$A$ has $n$ distinct eigenvalues'], 'multi', 'A;C;D', 2, 'Invertibility is equivalent to a non-zero determinant, independent columns and full rank. Symmetry and distinct eigenvalues are unrelated.', 'Invertibility'],
  ['If $A\\mathbf{v} = \\lambda\\mathbf{v}$ with $\\mathbf{v} \\neq \\mathbf{0}$, then $\\lambda$ is', ['an eigenvector of $A$', 'an eigenvalue of $A$', 'the trace of $A$', 'the rank of $A$', 'always positive'], 'single', 'B', 1, 'By definition $\\lambda$ is an eigenvalue and $\\mathbf{v}$ its eigenvector.', 'Eigenvalues'],
  ['The dimension of the null space of a $4 \\times 6$ matrix of rank 3 is', ['$1$', '$2$', '$3$', '$4$', '$6$'], 'single', 'C', 1, 'Rank–nullity: $6 - 3 = 3$.', 'Rank and nullity'],
  ['Which sets are subspaces of $\\mathbb{R}^3$?', ['$\\{\\mathbf{0}\\}$', 'A plane through the origin', 'A line not through the origin', '$\\mathbb{R}^3$ itself', 'The unit sphere'], 'multi', 'A;B;D', 2, 'Subspaces must contain the origin and be closed under addition and scaling.', 'Subspaces'],
  ['The eigenvalues of $\\begin{pmatrix} 3 & 0 \\\\ 0 & -1 \\end{pmatrix}$ are', ['$3$ and $-1$', '$3$ and $1$', '$0$ and $2$', '$-3$ and $1$', '$2$ only'], 'single', 'A', 1, 'A diagonal matrix has its diagonal entries as eigenvalues.', 'Eigenvalues'],
  ['Which statements about $\\operatorname{rank}(AB)$ hold?', ['$\\le \\operatorname{rank} A$', '$\\le \\operatorname{rank} B$', '$= \\operatorname{rank} A + \\operatorname{rank} B$', '$\\ge 1$ always', '$= \\operatorname{rank} A \\cdot \\operatorname{rank} B$'], 'multi', 'A;B', 2, 'The column space of $AB$ lies in that of $A$, and its row space in that of $B$.', 'Rank and nullity'],
  ['$\\det(2A)$ for a $3 \\times 3$ matrix $A$ equals', ['$2\\det A$', '$6\\det A$', '$8\\det A$', '$\\det A$', '$4\\det A$'], 'single', 'C', 1, 'Each of the three rows is scaled by 2: $2^3 = 8$.', 'Determinants']
]

const CELL: Q[] = [
  ['Which organelle is the site of oxidative phosphorylation?', ['Golgi apparatus', 'Mitochondrion', 'Ribosome', 'Lysosome', 'Peroxisome'], 'single', 'B', 1, 'The electron transport chain sits in the inner mitochondrial membrane.', 'Organelles'],
  ['Which are found in prokaryotic cells?', ['Ribosomes', 'Nucleus', 'Plasma membrane', 'Mitochondria', 'Cell wall (in most)'], 'multi', 'A;C;E', 2, 'Prokaryotes lack membrane-bound organelles but have 70S ribosomes and a membrane; most have a wall.', 'Cell types'],
  ['During which phase do sister chromatids separate?', ['Prophase', 'Metaphase', 'Anaphase', 'Telophase', 'Interphase'], 'single', 'C', 1, 'Cohesin is cleaved at anaphase and chromatids move to opposite poles.', 'Cell cycle'],
  ['Which molecules can cross a lipid bilayer by simple diffusion?', ['$O_2$', '$CO_2$', 'Glucose', '$Na^+$', 'Steroid hormones'], 'multi', 'A;B;E', 2, 'Small non-polar and lipid-soluble molecules diffuse; ions and glucose need proteins.', 'Membranes'],
  ['The rough endoplasmic reticulum is studded with', ['lysosomes', 'ribosomes', 'centrioles', 'vesicles of DNA', 'microtubules'], 'single', 'B', 1, 'Ribosomes translating secretory proteins give the RER its texture.', 'Organelles'],
  ['Which checkpoint verifies spindle attachment?', ['G1/S', 'G2/M', 'Metaphase-to-anaphase', 'S phase', 'G0'], 'single', 'C', 1, 'The spindle assembly checkpoint blocks anaphase until all kinetochores attach.', 'Cell cycle']
]

const MICRO: Q[] = [
  ['A price ceiling set below equilibrium leads to', ['a surplus', 'a shortage', 'no change', 'higher prices', 'lower demand'], 'single', 'B', 1, 'Quantity demanded exceeds quantity supplied at the capped price.', 'Market intervention'],
  ['Which shift the demand curve for coffee?', ['A change in the price of coffee', 'A rise in the price of tea', 'A rise in consumer income', 'A new coffee tax on producers', 'A change in tastes'], 'multi', 'B;C;E', 2, 'Own-price changes move along the curve; taxes on producers shift supply.', 'Demand'],
  ['If price elasticity of demand is $-0.4$, demand is', ['perfectly elastic', 'elastic', 'unit elastic', 'inelastic', 'perfectly inelastic'], 'single', 'D', 1, '$|\\varepsilon| < 1$ means inelastic.', 'Elasticity'],
  ['In perfect competition in the long run, firms earn', ['supernormal profit', 'zero economic profit', 'losses', 'monopoly rent', 'negative revenue'], 'single', 'B', 1, 'Entry and exit drive economic profit to zero.', 'Market structures'],
  ['Which are features of a natural monopoly?', ['Falling average cost over the market range', 'Many small firms', 'High fixed costs', 'Perfectly elastic demand', 'Often regulated'], 'multi', 'A;C;E', 2, 'Economies of scale across the market make one firm cheapest.', 'Market structures']
]

function rng(seed: number): () => number {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

function takeAt(db: DB, quizId: number, when: Date, skill: number, rand: () => number, minutes: number): void {
  const id = attempts.startAttempt(db, {
    quizId,
    settings: { shuffleQuestions: false, shuffleOptions: false, feedback: 'end', timeLimitMinutes: null, marking: 'strict' },
    practiceFromAttemptId: null,
    replaceInProgress: true
  })
  const s = attempts.getSession(db, id)
  for (const q of s.questions) {
    const correct = db.prepare('SELECT id FROM options WHERE question_id = ? AND is_correct = 1').pluck().all(q.id) as number[]
    const wrong = q.options.map((o) => o.id).filter((x) => !correct.includes(x))
    const right = rand() < skill
    const selected = right ? correct : q.type === 'single' ? [wrong[Math.floor(rand() * wrong.length)]] : [correct[0], wrong[0]]
    attempts.saveAnswer(db, { attemptId: id, questionId: q.id, selected })
    const secs = 10 + Math.floor(rand() * 40)
    db.prepare('UPDATE responses SET time_spent_seconds = ? WHERE attempt_id = ? AND question_id = ?').run(secs, id, q.id)
  }
  const started = new Date(when.getTime() - minutes * 60_000)
  db.prepare('UPDATE attempts SET started_at = ?, duration_seconds = ? WHERE id = ?').run(started.toISOString(), minutes * 60, id)
  attempts.submitAttempt(db, id, when.toISOString())
}

export function seedRealistic(userData: string, documents: string, theme: 'light' | 'dark'): string {
  const dataDir = path.join(documents, 'Tally Data')
  const db = createDataFolder(dataDir, JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).version)
  db.prepare(`INSERT INTO settings (key, value) VALUES ('theme', ?)`).run(theme)
  db.prepare(`INSERT INTO settings (key, value) VALUES ('onboarding_done', '1')`).run()
  const mods: { name: string; code: string; colour: ModuleColour; desc: string; quizzes: [string, Q[]][]; skill: number }[] = [
    { name: 'Linear Algebra', code: 'MATH2010', colour: 'cobalt', desc: 'Vector spaces, linear maps, eigenvalues.', quizzes: [['Determinants and inverses', LINEAR.slice(0, 5)], ['Eigenvalues and rank', LINEAR.slice(2)]], skill: 0.55 },
    { name: 'Cell Biology', code: 'BIOL1120', colour: 'teal', desc: 'Structure and function of the cell.', quizzes: [['Organelles and membranes', CELL]], skill: 0.75 },
    { name: 'Microeconomics', code: 'ECON1001', colour: 'ochre', desc: '', quizzes: [['Supply, demand and elasticity', MICRO]], skill: 0.62 }
  ]
  const sample = fs.readFileSync(path.resolve(__dirname, '../../samples/example_quiz.csv'), 'utf8')
  const rand = rng(11)
  const now = Date.now()
  const quizIds: { id: number; skill: number }[] = []
  for (const m of mods) {
    const mod = createModule(db, { name: m.name, code: m.code, colour: m.colour, description: m.desc || null })
    for (const [title, qs] of m.quizzes) {
      const r = commitImport(db, { moduleId: mod.id, filename: `${title}.csv`, text: toQuizCsv(qs), title, mode: 'new', targetQuizId: null })
      quizIds.push({ id: r.quizId, skill: m.skill })
    }
  }
  const dm = createModule(db, { name: 'Discrete Mathematics', code: 'COMP1215', colour: 'violet', description: 'Logic, sets, relations and complexity.' })
  const sq = commitImport(db, { moduleId: dm.id, filename: 'example_quiz.csv', text: sample, title: 'Logic, sets and complexity', mode: 'new', targetQuizId: null })
  quizIds.push({ id: sq.quizId, skill: 0.5 })

  // 26 attempts over 85 days, improving over time.
  for (let i = 0; i < 26; i++) {
    const q = quizIds[i % quizIds.length]
    const daysAgo = 85 - Math.floor((i / 26) * 84) - Math.floor(rand() * 2)
    const when = new Date(now - daysAgo * 86_400_000 + Math.floor(rand() * 8) * 3_600_000)
    takeAt(db, q.id, when, Math.min(0.97, q.skill + i * 0.012), rand, 4 + Math.floor(rand() * 9))
  }
  // A quiz with written answers: one marked by the AI, one still to mark.
  const writtenCsv = [
    'question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic,model_answer,mark_scheme',
    '"Explain why enzymes stop working at very high temperatures.",,,,,,written,,3,,Enzymes,"High temperatures break the bonds holding the tertiary structure, so the enzyme denatures. The active site changes shape, so the substrate can no longer bind.","[1] The enzyme is denatured or loses its shape (accept: bonds holding the shape break); [1] The active site changes shape (do not accept: the enzyme is killed); [1] The substrate no longer fits or binds, so fewer enzyme–substrate complexes form"',
    '"Compare osmosis and active transport.",,,,,,written,,4,,Membranes,"Osmosis is the passive movement of water across a partially permeable membrane down a water potential gradient; it needs no energy. Active transport moves substances against a concentration gradient using carrier proteins and energy from ATP.","[1] Osmosis moves water only; [1] Osmosis is passive and needs no ATP; [1] Active transport moves substances against a concentration gradient; [1] Active transport uses carrier proteins and ATP"',
    '"Which organelle is the site of aerobic respiration?",Nucleus,Mitochondrion,Ribosome,Golgi apparatus,Chloroplast,single,B,1,,Organelles,,'
  ].join('\n')
  const cellModule = db.prepare(`SELECT id FROM modules WHERE name = 'Cell Biology'`).pluck().get() as number
  const wq = commitImport(db, { moduleId: cellModule, filename: 'Written practice.csv', text: writtenCsv, title: 'Written practice', mode: 'new', targetQuizId: null })
  const wa = attempts.startAttempt(db, {
    quizId: wq.quizId,
    settings: { shuffleQuestions: false, shuffleOptions: false, feedback: 'end', timeLimitMinutes: null, marking: 'strict', aiMarking: true },
    practiceFromAttemptId: null,
    replaceInProgress: true
  })
  const [w1, w2, c1] = attempts.getSession(db, wa).questions
  attempts.saveWritten(db, wa, w1.id, 'The heat makes the enzyme lose its 3D shape so the substrate cant fit into it anymore.')
  attempts.saveWritten(db, wa, w2.id, 'Osmosis is water moving and it is passive. Active transport needs energy from ATP to move things.')
  attempts.saveAnswer(db, { attemptId: wa, questionId: c1.id, selected: [c1.options[1].id] })
  for (const [q, s] of [[w1, 52], [w2, 95], [c1, 9]] as const) {
    db.prepare('UPDATE responses SET time_spent_seconds = ? WHERE attempt_id = ? AND question_id = ?').run(s, wa, q.id)
  }
  attempts.submitAttempt(db, wa, new Date(now - 2 * 3_600_000).toISOString())
  attempts.applyMarking(db, wa, w1.id, {
    points: [
      { awarded: 1, evidence: 'lose its 3D shape', reason: 'Losing the 3D shape is equivalent to denaturing.' },
      { awarded: 0, evidence: '', reason: 'The active site is not mentioned.' },
      { awarded: 1, evidence: 'the substrate cant fit into it anymore', reason: 'States the substrate no longer fits.' }
    ],
    feedback: 'You explained denaturing and the loss of fit well. Say specifically that the active site changes shape.',
    markedBy: 'ai',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    markedAt: new Date().toISOString(),
    edited: false
  })

  // Study materials added over the term, two of them used to generate the written quiz.
  const mats = [
    ['Week 1 – Cell structure', 'BIOL1120 Lecture 1 Cell structure.pdf', 'pdf', 2_400_000, 18_200],
    ['Week 2 – Membranes and transport', 'Lecture 2 - membranes.pptx', 'pptx', 5_100_000, 9_400],
    ['Week 3 – Enzymes', 'week3_enzymes_notes.docx', 'docx', 310_000, 12_800],
    ['Week 4 – Respiration', 'Lecture 4 Respiration.pdf', 'pdf', 3_200_000, 21_000]
  ] as const
  const matIds = mats.map(([label, file, kind, bytes, chars], i) =>
    Number(
      db
        .prepare(
          `INSERT INTO materials (module_id, label, filename, kind, content_sha256, bytes, chars, text, copy_name, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(cellModule, label, file, kind, `seed${i}`, bytes, chars, `${label} text`, new Date(now - (60 - i * 14) * 86_400_000).toISOString())
        .lastInsertRowid
    )
  )
  const wv = db.prepare('SELECT id FROM quiz_versions WHERE quiz_id = ?').pluck().get(wq.quizId) as number
  for (const id of [matIds[1], matIds[2]]) {
    db.prepare('INSERT INTO quiz_version_materials (quiz_version_id, material_id, label, filename) VALUES (?, ?, ?, ?)').run(wv, id, mats[matIds.indexOf(id)][0], mats[matIds.indexOf(id)][1])
  }
  db.prepare('UPDATE quiz_versions SET generation_json = ? WHERE id = ?').run(
    JSON.stringify({ topic: 'Enzymes and membrane transport: explain, compare and apply', count: 3, difficulty: 'mixed', format: 'mixed', instructions: null, model: 'nvidia/nemotron-3-ultra-550b-a55b:free', extended: false }),
    wv
  )

  // An unfinished attempt to resume.
  const open = attempts.startAttempt(db, {
    quizId: quizIds[1].id,
    settings: { shuffleQuestions: false, shuffleOptions: false, feedback: 'end', timeLimitMinutes: null, marking: 'strict' },
    practiceFromAttemptId: null,
    replaceInProgress: true
  })
  attempts.tick(db, { attemptId: open, questionId: null, seconds: 30, position: 2 })
  db.close()
  writeConfig(path.join(userData, 'config.json'), { dataDir })
  return dataDir
}
