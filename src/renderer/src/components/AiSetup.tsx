import { useEffect, useMemo, useState } from 'react'
import type { AiModel, AiStatus } from '../../../shared/types'
import { CHOICE_PROMPT, WRITTEN_PROMPT } from '../../../shared/prompts'
import { api, errorMessage } from '../api'
import { Icon } from './Icon'
import { ErrorNote, Segmented, Toggle, useToast } from './ui'

export const PRIVACY_NOTE =
  'When you generate or mark with AI, the topic, the text of the files you add and your written answers are sent to OpenRouter and the model provider you choose. Nothing else leaves this computer.'

/** Paste and verify an OpenRouter key. */
export function KeyForm({ onSaved, compact = false }: { onSaved: (s: AiStatus) => void; compact?: boolean }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('ai:saveKey', { key })
      setKey('')
      onSaved(await api('ai:status'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="key-form" onSubmit={save}>
      {!compact ? (
        <ol className="key-steps">
          <li>
            <span className="step-n num">1</span>
            <div>
              <p className="step-title">Create a free OpenRouter account</p>
              <p className="muted small">OpenRouter gives one key for many AI models, including free ones.</p>
            </div>
          </li>
          <li>
            <span className="step-n num">2</span>
            <div>
              <p className="step-title">Create a key</p>
              <p className="muted small">
                In OpenRouter, open <strong>Settings → Keys</strong>, choose <strong>Create key</strong>, name it “Tally”
                and copy it. It starts with <span className="mono">sk-or-</span> and is only shown once.
              </p>
              <button type="button" className="btn btn-ghost btn-sm key-link" onClick={() => void api('ai:openKeysPage')}>
                <Icon name="external" size={14} /> Open OpenRouter keys page
              </button>
            </div>
          </li>
          <li>
            <span className="step-n num">3</span>
            <div>
              <p className="step-title">Paste it here</p>
              <p className="muted small">Tally checks it, then stores it on this computer only (encrypted by the system keychain where available), never in your data folder.</p>
            </div>
          </li>
        </ol>
      ) : null}
      <div className="key-row">
        <label className="sr-only" htmlFor="ai-key">
          OpenRouter key
        </label>
        <input
          id="ai-key"
          className="input mono key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-or-v1-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          data-testid="ai-key"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || key.trim().length < 10} data-testid="save-key">
          {busy ? 'Checking…' : 'Check and save'}
        </button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <p className="faint small">{PRIVACY_NOTE}</p>
    </form>
  )
}

/** Choose the model for generating and marking. Free models are listed first. */
export function ModelPicker({ current, onChange }: { current: string | null; onChange: (id: string) => void }) {
  const [models, setModels] = useState<AiModel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'free' | 'all'>('free')
  const [query, setQuery] = useState('')
  useEffect(() => {
    api('ai:models')
      .then(setModels)
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [])
  const shown = useMemo(
    () =>
      (models ?? [])
        .filter((m) => (filter === 'free' ? m.free : true))
        .filter((m) => !query || `${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 80),
    [models, filter, query]
  )
  if (error) return <ErrorNote>{error}</ErrorNote>
  return (
    <div className="model-picker">
      <div className="model-tools">
        <Segmented
          label="Models to show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'free', label: 'Free' },
            { value: 'all', label: 'All' }
          ]}
        />
        <input className="input" placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search models" />
      </div>
      {!models ? (
        <p className="muted small">Loading models from OpenRouter…</p>
      ) : (
        <select
          className="select model-select"
          value={current ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Model"
          size={Math.min(8, Math.max(3, shown.length))}
          data-testid="model-select"
        >
          {current && !shown.some((m) => m.id === current) ? <option value={current}>{current} (current)</option> : null}
          {shown.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.free ? ' · free' : ''} · {Math.round(m.contextLength / 1000)}k context
            </option>
          ))}
        </select>
      )}
      <p className="faint small">
        Free models cost nothing but allow a limited number of requests a day and can be slower or busy. Paid models
        use credit you add on OpenRouter.
      </p>
    </div>
  )
}

/** Everything about the AI connection, used in onboarding and Settings. */
export function AiConnection({ onChange }: { onChange?: (s: AiStatus) => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [changing, setChanging] = useState(false)
  const [test, setTest] = useState<{ model: string; state: string; ok?: boolean } | null>(null)
  const toast = useToast()
  const refresh = async (): Promise<void> => {
    const s = await api('ai:status')
    setStatus(s)
    onChange?.(s)
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!status) return null
  if (!status.configured || changing) {
    return (
      <KeyForm
        compact={changing}
        onSaved={(s) => {
          setStatus(s)
          setChanging(false)
          onChange?.(s)
          toast('Key saved. AI features are on.', 'good')
        }}
      />
    )
  }
  return (
    <div className="ai-connected" data-testid="ai-connected">
      <div className="setting">
        <div>
          <p className="setting-name">
            <Icon name="check" size={16} /> Connected to OpenRouter <span className="mono faint">{status.keyHint}</span>
          </p>
          {status.backend === 'file' ? (
            <p className="muted small">
              This computer has no keyring, so the key is kept in a file in Tally’s settings folder that only your user
              account can read. It is never put in your data folder.
            </p>
          ) : (
            <p className="muted small">The key is encrypted with this computer’s secure storage.</p>
          )}
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChanging(true)}>
            Change key
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-danger"
            onClick={async () => {
              await api('ai:forgetKey')
              await refresh()
              toast('Key removed from this computer.', 'info')
            }}
          >
            Remove key
          </button>
        </div>
      </div>
      <div className="setting setting-stack">
        <p className="setting-name">Model</p>
        <ModelPicker
          current={status.model}
          onChange={async (id) => {
            await api('ai:setModel', { model: id })
            await refresh()
            setTest({ model: id, state: 'testing' })
            const r = await api('ai:testModel', { model: id }).catch((e: unknown) => ({ ok: false as const, error: errorMessage(e) }))
            setTest({ model: id, state: r.ok ? `Answered in ${r.seconds}s.` : r.error, ok: r.ok })
          }}
        />
        {test ? (
          <p className={test.ok === false ? 'small bad' : test.ok ? 'small good' : 'small muted'} role="status" data-testid="model-test">
            {test.state === 'testing' ? `Checking ${test.model} answers…` : `${test.model}: ${test.state}`}
          </p>
        ) : null}
      </div>
      <div className="setting">
        <Toggle
          checked={status.aiMarking}
          onChange={async (v) => {
            await api('ai:setMarking', { on: v })
            await refresh()
          }}
          label="Mark written answers with AI by default"
          description="Uses the mark scheme, point by point. You can change any mark afterwards."
        />
      </div>
      <p className="faint small">{PRIVACY_NOTE}</p>
    </div>
  )
}

type Platform = 'claude' | 'chatgpt' | 'gemini'

const GUIDES: Record<Platform, { name: string; site: string; once: string[]; reuse: string[] }> = {
  claude: {
    name: 'Claude',
    site: 'claude.ai',
    once: [
      'Open claude.ai and start a new chat.',
      'Attach your notes with the + button (PDF, Word and slides all work), or paste them in.',
      'Paste the prompt below, fill in the [BRACKETS] and send.',
      'Ask for “a downloadable .csv file” if it shows a code block, or copy the code block (see saving, below).'
    ],
    reuse: [
      'Create a Project, open its instructions and paste the prompt there.',
      'Add your course notes to the project’s knowledge.',
      'From then on, a chat in that project only needs “15 questions on week 3, mixed difficulty”.'
    ]
  },
  chatgpt: {
    name: 'ChatGPT',
    site: 'chatgpt.com',
    once: [
      'Open chatgpt.com and start a new chat.',
      'Attach your notes with the + button, or paste them in.',
      'Paste the prompt below, fill in the [BRACKETS] and send.',
      'ChatGPT can usually give you a .csv file to download; ask for one if it shows a code block instead.'
    ],
    reuse: [
      'Create a Project and paste the prompt into its instructions, or put it in Customize ChatGPT.',
      'Add your notes as project files.',
      'Then just ask for the topic and number of questions each time.'
    ]
  },
  gemini: {
    name: 'Gemini',
    site: 'gemini.google.com',
    once: [
      'Open gemini.google.com and start a new chat.',
      'Upload your notes with the + button, or paste them in.',
      'Paste the prompt below, fill in the [BRACKETS] and send.',
      'Gemini may show the result as a table; ask for “the raw CSV in a single code block” and copy that.'
    ],
    reuse: [
      'Create a Gem and paste the prompt as its instructions.',
      'Add your notes as the Gem’s knowledge files.',
      'Open the Gem whenever you want a new quiz.'
    ]
  }
}

/** How to make quizzes in an AI chat the user already has, without a key. */
export function ChatGuides() {
  const [platform, setPlatform] = useState<Platform>('claude')
  const [kind, setKind] = useState<'choice' | 'written'>('choice')
  const [copied, setCopied] = useState(false)
  const g = GUIDES[platform]
  const prompt = kind === 'choice' ? CHOICE_PROMPT : WRITTEN_PROMPT
  const copy = async (): Promise<void> => {
    await api('help:copy', { text: prompt })
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }
  return (
    <div className="chat-guides">
      <div className="guide-tabs">
        <Segmented
          label="AI assistant"
          value={platform}
          onChange={setPlatform}
          options={[
            { value: 'claude', label: 'Claude' },
            { value: 'chatgpt', label: 'ChatGPT' },
            { value: 'gemini', label: 'Gemini' }
          ]}
        />
      </div>
      <div className="guide-cols">
        <div>
          <h4 className="mini-h">For one quiz in {g.name}</h4>
          <ol className="guide-list">
            {g.once.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="mini-h">To reuse it every time</h4>
          <ol className="guide-list">
            {g.reuse.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      </div>
      <div className="guide-save">
        <h4 className="mini-h">Saving the CSV</h4>
        <p className="muted small">
          Download the .csv file if offered. Otherwise copy the code block into a plain-text editor (Notepad, or
          TextEdit after <em>Format → Make Plain Text</em>) and save it as <span className="mono">quiz.csv</span> in
          UTF-8. Then choose <strong>New quiz → Import a file</strong>. Tally checks every row and tells you exactly what to
          fix.
        </p>
      </div>
      <div className="prompt-head">
        <Segmented
          label="Prompt"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'choice', label: 'Multiple choice' },
            { value: 'written', label: 'With written answers' }
          ]}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={copy} data-testid="copy-chat-prompt">
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      <pre className="prompt prompt-short" tabIndex={0} aria-label="Prompt to paste into the AI">
        <code>{prompt}</code>
      </pre>
    </div>
  )
}
