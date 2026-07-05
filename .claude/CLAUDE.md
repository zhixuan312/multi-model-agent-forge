# Forge

Next.js 16 web harness for the MMA SDLC flow. Calls mmagent over HTTP, provides a 6-stage project pipeline with per-stage conversation and AI-guided authoring.

## Quick Commands

```bash
pnpm dev             # Start dev server (localhost:3000)
pnpm build           # Production build
npx vitest run       # All tests
npx tsc --noEmit     # Type-check without build
```

## Architecture

### 4-Layer UI

```
Layer 1: Design tokens (app/globals.css)           — colors, typography, motion
Layer 2: UI primitives (src/components/ui/)         — Button, Card, Table, Field, etc.
Layer 3: Shared patterns (src/components/patterns/) — ProseBlock, FeatureRail, StatusDashboard,
                                                       FindingsDisplay, Conversation, StageShell
Layer 4: Feature compositions (src/components/forge/) — stage clients, feature-specific
```

### 6-Stage Pipeline

```
Explore (Brief → Discover → Synthesize)
  → Spec (Outline → Craft → Finalize)
    → Plan (Refine → Validate)
      → Execute (Configure → Monitor)
        → Review (Review)
          → Journal (Journal)
```

Stage lifecycle managed via `project.details` JSONB column. Read helpers in `src/details/read.ts`, write helpers in `src/details/write.ts` with optimistic locking.

**Unified lifecycle engine (`src/automation/`).** Manual and auto are two *triggers* of ONE gated write path, so a mid-run manual/auto toggle is safe by construction:

- `details` (JSONB) is the single source of truth. Pages are read-only projections — a render/refresh NEVER mutates lifecycle state.
- `allowedActions(details, mode)` returns the permitted-action SET for the current state + trigger (`auto` takes `allowed[0]`; `manual` adds early-exits like audit-loop advance and direct task/learning approval). The one place the criteria table lives.
- `performTransition(db, projectId, {action, data}, trigger)` is the single gated executor: reload details → gate (allowed ∈ set · single-flight lease clear · authorized for mode) → run the effect → mirror the columns. Rejections throw `TransitionRejected`.
- `executeDetailsAction` is the ONE effect switch (every `ACTION_KIND` has exactly one case). `deriveCurrentStage` is the ONLY writer of the denormalized `currentStage`/`phase` columns (called after every effect).
- `canAutoStart` (`automation/policy.ts`) gates auto entry to `spec/finalize`+ (Design phases are hand-authored).
- The audit loops (spec finalize / plan validate / review) share `auditLoopStep` (`automation/audit-loop-policy.ts`).

**One endpoint:** every lifecycle mutation is `POST /api/projects/[id]/transition { action, data }` (schema in `automation/action-schema.ts`). The old per-verb routes (`advance`, `phase`, `complete`, `automation/{start,stop}`, `build/*`, `spec/{audit,audit-apply,confirm,outline}`, `review/{run,apply}`, `journal/{harvest,approve,record}`, …) are gone. Clients call `mma.transition(action, data?, handler?)` (`src/hooks/useMmaDispatch.ts`); `StageAdvance` posts `/transition` and does NOT navigate on a rejected transition. Intentional route exceptions (NOT lifecycle transitions): `explore/attachment/*` (multipart I/O) and message-thread content (`spec/components/message`, `plan/tasks/message`) whose insert must return the new id for optimistic-echo dedup.

### File-Based Artifacts

Exploration summary stored as markdown on disk — NOT in the DB artifact table.

```
.forge-workspace/.mma/projects/<project-id>/
  exploration.md     ← synthesized exploration brief (single source of truth)
```

- Write: `writeExplorationSummaryAsync()` in `src/projects/project-files.ts`
- Read: `readExplorationSummaryAsync()` — async for request handlers
- Read: `readExplorationSummary()` — sync for export pipeline and scheduler
- Engineers can edit the file externally; Forge picks up changes on next load
- Spec artifact stored as `spec.md` in the same directory (via `readSpecFileAsync`/`writeSpecAsync`)
- Plan artifact stored as `plan.md` in the same directory (via `readPlanFileAsync`/`writePlanAsync`)

### Prompt Engineering

All orchestration routes calling the MMA main agent follow the 6-part structure:

```
Role: You are a [role].
Task: Your task is to [specific task].
Context: [Background information]
Input: [Paste the actual content]
Constraints: [Rules]
Output format: [Expected structure]
```

### Key Conventions

- **ESM only** — all imports use `.js` extensions
- **Vitest** for testing, `globals: true`
- **No backward compatibility** — greenfield, break freely
- **One implementation per feature** — no parallel DB + file paths
- **Pattern components** reuse `RailNote`, `StageShell`, `StatusDashboard`, `ConversationComposer` across all pages
- **Stage stepper** — 4-state indicators (not_started, ongoing, done, locked) with per-phase sub-steps
- **StageAdvance** — single stage-to-stage advance button; posts `/transition` (approve_stage/advance_stage) and only navigates on success
- **Phase notes** — `RailNote` with contextual guidance per phase, not generic per stage

## Testing

```bash
npx vitest run tests/exploration/     # Exploration tests
npx vitest run tests/components/      # Component tests
npx vitest run tests/projects/        # Stage lifecycle tests
npx vitest run tests/export/          # Export tests
```

Tests that write exploration files clean up in `afterAll`. Use unique project IDs to prevent cross-test contamination.
