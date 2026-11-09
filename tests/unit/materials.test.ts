import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDataFolder, DATA_FOLDER_NAME } from '../../src/main/storage'
import { createModule } from '../../src/main/services/modules'
import * as materials from '../../src/main/services/materials'
import { commitImport, quizDetail } from '../../src/main/services/quizzes'
import { questionsToCsv } from '../../src/main/ai/generate'
import { validateQuizCsv } from '../../src/main/csv/validate'
import { readSample, tmpDir } from './helpers'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

function setup() {
  const dataDir = path.join(tmpDir(), DATA_FOLDER_NAME)
  const db = createDataFolder(dataDir, '1.2.0')
  const m = createModule(db, { name: 'Cell Biology', code: null, colour: 'teal', description: null })
  return { db, dataDir, moduleId: m.id }
}

describe('module materials', () => {
  it('stores extracted text in the database and a readable copy in the data folder', async () => {
    const { db, dataDir, moduleId } = setup()
    const row = await materials.addMaterial(db, dataDir, moduleId, 'week_1-membranes.md', enc('# Membranes\nThe phospholipid bilayer is selectively permeable.'))
    expect(row).toMatchObject({ label: 'Week 1-membranes', kind: 'md', usedBy: 0, hasCopy: true })
    expect(fs.existsSync(path.join(dataDir, 'materials', 'Cell Biology', 'week_1-membranes.md'))).toBe(true)
    const text = db.prepare('SELECT text FROM materials WHERE id = ?').pluck().get(row.id) as string
    expect(text).toMatch(/selectively permeable/)
  })

  it('refuses the same file twice in a module, but allows it in another', async () => {
    const { db, dataDir, moduleId } = setup()
    await materials.addMaterial(db, dataDir, moduleId, 'a.txt', enc('Osmosis is the movement of water across a membrane.'))
    await expect(materials.addMaterial(db, dataDir, moduleId, 'copy.txt', enc('Osmosis is the movement of water across a membrane.'))).rejects.toThrow(/already in Cell Biology/)
    const other = createModule(db, { name: 'Other', code: null, colour: 'cobalt', description: null })
    await expect(materials.addMaterial(db, dataDir, other.id, 'a.txt', enc('Osmosis is the movement of water across a membrane.'))).resolves.toBeTruthy()
  })

  it('keeps distinct copies for files with the same name, renames and removes', async () => {
    const { db, dataDir, moduleId } = setup()
    const a = await materials.addMaterial(db, dataDir, moduleId, 'notes.txt', enc('Week one notes about diffusion and osmosis.'))
    const b = await materials.addMaterial(db, dataDir, moduleId, 'notes.txt', enc('Week two notes about active transport and pumps.'))
    expect(fs.existsSync(path.join(dataDir, 'materials', 'Cell Biology', 'notes (2).txt'))).toBe(true)
    materials.renameMaterial(db, a.id, '  Week 1 –   Membranes ')
    expect(materials.listMaterials(db, dataDir, moduleId).map((m) => m.label)).toEqual(['Week 1 – Membranes', 'Notes'])
    expect(() => materials.renameMaterial(db, a.id, '  ')).toThrow()
    materials.removeMaterial(db, dataDir, b.id)
    expect(fs.existsSync(path.join(dataDir, 'materials', 'Cell Biology', 'notes (2).txt'))).toBe(false)
    expect(materials.listMaterials(db, dataDir, moduleId)).toHaveLength(1)
  })

  it('works when the readable copy is gone', async () => {
    const { db, dataDir, moduleId } = setup()
    const a = await materials.addMaterial(db, dataDir, moduleId, 'n.txt', enc('Enzymes are biological catalysts made of protein.'))
    fs.rmSync(path.join(dataDir, 'materials'), { recursive: true })
    expect(materials.listMaterials(db, dataDir, moduleId)[0].hasCopy).toBe(false)
    expect(materials.materialSources(db, moduleId, [a.id])[0].text).toMatch(/catalysts/)
  })

  it('only gives text for materials in the same module', async () => {
    const { db, dataDir, moduleId } = setup()
    const other = createModule(db, { name: 'Other', code: null, colour: 'cobalt', description: null })
    const x = await materials.addMaterial(db, dataDir, other.id, 'x.txt', enc('Text that belongs to another module entirely.'))
    expect(() => materials.materialSources(db, moduleId, [x.id])).toThrow(/not in this module/)
  })

  it('records which materials a quiz version came from and counts coverage', async () => {
    const { db, dataDir, moduleId } = setup()
    const a = await materials.addMaterial(db, dataDir, moduleId, 'w1.txt', enc('Week one: the cell membrane and diffusion.'))
    const b = await materials.addMaterial(db, dataDir, moduleId, 'w2.txt', enc('Week two: active transport across membranes.'))
    const r = commitImport(db, {
      moduleId,
      filename: 'gen.csv',
      text: readSample('template.csv'),
      title: 'Generated',
      mode: 'new',
      targetQuizId: null,
      generation: {
        topic: 'Membranes',
        count: 2,
        difficulty: 'mixed',
        format: 'choice',
        instructions: null,
        model: 'test/model',
        extended: false,
        materialIds: [a.id],
        oneOffNames: ['handout.pdf']
      }
    })
    const list = materials.listMaterials(db, dataDir, moduleId)
    expect(list.find((m) => m.id === a.id)?.usedBy).toBe(1)
    expect(list.find((m) => m.id === b.id)?.usedBy).toBe(0)
    const g = quizDetail(db, r.quizId).generation
    expect(g).toMatchObject({ topic: 'Membranes', format: 'choice', model: 'test/model', extended: false })
    expect(g?.materials.map((m) => [m.label, m.available])).toEqual([
      ['W1', true],
      ['Handout', false]
    ])
    // Removing a material keeps the record of what the quiz came from.
    materials.removeMaterial(db, dataDir, a.id)
    expect(quizDetail(db, r.quizId).generation?.materials[0]).toMatchObject({ label: 'W1', available: false })
  })

  it('imported quizzes have no generation record', () => {
    const { db, moduleId } = setup()
    const r = commitImport(db, { moduleId, filename: 't.csv', text: readSample('template.csv'), title: 'T', mode: 'new', targetQuizId: null })
    expect(quizDetail(db, r.quizId).generation).toBeNull()
  })
})

describe('extending a quiz', () => {
  it('serialises existing questions back to valid CSV so new ones can be appended', () => {
    const existing = validateQuizCsv(readSample('example_quiz.csv')).questions
    const csv = questionsToCsv(existing)
    const again = validateQuizCsv(csv)
    expect(again.errors).toEqual([])
    expect(again.questions.map((q) => [q.prompt, q.type, q.marks])).toEqual(existing.map((q) => [q.prompt, q.type, q.marks]))
  })
})
