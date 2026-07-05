# Phase-2 autonomous-run findings

## F1 — spec-audit infinite re-dispatch (FIXED, commit 9003539)
- **Symptom:** auto run stuck at "Running spec audit pass 1"; batch reached `done`
  (2.5 min) but `stages.spec.phases.finalize.auditPasses` stayed 0, so the resolver
  re-dispatched the same pass forever.
- **Root cause:** `ensureHandlersRegistered()` fired 16 un-awaited dynamic imports
  and returned void; both `getHandler` call sites (dispatch-helpers await:true path;
  poll-manager terminal path) read the registry on the next SYNCHRONOUS line. On a
  cold module (Next HMR resets it on every edit) the handler was undefined and the
  `if (h)` guard silently skipped the terminal handler — the sole writer of the
  audit-pass gating state.
- **Fix:** memoized awaitable registration promise; await it before `getHandler` at
  both sites; the sync path throws on a still-missing batch handler (fail loud, not
  silent). Regression test: tests/dispatch/handler-registration.test.ts.
- **Note:** only manifested because HMR was resetting modules during active editing;
  the earlier landmark run had warm modules. Now robust to cold start / HMR.

## Run 2 validation (post-F1-fix) — HEALTHY
- exploration → spec (1 clean audit pass, auditPasses RECORDED) → approve_stage → plan ✓
- plan-author (async, ~12min) → poll-manager RECORDED 24 tasks → plan validate ✓
- validate loop ticking task-by-task (validate_task → approve_task → next), ~2.4min/task
- No errors, no re-dispatch loops. F1 fix confirmed on BOTH sync (spec-audit) and
  async (plan-author) handler paths.

## F2 — transient MMA reviewer_parse_failed on plan-audit pass 2 (NOT a Forge bug)
- EVENT[66]: "Retry 1/3 — MMA task failed: reviewer_parse_failed: Invalid JSON in reviewer output"
- MMA worker/refiner emitted malformed JSON (server-side flakiness). Forge's driver
  retried (attempt 2 succeeded), recorded pass 2, continued. This is the CORRECT
  fail-loud-then-retry behavior the F1 fix enables (vs the old silent loop).
- No Forge action needed; retry path validated live.

## Run 2 — VERDICT COMPLETE (2026-07-05 19:35 UTC / 03:35 SGT)
Full autonomous pipeline, all 6 stages done via the unified engine:
- exploration → spec (1 clean audit pass) → plan (author + 24 validate/approve +
  5-pass audit loop) → execute (24 tasks, ~20min) → review (5-pass audit loop) →
  journal (23 learnings harvested + all approved + recorded) → mark_complete.
- Validated live: performTransition single gate on EVERY transition; all three
  audit loops (spec/plan/review) record + apply + cap-advance; approve_stage &
  advance_stage; dispatch_execute repos threading (targetBranch=master, 24 tasks);
  approve_task (24×) + approve_learning (23×) monotonic; deriveCurrentStage mirror.
- Only anomaly: F2 (transient MMA reviewer_parse_failed) — absorbed by driver retry,
  not a Forge bug. Zero new Forge-side failures across the whole run.

CONCLUSION: unified single-lifecycle implementation drives auto end-to-end cleanly.
Goal met. F1 was the sole real bug (fixed, unit-locked, validated through a full run).
