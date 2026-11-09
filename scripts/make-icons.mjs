// Render the original Tally icon from SVG to PNG, ICO and ICNS using the
// bundled Playwright Chromium. Run with: npm run icons
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'resources')

// Four strokes crossed by a fifth: a tally of five. Cobalt tile, paper strokes, yellow strike.
const svg = (size, inset) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect x="${inset}" y="${inset}" width="${1024 - 2 * inset}" height="${1024 - 2 * inset}" rx="${(1024 - 2 * inset) * 0.225}" fill="#2447F9"/>
  <g stroke="#F5F1E8" stroke-width="64" stroke-linecap="round">
    <path d="M332 300v424M444 300v424M556 300v424M668 300v424"/>
  </g>
  <path d="M250 650 774 374" stroke="#FFD84D" stroke-width="72" stroke-linecap="round"/>
</svg>`

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
)
const page = await browser.newPage({ deviceScaleFactor: 1 })
async function png(size, inset) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, inset)}</body></html>`)
  return page.locator('svg').screenshot({ omitBackground: true })
}

fs.mkdirSync(out, { recursive: true })
// macOS icons sit inside a margin; Windows and Linux use the full tile.
const MAC_INSET = 100
fs.writeFileSync(path.join(out, 'icon.png'), await png(1024, 0))
fs.writeFileSync(path.join(out, 'icon.svg'), svg(1024, 0).trim() + '\n')

// ICO with embedded PNGs.
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoImages = []
for (const s of icoSizes) icoImages.push(await png(s, 0))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(icoSizes.length, 4)
const dir = Buffer.alloc(16 * icoSizes.length)
let offset = 6 + dir.length
icoSizes.forEach((s, i) => {
  const b = i * 16
  dir.writeUInt8(s === 256 ? 0 : s, b)
  dir.writeUInt8(s === 256 ? 0 : s, b + 1)
  dir.writeUInt8(0, b + 2)
  dir.writeUInt8(0, b + 3)
  dir.writeUInt16LE(1, b + 4)
  dir.writeUInt16LE(32, b + 6)
  dir.writeUInt32LE(icoImages[i].length, b + 8)
  dir.writeUInt32LE(offset, b + 12)
  offset += icoImages[i].length
})
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, dir, ...icoImages]))

// ICNS with PNG entries.
const icnsTypes = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]
]
const chunks = []
for (const [type, s] of icnsTypes) {
  const data = await png(s, Math.round((MAC_INSET * s) / 1024))
  const h = Buffer.alloc(8)
  h.write(type, 0, 'ascii')
  h.writeUInt32BE(data.length + 8, 4)
  chunks.push(h, data)
}
const body = Buffer.concat(chunks)
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 'ascii')
icnsHeader.writeUInt32BE(body.length + 8, 4)
fs.writeFileSync(path.join(out, 'icon.icns'), Buffer.concat([icnsHeader, body]))

// Linux desktop icon set.
const linuxDir = path.join(out, 'icons')
fs.mkdirSync(linuxDir, { recursive: true })
for (const s of [16, 32, 48, 64, 128, 256, 512]) fs.writeFileSync(path.join(linuxDir, `${s}x${s}.png`), await png(s, 0))

await browser.close()
console.log('Icons written to', out)
