import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * A separate build so the benchmark harness never ships inside the application.
 * It compiles with the same plugins and the same production settings, because a
 * number measured against a development build measures Vite, not hunk.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./harness', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
})
