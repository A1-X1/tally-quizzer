// Verify a packaged build: the release file exists, the better-sqlite3 binary is
// present outside the ASAR for the right platform and CPU architecture, and on
// macOS the ad-hoc signature passes `codesign --verify --deep --strict`.
// Usage: node scripts/verify-package.mjs <linux|win|mac> <x64|arm64>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [os, arch] = process.argv.slice(2)
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const rel = path.join(root, 'release')
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const ok = (msg) => console.log(`✓ ${msg}`)

/** Read the CPU architecture from an ELF, Mach-O or PE binary header. */
function binaryArch(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt32BE(0) === 0x7f454c46) {
    const m = b.readUInt16LE(18)
    return m === 0x3e ? 'x64' : m === 0xb7 ? 'arm64' : `elf-${m}`
  }
  const magic = b.readUInt32LE(0)
  if (magic === 0xfeedfacf) {
    const cpu = b.readUInt32LE(4)
    return cpu === 0x01000007 ? 'x64' : cpu === 0x0100000c ? 'arm64' : `macho-${cpu.toString(16)}`
  }
  if (magic === 0xbebafeca || b.readUInt32BE(0) === 0xcafebabe) return 'universal'
  if (b.readUInt16LE(0) === 0x5a4d) {
    const pe = b.readUInt32LE(0x3c)
    const m = b.readUInt16LE(pe + 4)
    return m === 0x8664 ? 'x64' : m === 0xaa64 ? 'arm64' : `pe-${m.toString(16)}`
  }
  return 'unknown'
}

const artifact = {
  linux: `Tally-${version}-x86_64.AppImage`,
  win: `Tally-Setup-${version}.exe`,
  mac: `Tally-${version}-${arch}.dmg`
}[os]
if (!artifact) fail(`unknown OS ${os}`)
const artifactPath = path.join(rel, artifact)
if (!fs.existsSync(artifactPath)) fail(`missing release file ${artifact}`)
ok(`release file ${artifact} (${(fs.statSync(artifactPath).size / 1e6).toFixed(1)} MB)`)

const platform = { linux: 'linux', win: 'win32', mac: 'darwin' }[os]
let resources
let mainBinary
if (os === 'mac') {
  const dir = fs.existsSync(path.join(rel, `mac-${arch}`)) ? `mac-${arch}` : 'mac'
  const app = path.join(rel, dir, 'Tally.app')
  resources = path.join(app, 'Contents', 'Resources')
  mainBinary = path.join(app, 'Contents', 'MacOS', 'Tally')
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
  } catch {
    fail('codesign --verify --deep --strict failed')
  }
  ok('codesign --verify --deep --strict')
} else if (os === 'win') {
  resources = path.join(rel, 'win-unpacked', 'resources')
  mainBinary = path.join(rel, 'win-unpacked', 'Tally.exe')
} else {
  resources = path.join(rel, 'linux-unpacked', 'resources')
  mainBinary = path.join(rel, 'linux-unpacked', 'tally')
}

const exeArch = binaryArch(mainBinary)
if (exeArch !== arch) fail(`app executable is ${exeArch}, expected ${arch}`)
ok(`app executable is ${arch}`)

const prebuilds = path.join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds')
if (!fs.existsSync(prebuilds)) fail(`better-sqlite3 is not unpacked from the ASAR (${prebuilds})`)
const files = fs.readdirSync(prebuilds)
const expected = `${platform}-${arch}.node`
if (files.length !== 1 || files[0] !== expected) fail(`expected only ${expected} in prebuilds, found ${files.join(', ')}`)
const nodeArch = binaryArch(path.join(prebuilds, expected))
if (nodeArch !== arch) fail(`better-sqlite3 binary is ${nodeArch}, expected ${arch}`)
ok(`better-sqlite3 native binary outside the ASAR is ${platform}-${nodeArch}`)
