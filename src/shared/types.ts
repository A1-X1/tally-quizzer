// Types shared by the main process, the preload bridge and the renderer.
// Nothing in here may import Node or Electron modules.

export type QuestionType = 'single' | 'multi' | 'written'
export type MarkingMode = 'strict' | 'partial'
export type FeedbackMode = 'end' | 'each'
export type ThemePreference = 'system' | 'light' | 'dark'
export type AttemptStatus = 'in_progress' | 'submitted' | 'abandoned'
export type OptionLabel = 'A' | 'B' | 'C' | 'D' | 'E'

export const OPTION_LABELS: readonly OptionLabel[] = ['A', 'B', 'C', 'D', 'E']

/** Six hues, ordered so neighbours stay distinct for colour-blind readers. */
export const MODULE_COLOURS = ['cobalt', 'orange', 'teal', 'ochre', 'rose', 'violet'] as const
export type ModuleColour = (typeof MODULE_COLOURS)[number]

// ---------------------------------------------------------------------------
// Boot and data folder

export interface DataSummary {
  modules: number
  quizzes: number
  attempts: number
  lastActivity: string | null
}

export type BootState =
  | { kind: 'setup'; defaultLocation: string }
  | { kind: 'missing'; dataDir: string; reason: string }
  | { kind: 'ready'; dataDir: string; theme: ThemePreference; upgrade: UpgradeNotice | null }

export interface UpgradeNotice {
  fromVersion: string | null
  toVersion: string
  backup: string
}

export interface FolderInspection {
  token: string
  /** Folder the user picked (or the default parent). */
  location: string
  /** The Tally Data folder that would be used. */
  dataDir: string
  status: 'new' | 'existing' | 'invalid' | 'not-writable'
  detail?: string
  summary?: DataSummary
}

// ---------------------------------------------------------------------------
// Modules and quizzes

export interface ModuleInput {
  name: string
  code: string | null
  colour: ModuleColour
  description: string | null
}

export interface ModuleRow {
  id: number
  name: string
  code: string | null
  colour: ModuleColour
  description: string | null
  createdAt: string
  archivedAt: string | null
  quizCount: number
  attemptCount: number
  average: number | null
  latest: number | null
  /** Change in points between the mean of the last three and the three before. */
  trend: number | null
  lastStudied: string | null
}

export interface QuizRow {
  id: number
  moduleId: number
  title: string
  description: string | null
  createdAt: string
  archivedAt: string | null
  versionNo: number
  questionCount: number
  totalMarks: number
  attemptCount: number
  best: number | null
  latest: number | null
  average: number | null
  lastAttempted: string | null
  inProgressAttemptId: number | null
}

export interface QuizVersionInfo {
  id: number
  versionNo: number
  sourceFilename: string | null
  questionCount: number
  totalMarks: number
  importedAt: string
  singleCount: number
  multiCount: number
  writtenCount: number
  topics: string[]
}

export interface QuizDetail {
  quiz: QuizRow
  module: { id: number; name: string; code: string | null; colour: ModuleColour }
  version: QuizVersionInfo
  versions: QuizVersionInfo[]
  best: { percentage: number; attemptNumber: number; submittedAt: string } | null
  last: { percentage: number; attemptNumber: number; submittedAt: string } | null
  attempts: AttemptListRow[]
  timing: QuizTiming
  /** For AI-generated quizzes: what the latest version was made from. */
  generation: GenerationInfo | null
}

export interface QuizTiming {
  /** Each question in the current version, with averages over every official attempt at the same prompt. */
  questions: {
    position: number
    prompt: string
    topic: string | null
    type: QuestionType
    seen: number
    perQuestion: number | null
    accuracy: number | null
  }[]
  topics: { topic: string; perQuestion: number; seconds: number; accuracy: number; answered: number }[]
  attempts: { attemptNumber: number; submittedAt: string; durationSeconds: number; percentage: number; perQuestion: number }[]
}

// ---------------------------------------------------------------------------
// CSV import

export interface CsvIssue {
  /** 1-based row number as a spreadsheet would show it (header is row 1). */
  row: number | null
  column: string | null
  message: string
  fix: string
}

export interface ParsedOption {
  label: OptionLabel
  text: string
  isCorrect: boolean
}

/** One creditworthy point in a written question's mark scheme. */
export interface MarkPoint {
  text: string
  marks: number
}

export interface ParsedQuestion {
  row: number
  prompt: string
  type: QuestionType
  /** Written questions only. */
  modelAnswer?: string | null
  markScheme?: MarkPoint[]
  marks: number
  explanation: string | null
  topic: string | null
  options: ParsedOption[]
}

export interface ImportPreview {
  ok: boolean
  errors: CsvIssue[]
  filename: string
  sha256: string
  suggestedTitle: string
  questionCount: number
  totalMarks: number
  singleCount: number
  multiCount: number
  writtenCount: number
  topics: string[]
  sample: ParsedQuestion[]
  /** A quiz in the chosen module already has this exact content. */
  duplicateOf: { quizId: number; title: string; versionNo: number } | null
  /** Every quiz already in the module, so the title can be checked as it is edited. */
  moduleQuizzes: { quizId: number; title: string; versionNo: number }[]
}

