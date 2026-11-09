import { useState } from 'react'
import type { AiStatus } from '../../../shared/types'
import { api } from '../api'
import { AiConnection, ChatGuides } from '../components/AiSetup'
import { Icon } from '../components/Icon'

/** Shown once, after the data folder is chosen: how the user wants to make quizzes. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [path, setPath] = useState<'ai' | 'chat' | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const finish = async (): Promise<void> => {
    await api('onboarding:done')
    onDone()
  }
  return (
    <div className="onboarding" data-testid="onboarding">
      <div className="onboarding-hero">
        <p className="eyebrow">Step 2 of 2</p>
        <h1 className="welcome-title onboarding-title">
          Quizzes from
          <br />
          <span className="hl">your notes.</span>
        </h1>
        <p className="welcome-lede">
          Tally can write a quiz from a topic and your lecture slides, notes or PDFs, and mark written answers against a
          mark scheme. Connect an AI key, or use the AI chat you already have.
        </p>
        <button type="button" className="btn btn-ghost" onClick={finish} data-testid="skip-onboarding">
          Skip for now <Icon name="arrowRight" size={16} />
        </button>
      </div>

      <div className="onboarding-options">
        <button
          type="button"
          className={path === 'ai' ? 'path-card is-on' : 'path-card'}
          onClick={() => setPath('ai')}
          aria-expanded={path === 'ai'}
          data-testid="path-ai"
        >
          <span className="path-tag">Easiest</span>
          <span className="path-title">Generate quizzes in Tally</span>
          <span className="path-body">
            Add an OpenRouter key once. Then describe a topic, add files, and Tally writes and checks the quiz. Free
            models are available.
          </span>
        </button>
        {path === 'ai' ? (
          <div className="path-panel">
            <AiConnection onChange={setStatus} />
          </div>
        ) : null}

        <button
          type="button"
          className={path === 'chat' ? 'path-card is-on' : 'path-card'}
          onClick={() => setPath('chat')}
          aria-expanded={path === 'chat'}
          data-testid="path-chat"
        >
          <span className="path-title">Use Claude, ChatGPT or Gemini</span>
          <span className="path-body">
            No key needed. Paste Tally’s prompt into the AI chat you already use, save its answer as a CSV file and import
            it.
          </span>
        </button>
        {path === 'chat' ? (
          <div className="path-panel">
            <ChatGuides />
          </div>
        ) : null}

        <div className="onboarding-foot">
          <button type="button" className="btn btn-primary btn-lg" onClick={finish} data-testid="finish-onboarding">
            {status?.configured ? 'Start using Tally' : 'Continue'} <Icon name="arrowRight" size={18} />
          </button>
          <p className="faint small">You can change this any time in Settings and Help.</p>
        </div>
      </div>
    </div>
  )
}
