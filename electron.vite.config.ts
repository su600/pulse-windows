import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

/** Production-only CSP: dev needs inline scripts for hot reload. Mask images are data: URLs. */
const csp = {
  name: 'pulse-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string): string =>
    html.replace(
      '</title>',
      `</title>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'" />`
    )
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { ...shared, '@icons': resolve(__dirname, 'resources/icons') } },
    plugins: [react(), csp],
    build: {
      rollupOptions: {
        input: {
          panel: resolve(__dirname, 'src/renderer/panel.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    }
  }
})
