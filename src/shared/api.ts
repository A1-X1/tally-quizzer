import type {
  AnswerRequest,
  AttemptListRow,
  AttemptResult,
  AttemptSession,
  BootState,
  Dashboard,
  DataInfo,
  DateRange,
  FolderInspection,
  HistoryFilter,
  ImportPreview,
  ImportRequest,
  ImportResult,
  ModuleDetail,
  ModuleInput,
  ModuleRow,
  QuestionFeedback,
  QuizDetail,
  RestoreCheck,
  StartAttemptRequest,
  ThemePreference,
  TickRequest,
  UpdateInfo
} from './types'

/**
 * Every IPC channel, its request payload and its response.
 * The preload exposes exactly these, and the main process validates each payload.
 */
export interface IpcContract {
  'app:boot': [void, BootState]
  'app:version': [void, string]
  'app:openReleases': [void, void]
  'app:setTitleBarTheme': [{ dark: boolean }, void]
  'app:systemDark': [void, boolean]

  'setup:inspectDefault': [void, FolderInspection]
  'setup:pickFolder': [void, FolderInspection | null]
  'setup:create': [{ token: string }, BootState]
  'setup:useExisting': [{ token: string }, BootState]
  'setup:retry': [void, BootState]
  'setup:locate': [void, FolderInspection | null]

  'modules:list': [{ includeArchived: boolean }, ModuleRow[]]
  'modules:create': [ModuleInput, ModuleRow]
  'modules:update': [{ id: number; input: ModuleInput }, ModuleRow]
  'modules:archive': [{ id: number; archived: boolean }, void]
  'modules:delete': [{ id: number; confirmName: string }, void]
  'modules:detail': [{ id: number }, ModuleDetail]

  'quizzes:detail': [{ id: number }, QuizDetail]
  'quizzes:rename': [{ id: number; title: string; description: string | null }, void]
  'quizzes:archive': [{ id: number; archived: boolean }, void]
  'quizzes:delete': [{ id: number }, void]
  'quizzes:all': [void, { id: number; title: string; moduleId: number }[]]

  'import:pickFile': [void, { filename: string; text: string } | null]
  'import:preview': [{ moduleId: number; filename: string; text: string }, ImportPreview]
  'import:commit': [ImportRequest, ImportResult]
  'import:sample': [void, ImportResult & { moduleId: number }]

  'attempts:start': [StartAttemptRequest, AttemptSession]
  'attempts:session': [{ id: number }, AttemptSession]
  'attempts:answer': [AnswerRequest, void]
  'attempts:reveal': [{ attemptId: number; questionId: number }, QuestionFeedback]
  'attempts:flag': [{ attemptId: number; questionId: number; flagged: boolean }, void]
  'attempts:tick': [TickRequest, void]
  'attempts:submit': [{ id: number }, AttemptResult]
  'attempts:abandon': [{ id: number }, void]
  'attempts:result': [{ id: number }, AttemptResult]
  'attempts:inProgress': [void, AttemptListRow[]]

  'stats:dashboard': [{ moduleId: number | null; range: DateRange }, Dashboard]
  'history:list': [HistoryFilter, AttemptListRow[]]
  'history:export': [HistoryFilter, { saved: boolean; path?: string; rows?: number }]

  'updates:check': [void, UpdateInfo]
  'updates:open': [{ url: string }, void]
  'updates:getAutoCheck': [void, boolean]
  'updates:setAutoCheck': [{ enabled: boolean }, void]
  'settings:getTheme': [void, ThemePreference]
  'settings:setTheme': [{ theme: ThemePreference }, void]

  'data:info': [void, DataInfo]
  'data:showInFolder': [void, void]
  'data:move': [void, { moved: boolean; dataDir?: string }]
  'data:export': [void, { saved: boolean; path?: string }]
  'data:pickRestore': [void, RestoreCheck | null]
  'data:restore': [{ token: string }, { restored: boolean; backup: string }]
  'data:backupNow': [void, { filename: string }]

  'help:saveSample': [{ which: 'template' | 'example' }, { saved: boolean; path?: string }]
  'help:copy': [{ text: string }, void]
}

export type Channel = keyof IpcContract
export type Req<C extends Channel> = IpcContract[C][0]
export type Res<C extends Channel> = IpcContract[C][1]

export const CHANNELS = [
  'app:boot',
  'app:version',
  'app:openReleases',
  'app:setTitleBarTheme',
  'app:systemDark',
  'setup:inspectDefault',
  'setup:pickFolder',
  'setup:create',
  'setup:useExisting',
  'setup:retry',
  'setup:locate',
  'modules:list',
  'modules:create',
  'modules:update',
  'modules:archive',
  'modules:delete',
  'modules:detail',
  'quizzes:detail',
  'quizzes:rename',
  'quizzes:archive',
  'quizzes:delete',
  'quizzes:all',
  'import:pickFile',
  'import:preview',
  'import:commit',
  'import:sample',
  'attempts:start',
  'attempts:session',
  'attempts:answer',
  'attempts:reveal',
  'attempts:flag',
  'attempts:tick',
  'attempts:submit',
  'attempts:abandon',
  'attempts:result',
  'attempts:inProgress',
  'stats:dashboard',
  'history:list',
  'history:export',
  'updates:check',
  'updates:open',
  'updates:getAutoCheck',
  'updates:setAutoCheck',
  'settings:getTheme',
  'settings:setTheme',
  'data:info',
  'data:showInFolder',
  'data:move',
  'data:export',
  'data:pickRestore',
  'data:restore',
  'data:backupNow',
  'help:saveSample',
  'help:copy'
] as const satisfies readonly Channel[]

// Compile-time check that CHANNELS lists every channel in the contract.
type MissingChannels = Exclude<Channel, (typeof CHANNELS)[number]>
export const _allChannelsListed: MissingChannels extends never ? true : MissingChannels = true

export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }

export interface TallyBridge {
  platform: 'darwin' | 'win32' | 'linux' | string
  invoke<C extends Channel>(channel: C, ...args: Req<C> extends void ? [] : [Req<C>]): Promise<Res<C>>
  /** Called when the operating system switches between light and dark. Returns an unsubscribe function. */
  onSystemTheme(listener: (dark: boolean) => void): () => void
}

export const THEME_EVENT = 'tally:system-theme'

export const RELEASES_URL = 'https://github.com/A1-X1/tally-quizzer/releases'
export const MAX_CSV_BYTES = 2 * 1024 * 1024
export const MAX_QUESTIONS = 500
