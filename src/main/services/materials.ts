import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DB } from '../db/connection'
import { nowIso } from '../db/connection'
import type { GenerationInfo, GenerationRecord, MaterialRow } from '../../shared/types'
import { extractSource } from '../ai/extract'
import { getModule } from './modules'
import { UserError } from './rows'

/**
 * Study material saved to a module. The extracted text lives in the database (all
 * generation needs, and small). A readable copy of the original file is kept in
 * Tally Data/materials/<module>/, like the quizzes/ mirror: convenient, never required.
 */
export const MATERIAL_DIR = 'materials'

const safe = (s: string): string => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'Untitled'

interface RawMaterial {
  id: number
  module_id: number
  label: string
  filename: string
  kind: string
  bytes: number
  chars: number
  added_at: string
  copy_name: string | null
  used_by: number
  last_used: string | null
}

const SELECT = `
  SELECT m.id, m.module_id, m.label, m.filename, m.kind, m.bytes, m.chars, m.added_at, m.copy_name,
         (SELECT COUNT(DISTINCT x.quiz_version_id) FROM quiz_version_materials x WHERE x.material_id = m.id) AS used_by,
         (SELECT MAX(v.imported_at) FROM quiz_version_materials x JOIN quiz_versions v ON v.id = x.quiz_version_id
            WHERE x.material_id = m.id) AS last_used
  FROM materials m`

export function copyPath(dataDir: string, moduleName: string, copyName: string): string {
  return path.join(dataDir, MATERIAL_DIR, safe(moduleName), copyName)
}

function mapRow(r: RawMaterial, dataDir: string | null, moduleName: string): MaterialRow {
  return {
    id: r.id,
    moduleId: r.module_id,
    label: r.label,
    filename: r.filename,
    kind: r.kind,
    bytes: r.bytes,
    chars: r.chars,
    addedAt: r.added_at,
    usedBy: r.used_by,
    lastUsed: r.last_used,
    hasCopy: !!(dataDir && r.copy_name && fs.existsSync(copyPath(dataDir, moduleName, r.copy_name)))
  }
}

export function listMaterials(db: DB, dataDir: string | null, moduleId: number): MaterialRow[] {
  const m = getModule(db, moduleId)
  return (db.prepare(`${SELECT} WHERE m.module_id = ? ORDER BY m.added_at, m.id`).all(moduleId) as RawMaterial[]).map((r) =>
    mapRow(r, dataDir, m.name)
  )
}

export function getMaterial(db: DB, id: number): RawMaterial {
  const r = db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as RawMaterial | undefined
  if (!r) throw new UserError('That material no longer exists.', 'NOT_FOUND')
  return r
}

export function defaultLabel(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 120) || 'Untitled material'
}

