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
- [ ] `src/projects`
- [ ] `src/dispatch`
- [ ] `src/dispatch/handlers`
- [ ] `src/exploration`
- [ ] `src/spec`
- [ ] `src/plan`
- [ ] `src/build`
- [ ] `src/journal`
- [ ] `src/loops`
- [ ] `src/collab`
- [ ] `src/export`
- [ ] `src/transcribe`
- [ ] `src/anthropic`
- [ ] `src/dashboard`
- [ ] `src/hooks`
- [ ] `src/components/ui`
- [ ] `src/components/patterns`
- [ ] `src/components/forge`
- [ ] `src/components/forge/collab`
- [ ] `src/components/forge/journal`
- [ ] `src/components/forge/export`
- [ ] `app/` (routes + pages)
- [ ] `tests/`

## Issues Found

1. **FLAG** `src/lib/format-relative.ts` — re-export wrapper; 4 consumers could import from `format-date.ts` directly

## Current: src/config
