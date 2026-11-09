// electron-builder afterPack hook: keep only the better-sqlite3 binary that
// matches the platform and architecture being packaged.
const fs = require('node:fs')
const path = require('node:path')

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName
  const arch = ARCH_NAMES[context.arch] ?? String(context.arch)
  const resources =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')
  const prebuilds = path.join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds')
  if (!fs.existsSync(prebuilds)) throw new Error(`better-sqlite3 prebuilds not found at ${prebuilds}`)
  const keep = `${platform}-${arch}.node`
  if (!fs.existsSync(path.join(prebuilds, keep))) {
    throw new Error(`No better-sqlite3 binary for ${platform}-${arch} in ${prebuilds}`)
  }
  for (const f of fs.readdirSync(prebuilds)) {
    if (f !== keep) fs.rmSync(path.join(prebuilds, f), { force: true })
  }
  console.log(`  • kept better-sqlite3 prebuild ${keep}`)
}
