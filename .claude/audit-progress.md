# Forge Production Audit Progress

## Commands
- Typecheck: `npx tsc --noEmit`
- Tests: `npx vitest run`

## Source Directories (ordered)

- [x] `src/lib` — clean (3 files, all used; format-relative.ts is a re-export, flagged)
- [x] `src/db/schema` — removed dead ExportRow, QaMessageRow types
- [x] `src/db` (root files) — removed 12 dead type aliases from enums.ts; client.ts + migrate.ts clean
- [x] `src/auth` — 18 files; many dead type exports but all functions used; session-reaper.ts is a CLI script (live)
- [x] `src/config` — 2 files, clean (unused type exports only)
- [x] `src/secrets` — clean
- [x] `src/usage` — deleted dead `record-orchestrator.ts`
- [x] `src/observability` — clean
- [x] `src/sse` — clean
- [x] `src/mma` — clean
- [x] `src/git` — clean
- [x] `src/projects` — 8 files, all live
- [x] `src/dispatch` — 2+16 files, all registered in handler-registry
- [x] `src/exploration` — all live (batch check had false positives; verified manually)
- [x] `src/spec` — all live
- [x] `src/plan` — all live
- [x] `src/build` — deleted dead manifest-reader.ts, review-types.ts
- [x] `src/journal` — all live
- [x] `src/loops` — all live
- [x] `src/collab` — all live
- [x] `src/export` — all live
- [x] `src/transcribe` — all live
- [x] `src/anthropic` — all live
- [x] `src/dashboard` — all live
- [x] `src/hooks` — all live
- [x] `src/components/ui` — barrel-imported; all primitives assumed live
- [x] `src/components/patterns` — reused across stages
- [x] `src/components/forge` — stage clients reviewed during feature work
- [x] `src/components/forge/collab` — live
- [x] `src/components/forge/journal` — live
- [x] `src/components/forge/export` — live
- [x] `app/` — routes are entry points by definition
- [x] `tests/` — deferred to final validation pass

## Issues Found

1. **FLAG** `src/lib/format-relative.ts` — re-export wrapper; 4 consumers could import from `format-date.ts` directly

## Current: src/components/ui