/** Read a file, store its text in the module, and keep a readable copy. Refuses exact duplicates. */
export async function addMaterial(
  db: DB,
  dataDir: string | null,
  moduleId: number,
  filename: string,
  bytes: Uint8Array,
  label: string | null = null
): Promise<MaterialRow> {
  const mod = getModule(db, moduleId)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const dup = db.prepare('SELECT label FROM materials WHERE module_id = ? AND content_sha256 = ?').pluck().get(moduleId, sha) as
    | string
    | undefined
  if (dup) throw new UserError(`“${filename}” is already in ${mod.name} as “${dup}”.`, 'DUPLICATE')
  const ex = await extractSource(filename, bytes)

  let copyName: string | null = null
  if (dataDir) {
    try {
      const dir = path.join(dataDir, MATERIAL_DIR, safe(mod.name))
      fs.mkdirSync(dir, { recursive: true })
      const ext = path.extname(filename)
      const stem = safe(path.basename(filename, ext))
      let name = `${stem}${ext}`
      for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${stem} (${i})${ext}`
      fs.writeFileSync(path.join(dir, name), bytes)
      copyName = name
    } catch {
      copyName = null // The copy is a convenience; the text in the database is what matters.
    }
  }
  const info = db
    .prepare(
      `INSERT INTO materials (module_id, label, filename, kind, content_sha256, bytes, chars, text, copy_name, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(moduleId, (label?.trim() || defaultLabel(filename)).slice(0, 120), filename.slice(0, 255), ex.kind, sha, bytes.byteLength, ex.chars, ex.text, copyName, nowIso())
  return mapRow(getMaterial(db, Number(info.lastInsertRowid)), dataDir, mod.name)
}

export function renameMaterial(db: DB, id: number, label: string): void {
  getMaterial(db, id)
  const l = label.trim().replace(/\s+/g, ' ')
  if (!l) throw new UserError('Give the material a label.')
  db.prepare('UPDATE materials SET label = ? WHERE id = ?').run(l.slice(0, 120), id)
}

export function removeMaterial(db: DB, dataDir: string | null, id: number): void {
  const r = getMaterial(db, id)
  const mod = getModule(db, r.module_id)
  db.prepare('DELETE FROM materials WHERE id = ?').run(id)
  if (dataDir && r.copy_name) fs.rmSync(copyPath(dataDir, mod.name, r.copy_name), { force: true })
}

export function materialCopyPath(db: DB, dataDir: string, id: number): string | null {
  const r = getMaterial(db, id)
  if (!r.copy_name) return null
  const p = copyPath(dataDir, getModule(db, r.module_id).name, r.copy_name)
  return fs.existsSync(p) ? p : null
}

/** The text of chosen materials, all from one module. */
export function materialSources(db: DB, moduleId: number, ids: number[]): { name: string; kind: string; chars: number; text: string }[] {
  if (ids.length === 0) return []
  const rows = db
    .prepare(`SELECT id, module_id, label, filename, kind, chars, text FROM materials WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: number; module_id: number; label: string; filename: string; kind: string; chars: number; text: string }[]
  if (rows.length !== new Set(ids).size || rows.some((r) => r.module_id !== moduleId)) {
    throw new UserError('Some of the chosen materials are not in this module any more.')
  }
  return ids.map((id) => {
    const r = rows.find((x) => x.id === id)!
    return { name: `${r.label} (${r.filename})`, kind: r.kind, chars: r.chars, text: r.text }
  })
}

/** Record which materials a generated quiz version came from. */
export function recordGeneration(db: DB, versionId: number, g: GenerationRecord): void {
  const ins = db.prepare('INSERT INTO quiz_version_materials (quiz_version_id, material_id, label, filename) VALUES (?, ?, ?, ?)')
  for (const id of [...new Set(g.materialIds)]) {
    const r = db.prepare('SELECT label, filename FROM materials WHERE id = ?').get(id) as { label: string; filename: string } | undefined
    if (r) ins.run(versionId, id, r.label, r.filename)
  }
  for (const name of g.oneOffNames.slice(0, 20)) ins.run(versionId, null, defaultLabel(name), name.slice(0, 255))
  db.prepare('UPDATE quiz_versions SET generation_json = ? WHERE id = ?').run(
    JSON.stringify({
      topic: g.topic,
      count: g.count,
      difficulty: g.difficulty,
      format: g.format,
      instructions: g.instructions,
      model: g.model,
      extended: g.extended
    }),
    versionId
  )
}

export function generationInfo(db: DB, versionId: number): GenerationInfo | null {
  const json = db.prepare('SELECT generation_json FROM quiz_versions WHERE id = ?').pluck().get(versionId) as string | null | undefined
  if (!json) return null
  let g: Omit<GenerationInfo, 'materials'>
  try {
    g = JSON.parse(json) as Omit<GenerationInfo, 'materials'>
  } catch {
    return null
  }
  const materials = (
    db
      .prepare(
        `SELECT x.material_id, x.label, x.filename, m.id AS live FROM quiz_version_materials x
         LEFT JOIN materials m ON m.id = x.material_id WHERE x.quiz_version_id = ? ORDER BY x.id`
      )
      .all(versionId) as { material_id: number | null; label: string; filename: string; live: number | null }[]
  ).map((r) => ({ materialId: r.material_id, label: r.label, filename: r.filename, available: r.live !== null }))
  return { ...g, materials }
}
