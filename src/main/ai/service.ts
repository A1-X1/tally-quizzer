import { randomUUID } from 'node:crypto'
import type { DB } from '../db/connection'
import type { AiModel, GenerateRequest, GenerateResult, SourceFile } from '../../shared/types'
import { previewImport } from '../services/quizzes'
import { getModule } from '../services/modules'
import * as attempts from '../services/attempts'
import { UserError } from '../services/rows'
import { aiSettings, loadKey, setModel } from './keystore'
import { AiError, chat, chatOnce, listModels, type ModelInfo } from './openrouter'
import { combineSources, extractSource, type ExtractedSource } from './extract'
import { buildGenerationMessages, buildRepairMessages, generatedToCsv, keepValidRows } from './generate'
import { buildMarkingMessages, parseMarking } from './mark'

const sources = new Map<string, ExtractedSource>()
let modelCache: { at: number; list: ModelInfo[] } | null = null

export async function models(): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.list
  const list = await listModels()
  modelCache = { at: Date.now(), list }
  return list
}

export function toAiModels(list: ModelInfo[]): AiModel[] {
  return list.map(({ id, name, free, contextLength }) => ({ id, name, free, contextLength }))
}

export function requireAi(): { key: string; model: string } {
  const key = loadKey()
  if (!key) throw new UserError('Add an OpenRouter key in Settings to use AI features.', 'NO_AI')
  const model = aiSettings().model
  if (!model) throw new UserError('Choose an AI model in Settings first.', 'NO_AI')
  return { key, model }
}

/** Send a tiny request to check a model answers for this account. */
export async function testModel(key: string, model: string): Promise<{ ok: true; seconds: number } | { ok: false; error: string }> {
  const start = Date.now()
  try {
    await chatOnce(key, model, [{ role: 'user', content: 'Reply with the word ready.' }], { maxTokens: 400, temperature: 0, timeoutMs: 45_000 })
    return { ok: true, seconds: Math.round((Date.now() - start) / 100) / 10 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Choose a free model that actually answers for this key (account settings can block some). */
export async function ensureModel(): Promise<string | null> {
  const s = aiSettings()
  if (s.model) return s.model
  const key = loadKey()
  try {
    const list = await models()
    const candidates = rankFreeModels(list).slice(0, 5)
    if (key) {
      for (const id of candidates) {
        const t = await testModel(key, id)
        if (t.ok) {
          setModel(id)
          return id
        }
      }
    }
    const fallback = candidates[0] ?? null
    if (fallback) setModel(fallback)
    return fallback
  } catch {
    return null
  }
}

export function rankFreeModels(list: ModelInfo[]): string[] {
  const free = list.filter((m) => m.free && m.contextLength >= 32_000)
  const preferred = [/nemotron-3-ultra/i, /gemma-4-31b/i, /deepseek/i, /llama-4|llama-3\.3-70b/i, /qwen3/i, /gemma/i, /mistral/i, /nemotron/i]
  const ranked: string[] = []
  for (const re of preferred) for (const m of free) if (re.test(m.id) && !ranked.includes(m.id)) ranked.push(m.id)
  for (const m of [...free].sort((a, b) => b.contextLength - a.contextLength)) if (!ranked.includes(m.id)) ranked.push(m.id)
  return ranked
}

// ----- Source files -----

export async function addSource(name: string, bytes: Uint8Array): Promise<SourceFile> {
  const ex = await extractSource(name, bytes)
  const token = randomUUID()
  sources.set(token, ex)
  if (sources.size > 40) sources.delete(sources.keys().next().value as string)
  return { token, name: ex.name, kind: ex.kind, chars: ex.chars }
}

export function dropSource(token: string): void {
  sources.delete(token)
}

// ----- Generation -----

function friendly(e: unknown): never {
  if (e instanceof AiError || e instanceof UserError) throw new UserError(e.message, 'AI')
  throw new UserError(`The AI request failed: ${e instanceof Error ? e.message : String(e)}`, 'AI')
}

export async function generate(db: DB, req: GenerateRequest): Promise<GenerateResult> {
  getModule(db, req.moduleId)
  const { key, model } = requireAi()
  const chosen = req.sourceTokens.map((t) => {
    const s = sources.get(t)
    if (!s) throw new UserError('A file you added has expired. Remove it and add it again.')
    return s
  })
  const { material, truncated } = combineSources(chosen)
  const info = (modelCache?.list ?? []).find((m) => m.id === model)
  const messages = buildGenerationMessages(req, chosen.length ? material : null)
  const opts = { temperature: 0.5, maxTokens: 16_000, json: info?.structured ?? false }

  let answer: string
  try {
    answer = await chat(key, model, messages, opts)
  } catch (e) {
    friendly(e)
  }
  let result = generatedToCsv(answer)
  if (result.issues.length > 0) {
    // One repair round: tell the model exactly what was wrong.
    try {
      const repaired = await chat(key, model, [...messages, ...buildRepairMessages(answer, result.repairNotes)], opts)
      const second = generatedToCsv(repaired)
      if (second.questionCount > 0 && second.issues.length <= result.issues.length) result = second
    } catch {
      /* keep the first attempt and drop invalid rows below */
    }
  }
  const { csv, dropped } = keepValidRows(result.csv)
  const title = (result.title || req.topic).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'AI quiz'
  const filename = `${title}.csv`
  const preview = previewImport(db, req.moduleId, filename, csv)
  if (!preview.ok || preview.questionCount === 0) {
    throw new UserError(
      'The AI did not produce any usable questions. Try again, give a clearer topic, or choose a different model.',
      'AI'
    )
  }
  return { preview: { ...preview, suggestedTitle: title }, csv, filename, model, dropped, truncated }
}

// ----- Marking written answers -----

export async function markOne(db: DB, attemptId: number, questionId: number): Promise<void> {
  const { key, model } = requireAi()
  const item = attempts.unmarkedWritten(db, attemptId).find((x) => x.questionId === questionId)
  if (!item) return
  let reply: string
  try {
    reply = await chat(key, model, buildMarkingMessages(item.prompt, item.marks, item.scheme, item.modelAnswer, item.answer), {
      temperature: 0,
      maxTokens: 2_000,
      json: (modelCache?.list ?? []).find((m) => m.id === model)?.structured ?? false,
      timeoutMs: 120_000
    })
  } catch (e) {
    friendly(e)
  }
  let marking
  try {
    marking = parseMarking(reply, item.scheme, model)
  } catch {
    // One retry with a firm reminder of the format.
    const again = await chat(
      key,
      model,
      [
        ...buildMarkingMessages(item.prompt, item.marks, item.scheme, item.modelAnswer, item.answer),
        { role: 'assistant', content: reply.slice(0, 4000) },
        { role: 'user', content: 'Return only the JSON object in the required shape.' }
      ],
      { temperature: 0, maxTokens: 2_000 }
    )
    marking = parseMarking(again, item.scheme, model)
  }
  attempts.applyMarking(db, attemptId, questionId, marking)
}

/** Mark every unmarked written answer in an attempt, a few at a time. Failures are left for self-marking. */
export async function markAll(db: DB, attemptId: number): Promise<{ failed: number }> {
  const pending = attempts.unmarkedWritten(db, attemptId)
  let failed = 0
  const queue = [...pending]
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        await markOne(db, attemptId, item.questionId)
      } catch {
        failed++
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return { failed }
}
