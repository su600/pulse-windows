import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Serves the renderers in a plain browser with the mock backend (src/renderer/shared/devMock.ts). */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  server: { port: 5183, strictPort: true, fs: { allow: [resolve(__dirname)] } }
})
