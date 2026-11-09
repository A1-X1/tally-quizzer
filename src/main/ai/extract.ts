import path from 'node:path'

export const MAX_SOURCE_BYTES = 25 * 1024 * 1024
export const MAX_MATERIAL_CHARS = 150_000

export const SOURCE_EXTENSIONS = ['pdf', 'docx', 'pptx', 'txt', 'md', 'markdown', 'csv', 'html', 'htm', 'rtf']

export interface ExtractedSource {
  name: string
  kind: string
  chars: number
  text: string
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: false })
  return (text as string[]).map((t, i) => `[Page ${i + 1}]\n${t}`).join('\n\n')
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  const res = await (mammoth.default ?? mammoth).extractRawText({ buffer: Buffer.from(bytes) })
  return res.value
}

async function pptxText(bytes: Uint8Array): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(bytes)
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]))
  const out: string[] = []
  for (const [i, f] of slides.entries()) {
    const xml = await zip.files[f].async('string')
    const paras = xml.split(/<\/a:p>/).map((p) =>
      [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join('')
    )
    out.push(`[Slide ${i + 1}]\n${paras.filter((p) => p.trim()).join('\n')}`)
  }
  return out.join('\n\n')
}

/** Pull readable text out of a study file. Throws a user-facing message on failure. */
export async function extractSource(name: string, bytes: Uint8Array): Promise<ExtractedSource> {
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`“${name}” is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB.`)
  }
  const ext = path.extname(name).slice(1).toLowerCase()
  let text: string
  try {
    switch (ext) {
      case 'pdf':
        text = await pdfText(bytes)
        break
      case 'docx':
        text = await docxText(bytes)
        break
      case 'pptx':
        text = await pptxText(bytes)
        break
      case 'html':
      case 'htm':
        text = decodeXml(new TextDecoder().decode(bytes).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' '))
        break
      case 'rtf':
        text = new TextDecoder().decode(bytes).replace(/\\par[d]?/g, '\n').replace(/\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '')
        break
      case 'txt':
      case 'md':
      case 'markdown':
      case 'csv':
        text = new TextDecoder().decode(bytes)
        break
      default:
        throw new Error(`Tally can read PDF, Word (.docx), PowerPoint (.pptx) and text files, not “.${ext}”.`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/Tally can read/.test(msg)) throw e
    throw new Error(`Tally could not read “${name}”. It may be damaged or password-protected. (${msg.slice(0, 120)})`)
  }
  text = tidy(text)
  if (text.replace(/\[(Page|Slide) \d+\]/g, '').trim().length < 20) {
    throw new Error(
      `“${name}” has no readable text. If it is a scanned document, export it with text recognition (OCR) first.`
    )
  }
  return { name, kind: ext, chars: text.length, text }
}

/** Join sources into one block for the prompt, trimming fairly if they are too long. */
export function combineSources(sources: ExtractedSource[]): { material: string; truncated: boolean } {
  const total = sources.reduce((s, x) => s + x.text.length, 0)
  const truncated = total > MAX_MATERIAL_CHARS
  const share = truncated ? Math.floor(MAX_MATERIAL_CHARS / Math.max(1, sources.length)) : Infinity
  const material = sources
    .map((s) => `<<<SOURCE: ${s.name}>>>\n${truncated ? s.text.slice(0, share) : s.text}\n<<<END SOURCE: ${s.name}>>>`)
    .join('\n\n')
  return { material, truncated }
}
