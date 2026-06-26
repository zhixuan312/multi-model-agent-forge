# Stage Pattern Migration

Migrate Forge stage clients to the Explore-stage pattern-layer architecture one stage at a time.

## Remaining stages (in order)

1. **Spec** — SpecStageClient.tsx (2291 lines) — phases: Outline, Craft, Finalize
2. **Plan** — PlanStageClient.tsx (973 lines) — phases: Refine, Validate
3. **Execute** — ExecuteStageClient.tsx (647 lines) — phases: Configure, Monitor
4. **Review** — ReviewStageClient.tsx (396 lines) — phase: Review

Journal, Freeze already done. Skip them.

## Per-stage checklist (apply to each stage in sequence)

For the NEXT unfinished stage:

### 1. Read the reference implementation
- Read `src/components/forge/ExploreStageClient.tsx` as the gold standard
- Read the target stage client to understand current state
- Read all patterns from `src/components/patterns/` (prose-block, feature-rail, stage-shell, status-dashboard, findings, conversation)

### 2. Migrate layout to patterns
- [ ] Replace inline `grid lg:grid-cols-3` / custom layouts with **StageShell** (master-detail) or **StageFullWidth**
- [ ] Replace any custom markdown rendering with **ProseBlock** (document/rail/compact/chat variant)
- [ ] Replace any custom rail notes with **RailNote** — per-phase contextual text
- [ ] Replace any custom conversation UI with **ConversationComposer** + **MessageList**
- [ ] Replace any custom findings display with **FindingsGrid** + **AuditRoundCard** (if applicable)
- [ ] Add **StatusDashboard** for metrics display where applicable
- [ ] Wire **stagePhaseStore** for sub-phase tracking via `advancePhase()`
- [ ] Ensure **StageAdvance** component is used for stage-to-stage transitions

### 3. Apply 6-part prompt structure
- [ ] Audit any orchestration prompts in the stage's backend handlers
- [ ] Apply Role -> Task -> Context -> Input -> Constraints -> Output format

### 4. Dead code cleanup
- [ ] Delete any inline implementations replaced by patterns (no parallel paths)
- [ ] Remove unused imports
- [ ] Remove stale comments

### 5. File-based storage (if applicable)
- [ ] Check if the stage stores artifacts in DB that should be on disk (.mma/projects/<id>/)
- [ ] Migrate to file-based read/write if so (single implementation, no DB+file parallel)

### 6. Tests
- [ ] Verify existing tests still pass
- [ ] Add pattern-layer tests if new patterns were composed in novel ways
- [ ] Run full suite: `pnpm test` (or `npm test`)

### 7. Build validation
- [ ] `pnpm build` (or `npm run build`) passes
- [ ] Run dev server and visually verify the stage works

### 8. Report and advance
- [ ] Report what changed, lines removed, patterns adopted
- [ ] Mark this stage DONE
- [ ] Move to the next stage in the list

## Rules

- ONE stage per loop iteration — finish it completely before starting the next
- No component splitting — one component stays one component
- No backward compatibility shims — delete old code in the same commit
- Every kept file must have a live caller after the change
- Left = content, Right = navigation — consistent layout
- Phase-specific RailNote for every sub-phase of every stage
- If a stage is already pattern-compliant after reading it, mark it done and move on

## Done condition

All 4 stages migrated, all tests pass, build succeeds.
