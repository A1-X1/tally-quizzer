// Run Vitest inside Electron's Node runtime (ELECTRON_RUN_AS_NODE) so the
// better-sqlite3 binary is loaded under exactly the ABI the app ships with.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')

const child = spawn(electron, [vitest, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TALLY_TEST_RUNTIME: 'electron' }
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
