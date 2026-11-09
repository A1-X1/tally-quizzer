import { net } from 'electron'

export const OPENROUTER_API = 'https://openrouter.ai/api/v1/'

let inFlight = 0

/** The network filter admits OpenRouter only while Tally itself is making an AI request. */
export function isAllowedAiRequest(url: string): boolean {
  return inFlight > 0 && url.startsWith(OPENROUTER_API)
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelInfo {
  id: string
  name: string
  free: boolean
  contextLength: number
  structured: boolean
}

export class AiError extends Error {
  constructor(
    message: string,
    public code: 'KEY' | 'CREDITS' | 'RATE' | 'NETWORK' | 'MODEL' | 'OUTPUT' | 'UPSTREAM' | 'OTHER'
  ) {
    super(message)
  }
}

async function call(path: string, init: { method?: string; key?: string | null; body?: unknown; timeoutMs?: number }): Promise<unknown> {
  inFlight++
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000)
  try {
    let res: Response
    try {
      res = await net.fetch(`${OPENROUTER_API}${path}`, {
        method: init.method ?? 'GET',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/A1-X1/tally-quizzer',
          'X-Title': 'Tally',
          ...(init.key ? { Authorization: `Bearer ${init.key}` } : {})
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      })
    } catch (e) {
      if (ctrl.signal.aborted) throw new AiError('The AI took too long to answer. Try again, or pick a faster model.', 'NETWORK')
      throw new AiError('Tally could not reach OpenRouter. Check your internet connection.', 'NETWORK')
    }
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!res.ok) {
      const msg = (body as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 200)
      if (res.status === 401) throw new AiError('OpenRouter did not accept this key. Check it was copied in full.', 'KEY')
      if (res.status === 402) throw new AiError('Your OpenRouter account is out of credit for this model. Choose a free model, or add credit.', 'CREDITS')
      if (res.status === 429) throw new AiError('The model is busy or you have hit its rate limit. Wait a minute, or choose another model.', 'RATE')
      if (/guardrail|allowed providers|data policy|privacy/i.test(msg)) {
        throw new AiError(
          'Your OpenRouter account settings (privacy, allowed providers or guardrails) block this model. Choose another model, or change those settings on OpenRouter.',
          'MODEL'
        )
      }
      if (res.status === 404 || res.status === 400) throw new AiError(`The model could not handle this request: ${msg.slice(0, 200)}`, 'MODEL')
      if (res.status >= 500) throw new AiError('The model’s provider failed to answer. Try again, or choose another model.', 'UPSTREAM')
      throw new AiError(`OpenRouter returned an error (${res.status}): ${msg}`, 'OTHER')
    }
    return body
  } finally {
    clearTimeout(timer)
    inFlight--
  }
}

export async function verifyKey(key: string): Promise<{ label: string; limitRemaining: number | null; freeTier: boolean }> {
  const body = (await call('key', { key })) as { data?: { label?: string; limit_remaining?: number | null; is_free_tier?: boolean } }
  return {
    label: body.data?.label ?? 'OpenRouter key',
    limitRemaining: body.data?.limit_remaining ?? null,
    freeTier: body.data?.is_free_tier ?? false
  }
}

export async function listModels(): Promise<ModelInfo[]> {
  const body = (await call('models', {})) as {
    data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[]; architecture?: { output_modalities?: string[] } }[]
  }
  return (body.data ?? [])
    .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      free: m.id.endsWith(':free') || (Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0),
      contextLength: m.context_length ?? 0,
      structured: (m.supported_parameters ?? []).includes('response_format')
    }))
    .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name))
}

/** Chat, retrying once after a short pause when the provider fails or times out. */
export async function chat(
  key: string,
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number } = {}
): Promise<string> {
  try {
    return await chatOnce(key, model, messages, opts)
  } catch (e) {
    if (e instanceof AiError && (e.code === 'UPSTREAM' || e.code === 'OUTPUT')) {
      await new Promise((r) => setTimeout(r, 2500))
      return chatOnce(key, model, messages, opts)
    }
    throw e
  }
}

export async function chatOnce(
  key: string,
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number } = {}
): Promise<string> {
  const body = (await call('chat/completions', {
    method: 'POST',
    key,
    timeoutMs: opts.timeoutMs ?? 240_000,
    body: {
      model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 12_000,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {})
    }
  })) as { choices?: { message?: { content?: string | null; reasoning?: string | null } }[]; error?: { message?: string } }
  if (body.error?.message) throw new AiError(body.error.message, 'OTHER')
  const content = body.choices?.[0]?.message?.content
  if (!content || !content.trim()) throw new AiError('The model returned an empty answer. Try again or choose another model.', 'OUTPUT')
  return content
}
