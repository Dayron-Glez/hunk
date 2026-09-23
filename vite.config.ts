import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Workers default to iife, which cannot code-split: every dynamic import is
  // inlined, and the highlight worker becomes one 3.4 MB file with all 34
  // grammars in it. As modules they load only the grammar a diff needs.
  worker: { format: 'es' },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    // The invariants run over the whole corpus, and the corpus contains a
    // 758-file kernel commit: two of them take six to nine seconds on their
    // own. At the default five they passed on a quiet machine and failed on a
    // busy one, which is a test reporting the load average rather than the
    // code.
    testTimeout: 30_000,
  },
})
