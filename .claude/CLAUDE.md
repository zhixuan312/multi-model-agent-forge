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

Stage lifecycle managed centrally in `src/projects/stage-lifecycle.ts`. Stage advancement via `StageAdvance` component + middleware `x-pathname` header.

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
- **StageAdvance** — single component for all stage-to-stage transitions
- **Phase notes** — `RailNote` with contextual guidance per phase, not generic per stage

## Testing

```bash
npx vitest run tests/exploration/     # Exploration tests
npx vitest run tests/components/      # Component tests
npx vitest run tests/projects/        # Stage lifecycle tests
npx vitest run tests/export/          # Export tests
```

Tests that write exploration files clean up in `afterAll`. Use unique project IDs to prevent cross-test contamination.
