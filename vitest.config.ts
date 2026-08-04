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
    // Files run in parallel. This was previously `fileParallelism: false`, justified
    // by "auth integration tests share a single live Postgres" — which cannot happen:
    // `tests/setup.ts` deletes DATABASE_URL, so no test reaches a database at all.
    //
    // The constraint that WAS real (and undocumented) was on disk: two files both
    // wrote and `rmSync`-ed `<cwd>/.forge-workspace/.mma/projects/proj-1`, the same
    // path, so running them concurrently raced. `tests/setup.ts` now gives each file
    // its own `FORGE_WORKSPACE_ROOT` temp dir, which removes the collision — and
    // keeps tests out of the operator's real workspace. Serial: ~106s. Parallel: ~29s.
    //
    // Before turning this off again, check for genuinely SHARED mutable state (a
    // fixed on-disk path, a real service) — not for a database, which is unreachable.

    // Generous per-test ceiling. Not because anything here is slow on its own — the whole
    // suite runs in well under a minute — but because under full file parallelism a worker can
    // be starved long enough for the 5s default to fire spuriously. It exists to stop
    // contention from being reported as a test failure; a test that genuinely needs
    // seconds of wall-clock is a bug to fix, not a budget to spend.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