export interface ImportRequest {
  moduleId: number
  filename: string
  text: string
  title: string
  mode: 'new' | 'version'
  targetQuizId: number | null
  /** Present when the quiz was generated by AI: what it came from. */
  generation?: GenerationRecord | null
}

export interface GenerationRecord {
  topic: string
  count: number
  difficulty: Difficulty
  format: GenerateFormat
  instructions: string | null
  model: string
  extended: boolean
  materialIds: number[]
  oneOffNames: string[]
}

export interface ImportResult {
  quizId: number
  versionNo: number
  title: string
}

// ---------------------------------------------------------------------------
// Attempts

export interface AttemptSettings {
  shuffleQuestions: boolean
  shuffleOptions: boolean
  feedback: FeedbackMode
  timeLimitMinutes: number | null
  marking: MarkingMode
  /** Mark written answers with the AI when submitted (needs a key). Otherwise you mark them yourself. */
  aiMarking?: boolean
  /** Which questions to include when a quiz mixes formats. */
  questionTypes?: 'all' | 'choice' | 'written'
}

export interface StartAttemptRequest {
  quizId: number
  settings: AttemptSettings
  /** Practice runs restricted to the questions missed in this attempt. */
  practiceFromAttemptId: number | null
  /** Abandon an existing in-progress attempt for this quiz first. */
  replaceInProgress: boolean
}

export interface SessionOption {
  id: number
  label: OptionLabel
  text: string
}

export interface SessionQuestion {
  id: number
  displayPosition: number
  prompt: string
  type: QuestionType
  marks: number
  topic: string | null
  options: SessionOption[]
  selected: number[]
  flagged: boolean
  timeSpent: number
  /** Written questions: the answer typed so far. */
  writtenAnswer: string
  /** Present once feedback has been revealed for this question. */
  feedback: QuestionFeedback | null
}

export interface QuestionFeedback {
  correctOptionIds: number[]
  marksAwarded: number
  isCorrect: boolean
  explanation: string | null
  written?: WrittenReview
}

export interface WrittenReview {
  modelAnswer: string
  markScheme: MarkPoint[]
  /** Null until the answer has been marked. */
  marking: WrittenMarking | null
}

export interface AttemptSession {
  id: number
  quizId: number
  quizTitle: string
  moduleName: string
  moduleColour: ModuleColour
  versionNo: number
  isPractice: boolean
  projectedAttemptNumber: number | null
  settings: AttemptSettings
  startedAt: string
  durationSeconds: number
  currentPosition: number
  marksAvailable: number
  questions: SessionQuestion[]
}

export interface AnswerRequest {
  attemptId: number
  questionId: number
  selected: number[]
}

export interface TickRequest {
  attemptId: number
  questionId: number | null
  seconds: number
  position: number
  /** True when the question has just been shown, to count visits. */
  visit?: boolean
}

export interface AttemptListRow {
  id: number
  quizId: number
  quizTitle: string
  moduleId: number
  moduleName: string
  moduleColour: ModuleColour
  versionNo: number
  attemptNumber: number | null
  isPractice: boolean
  status: AttemptStatus
  markingMode: MarkingMode
  startedAt: string
  submittedAt: string | null
  durationSeconds: number
  marksAwarded: number | null
  marksAvailable: number
  percentage: number | null
  questionCount: number
}

export interface ReviewQuestion {
  id: number
  displayPosition: number
  prompt: string
  type: QuestionType
  marks: number
  topic: string | null
  explanation: string | null
  options: (SessionOption & { isCorrect: boolean })[]
  selected: number[]
  marksAwarded: number
  isCorrect: boolean
  answered: boolean
  timeSpent: number
  flagged: boolean
  visits: number
  answerChanges: number
  writtenAnswer: string | null
  written: WrittenReview | null
  /** Active seconds on the question before the first option was chosen. */
  firstAnswerSeconds: number | null
}

export interface TopicTiming {
  topic: string
  seconds: number
  share: number
  questions: number
  perQuestion: number
  percentage: number
}

export interface AttemptTiming {
  questionSeconds: number
  perQuestion: number
  median: number
  rightPerQuestion: number | null
  wrongPerQuestion: number | null
  answerChanges: number
  topics: TopicTiming[]
}

export interface AttemptResult {
  attempt: AttemptListRow
  settings: AttemptSettings
  previous: { attemptNumber: number; percentage: number } | null
  best: { attemptNumber: number; percentage: number } | null
  topics: { topic: string; awarded: number; available: number; percentage: number; questions: number }[]
  questions: ReviewQuestion[]
  wrongCount: number
  timing: AttemptTiming
  /** Written answers still waiting to be marked. */
  needsMarking: number
}

// ---------------------------------------------------------------------------
// Analytics

export type DateRange = '30d' | '90d' | '1y' | 'all'

export interface ScorePoint {
  attemptId: number
  submittedAt: string
  percentage: number
  quizTitle: string
  moduleId: number
  moduleName: string
  moduleColour: ModuleColour
  attemptNumber: number
}

