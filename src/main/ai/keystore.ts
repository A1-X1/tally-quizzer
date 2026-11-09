import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The OpenRouter key lives on this computer only, encrypted with the operating
 * system's keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux) via
 * Electron's safeStorage. It is never written to the data folder, never synced,
 * and never sent to the renderer.
 */
interface StoredAi {
  keyEnc: string | null
  /** Only when the OS offers no secure storage (some Linux setups): kept in a file readable by this user only. */
  keyFile: string | null
  keyHint: string | null
  model: string | null
  aiMarking: boolean
}

const file = (): string => path.join(app.getPath('userData'), 'ai.json')

function read(): StoredAi {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<StoredAi>
    return {
      keyEnc: typeof raw.keyEnc === 'string' ? raw.keyEnc : null,
      keyFile: typeof raw.keyFile === 'string' ? raw.keyFile : null,
      keyHint: typeof raw.keyHint === 'string' ? raw.keyHint : null,
      model: typeof raw.model === 'string' ? raw.model : null,
      aiMarking: raw.aiMarking !== false
    }
  } catch {
    return { keyEnc: null, keyFile: null, keyHint: null, model: null, aiMarking: true }
  }
}

function write(s: StoredAi): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  const tmp = `${file()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file())
}

export function storageBackend(): string {
  try {
    return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os'
  } catch {
    return 'unknown'
  }
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable() && storageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

export function saveKey(key: string): void {
  const s = read()
  if (encryptionAvailable()) {
    s.keyEnc = safeStorage.encryptString(key).toString('base64')
    s.keyFile = null
  } else {
    s.keyEnc = null
    s.keyFile = key
  }
  s.keyHint = `…${key.slice(-4)}`
  write(s)
}

export function loadKey(): string | null {
  const s = read()
  if (s.keyFile) return s.keyFile
  if (!s.keyEnc) return null
  try {
    return safeStorage.decryptString(Buffer.from(s.keyEnc, 'base64'))
  } catch {
    return null
  }
}

export function forgetKey(): void {
  const s = read()
  s.keyEnc = null
  s.keyFile = null
  s.keyHint = null
  write(s)
}

export function aiSettings(): { configured: boolean; keyHint: string | null; model: string | null; aiMarking: boolean; backend: string } {
  const s = read()
  return {
    configured: !!(s.keyEnc || s.keyFile),
    keyHint: s.keyHint,
    model: s.model,
    aiMarking: s.aiMarking,
    backend: s.keyFile ? 'file' : storageBackend()
  }
}

export function setModel(model: string): void {
  const s = read()
  s.model = model
  write(s)
}

export function setAiMarking(on: boolean): void {
  const s = read()
  s.aiMarking = on
  write(s)
}
