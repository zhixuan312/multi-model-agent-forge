/**
 * ──────────────────────────────────────────────────────────────────────────
 *  MOCK BACKEND — master switch + latency
 * ──────────────────────────────────────────────────────────────────────────
 *
 * When `USE_MOCK` is on, the data/service layer (the `*-core` functions, and
 * later the LLM-triggering services) serves from the file-backed fake DB under
 * `src/mock/` instead of Postgres / a real model — so the front end runs fully
 * without a real backend, and writes are captured to disk so the UI stays
 * self-consistent. Every mock payload matches the real endpoint contract, so the
 * real backend drops in behind the same endpoints later with no front-end change.
 *
 * REUSABLE: this switch + the `MockTable` store + `mockLatency` are generic.
 * A new page mocks itself by adding a seed JSON + a domain module + one guard at
 * the top of each of its `*-core` functions. See `src/mock/README.md`.
 *
 * Gating: ON in `next dev` by default (so the running dev server picks it up via
 * HMR with no env change); OFF under `test` and `production`. Force with the
 * `MOCK_BACKEND` env: `1` = always on, `0` = always off.
 */
export const USE_MOCK =
  process.env.MOCK_BACKEND === '1' ||
  (process.env.MOCK_BACKEND !== '0' && process.env.NODE_ENV === 'development');

/** Default simulated round-trip — small for reads; LLM mocks pass a larger value. */
const DEFAULT_LATENCY_MS = 220;

/** Simulate backend / LLM latency so loading states render realistically. */
export function mockLatency(ms: number = DEFAULT_LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
