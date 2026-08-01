import 'dotenv/config'
import '@testing-library/jest-dom/vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// PRODUCTION-SAFETY INVARIANT: tests must NEVER reach a real database. The app's
// DATABASE_URL points at the live (production) Postgres, and there is no separate
// test database. We delete it here — AFTER dotenv loads — so the test process
// cannot connect: any stray `getDb()` throws ("DATABASE_URL is not set") instead
// of silently mutating production.
//
// This makes the deletion unconditional and absolute: there is deliberately no
// opt-in escape hatch and no `skipIf(DATABASE_URL)` integration tier, because an
// env-gated tier would run against production the moment someone exported the var.
// Every suite is therefore DB-free by construction — domain logic is covered by
// unit tests over `createMockDb()` (tests/test-utils/mock-db.ts), and the real
// schema is proven at release time by the container boot gate, not from here.
delete process.env.DATABASE_URL

// The same invariant for the FILESYSTEM, which the database guard above does not
// cover. `resolveWorkspaceRoot()` defaults to `<cwd>/.forge-workspace` — in a dev
// checkout that is the operator's REAL workspace, holding real cloned repos and
// real project artifacts under `.mma/projects/<uuid>/`. Tests that exercise the
// artifact-write path were therefore creating and `rmSync`-ing directories inside
// it. Nothing was ever destroyed (the fixtures use `proj-1`-style ids, never a real
// UUID), but "no test id has collided with a real one yet" is not a guarantee —
// `rmSync(..., { recursive: true, force: true })` is one shared id away from
// deleting a real project's spec and plan.
//
// Point every run at a private temp root instead. Setup files run once per test
// FILE, so each file gets its own root: tests cannot reach the real workspace, and
// cannot collide with each other over a shared path either.
const testWorkspaceRoot = mkdtempSync(join(tmpdir(), 'forge-test-workspace-'))
process.env.FORGE_WORKSPACE_ROOT = testWorkspaceRoot
afterAll(() => {
  rmSync(testWorkspaceRoot, { recursive: true, force: true })
})

// jsdom shims for Radix UI primitives (shadcn). Radix measures elements and uses
// pointer-capture APIs that jsdom does not implement; provide no-op stand-ins so
// Checkbox/Switch/DropdownMenu/Tooltip mount cleanly under test. Guarded by
// environment — many suites run under the `node` environment where `window` /
// `Element` are undefined.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
  })) as unknown as typeof window.matchMedia
}

if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}
