import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { CSP } from './src/main/window-csp'

/** Add the Content Security Policy as a meta tag in production builds. */
function cspMeta(): Plugin {
  return {
    name: 'tally-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
    }
  }
}

export default defineConfig({
  main: {
    build: {
      // unpdf is ESM-only, so it is bundled into the main process; everything else stays external.
      externalizeDeps: { exclude: ['unpdf'] },
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), cspMeta()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
      assetsInlineLimit: 0
    }
  }
})
