import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Auth integration tests share a single live Postgres (one `forge` schema).
    // Run test files sequentially in one worker so DB-mutating files don't
    // interleave — global throwaway-row cleanup in one file's afterAll would
    // otherwise race another file's in-flight rows (FK violations).
    fileParallelism: false,
    // Spec-4 orchestrator tests chain several live-DB round-trips per assertion
    // (grounding fetch + draft) against a single shared Postgres connection; the
    // 5s default is too tight for those multi-query flows.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