export interface MissedQuestion {
  quizId: number
  quizTitle: string
  moduleName: string
  prompt: string
  topic: string | null
  seen: number
  missed: number
}

export interface TopicStat {
  topic: string
  moduleId: number
  moduleName: string
  awarded: number
  available: number
  percentage: number
  answered: number
}

export interface Dashboard {
  headline: {
    kind: 'empty' | 'recent' | 'recent-with-change' | 'stale'
    average: number | null
    change: number | null
    attemptsInWindow: number
    daysSinceLast: number | null
  }
  series: ScorePoint[]
  inProgress: AttemptListRow[]
  modules: ModuleRow[]
  missed: MissedQuestion[]
  topics: TopicStat[]
  recent: AttemptListRow[]
  totals: { attempts: number; questionsAnswered: number; secondsStudied: number }
  hasAnyQuiz: boolean
  hasAnyModule: boolean
  patterns: DashboardPatterns
}

export interface DashboardPatterns {
  /** One entry per local day for the last 12 weeks, oldest first. */
  activity: { date: string; seconds: number; attempts: number }[]
  timeByModule: { moduleId: number; name: string; colour: ModuleColour; seconds: number; attempts: number }[]
  /** Counts of official scores in ten-point bands: 0–9, 10–19, … 90–100. */
  distribution: number[]
  topicTime: { topic: string; moduleName: string; perQuestion: number; accuracy: number; answered: number }[]
  types: { type: QuestionType; answered: number; accuracy: number; perQuestion: number }[]
  weekly: { weekStart: string; attempts: number; seconds: number; average: number | null }[]
}

export interface ModuleDetail {
  module: ModuleRow
  quizzes: QuizRow[]
  series: ScorePoint[]
  attempts: AttemptListRow[]
  weakestQuizzes: QuizRow[]
  topics: TopicStat[]
  missed: MissedQuestion[]
  topicTime: DashboardPatterns['topicTime']
}

export interface HistoryFilter {
  moduleId: number | null
  quizId: number | null
  from: string | null
  to: string | null
  minScore: number | null
  maxScore: number | null
  includePractice: boolean
}

// ---------------------------------------------------------------------------
// Data management

export interface BackupInfo {
  filename: string
  createdAt: string
  bytes: number
  reason: string
}

export interface DataInfo {
  dataDir: string
  dbPath: string
  dbBytes: number
  backups: BackupInfo[]
  summary: DataSummary
}

export interface UpdateInfo {
  current: string
  latest: string | null
  newer: boolean
  notes: string | null
  publishedAt: string | null
  pageUrl: string | null
  download: { name: string; url: string; bytes: number } | null
}

export interface RestoreCheck {
  token: string
  filename: string
  summary: DataSummary
  schemaVersion: number
}

// ---------------------------------------------------------------------------
// AI quiz generation and written-answer marking

export type GenerateFormat = 'choice' | 'mixed' | 'written'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'mixed'

export interface AiStatus {
  configured: boolean
  keyHint: string | null
  model: string | null
  aiMarking: boolean
  /** Linux only: which secret store protects the key ("basic_text" means weak protection). */
  backend: string
}

export interface AiModel {
  id: string
  name: string
  free: boolean
  contextLength: number
}

export interface SourceFile {
  token: string
  name: string
  kind: string
  chars: number
}

export interface GenerateRequest {
  moduleId: number
  topic: string
  count: number
  difficulty: Difficulty
  format: GenerateFormat
  instructions: string | null
  /** One-off files that are not saved to the module. */
  sourceTokens: string[]
  /** Saved module materials to base the quiz on. */
  materialIds: number[]
  /** Add new questions to this quiz's latest version instead of writing a fresh set. */
  extendQuizId: number | null
}

/** How a quiz version was generated, so it can be regenerated or extended later. */
export interface GenerationInfo {
  topic: string
  count: number
  difficulty: Difficulty
  format: GenerateFormat
  instructions: string | null
  model: string
  extended: boolean
  materials: { materialId: number | null; label: string; filename: string; available: boolean }[]
}

export interface MaterialRow {
  id: number
  moduleId: number
  label: string
  filename: string
  kind: string
  bytes: number
  chars: number
  addedAt: string
  /** Quiz versions generated from this material. */
  usedBy: number
  lastUsed: string | null
  hasCopy: boolean
}

export interface GenerateResult {
  preview: ImportPreview
  csv: string
  filename: string
  model: string
  /** Questions removed because they still broke the rules after a repair attempt. */
  dropped: number
  /** The material was longer than the limit and was shortened. */
  truncated: boolean
  /** Pass back to import:commit so the quiz remembers its sources. */
  generation: GenerationRecord
  /** When extending: how many questions were added to the existing ones. */
  added: number | null
}

export interface PointMark {
  awarded: number
  evidence: string
  reason: string
}

export interface WrittenMarking {
  points: PointMark[]
  feedback: string
  markedBy: 'ai' | 'self' | 'auto'
  model: string | null
  markedAt: string
  /** The student changed a mark after it was given. */
  edited: boolean
}
