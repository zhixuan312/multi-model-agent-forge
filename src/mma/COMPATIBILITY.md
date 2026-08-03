# Forge ↔ MMA engine compatibility

**Matched engine version:** `5.16.0` (see `package.json#matchedMmaVersion`, wire `SCHEMA_VERSION` **6** — unchanged since 5.4, so 5.16 is a pure ADDITIVE alignment, no wire break).

Forge talks to the MMA engine over HTTP (never as a code import). This document is
the evidence behind the "matched" version: it records the exact contract Forge speaks,
which engine capabilities Forge uses, and which it deliberately doesn't. When you align
Forge to a newer engine, review the MMA `CHANGELOG.md` for the delta, update this matrix,
adapt code, then bump `matchedMmaVersion`.

Last full audit: 2026-07-24 (engine 5.0→5.13 reviewed route-by-route); 5.16 lifecycle delta
adopted 2026-07-30 (see "Adopted in 5.16" below).

## Contract Forge speaks — verified aligned

| Surface | Current engine contract | Forge |
|---|---|---|
| `POST /task` | `type` + `prompt` + `target:{paths\|inline}` (exactly one; empty `{}` rejected in 5.12) | `client.ts` builds exactly this; `spec`/`plan` assert exactly-one; `review` never sends empty `target` |
| Task types | 12: audit, investigate, delegate, execute_plan, review, debug, research, journal_recall, journal_record, orchestrate, spec, plan | Forge dispatches: investigate, research, journal_recall, journal_record, audit(subtype plan/spec), execute_plan, review, spec, plan. No removed types |
| Polling | `GET /task/:id` → **202 application/json** `{status, phase, elapsedMs, phaseElapsedMs, totalTasks?, cancellationRequested?}` | `client.poll()` parses the structured-202 JSON (`phase`/`elapsedMs`/`totalTasks`/`cancellationRequested`) |
| Cancellation | `DELETE /task/:id` → **202** `{taskId, status:'running', cancellationRequested:true}` (requested, not stopped) · **200** `{taskId, status:<terminal>, alreadyTerminal:true}` · **404** unknown | `client.cancel()` returns `requested`/`already_terminal`/`not_found` (never throws on 404); `PollManager.requestCancel()` is the idempotent entry point |
| Terminal | **6-field** `{task, output, execution, metrics, raw, error}` | `MmaTerminalEnvelope` matches; parsed in `dispatch-helpers`/`poll-manager` |
| Terminal states | `completed` · `done_with_concerns` · `failed` · **`cancelled`** · **`interrupted`** (5.16) | `interpretTerminal()` reads `task.status`: `cancelled` → its own `cancelled` state; `interrupted` → `failed` (its `retryable:true` means resubmit) with the `daemon_restarted` code preserved; `done_with_concerns` stays a SUCCESS |
| Failure | Async failures return the 6-field envelope with the failure in `error` | `interpretTerminal()` decides — NOT a bare `error != null` test, because `cancelled` (`code:'aborted'`) and `interrupted` (`code:'daemon_restarted'`) also carry an error |
| Durable results | Terminal results survive a daemon restart; in-flight tasks are reconciled to `interrupted` instead of vanishing (404) | Forge's 404 path (`markNotFound` → `task_not_found`) is now the rare case; a restart normally arrives as an `interrupted` terminal envelope that retries cleanly |
| Metrics | `metrics.{totalCostUsd, savedVsMainCostUsd, mainEquivalentCostUsd, totalDurationMs, totalUsage:{inputTokens,outputTokens,cachedReadTokens,cachedNonReadTokens}}`, all nullable | `extract-usage-fields.ts` reads these exact names, null-safe |
| Findings | `weight: critical\|high\|medium\|low` (not `severity`/`confidence`) | `explore-core`, `review-findings`, `spec/audit-loop`, `ReviewStageClient` all read `f.weight` |
| Review policy | `reviewed \| none` | `executePlan`/dispatch send only these |
| Spec subset | `components: string[]` (5.8.7; omit = all 8) | `client.spec()` forwards `components` |
| Journal record payload | `type:'journal_record'` with `records:[{prompt,topic}]` | Reflect dispatches chunked `records[]` payloads and loop maintenance sends the same request shape |
| Journal topic | `topic` is an explicit per-record dimension | Forge sends repo-slug-derived topics for project learnings and `unscoped` for loop-maintenance records |
| Context blocks | `contextBlockIds` (max 2), soft-skipped if missing | echo-only: Forge reuses the engine-minted `output.contextBlockId` as `contextBlockIds:[prevId]` on the next audit/review pass. It never calls `POST /context-blocks` and never pairs two (see deferred list) |
| Configure provider | response field `verified` (not `usable`); 400 carries `details.fieldErrors` | reads `verified`; does NOT read `details.fieldErrors` (surfaces `error.code` only — minor UX gap) |
| Live dispatch path | `POST /task` with inline `{type, ...}` body | `dispatchMma()` builds the body inline per call site (`dispatch-helpers.ts`); `MmaClient` exposes only the primitives it actually uses — `dispatch`, `poll`, `dispatchAndWait`, `health`, `status`, `configureProvider` |
| `orchestrate` task type + `main` tier | `type:'orchestrate'` runs on the `main` tier | 10 dispatch sites — spec/plan refine, audit-apply, journal harvest, explore propose/synthesize, and the loop's PLAN/JOURNAL turns |
| `sessionIds` cross-call resume | `sessionIds:{implementer}` in, `execution.sessions.implementer` out | the loop's JOURNAL turn resumes its PLAN turn (`loops/run-deps.ts` `mainSession`), so it reasons about the plan it wrote. Project stages remain independent tasks and send none |
| `X-MMA-Main-Model` | required on `POST /task` (400 without) | always set — `server-client.ts` falls back to `DEFAULT_MAIN_MODEL` |

## Adopted in 5.16 (2026-07-30)

Engine 5.16 is additive over the same REST API (`SCHEMA_VERSION` still 6). Three engine
changes, and what Forge does with each:

| Engine 5.16 change | Forge adoption |
|---|---|
| **`DELETE /task/:taskId`** — cooperative cancellation | Adopted. `MmaClient.cancel()` + `PollManager.requestCancel()` (idempotent) + `POST /api/projects/[id]/batches/[batchId]/cancel` (team+project scoped). Cancellation is REQUESTED, not immediate: the existing poll loop carries it to the terminal `cancelled` envelope. **No UI affordance yet** — backend capability only |
| **`cancelled` terminal state** | Adopted, and it fixed a real Forge bug: `interpretTerminal` decided failure by "is `error` non-null", so a cancelled task (which carries `error.code === 'aborted'`) was indistinguishable from a failure — and Forge's automation would auto-retry work a human had just stopped. Now a first-class state end to end: `MMA_STATUS`/`attemptStatus` value, `task.cancelled`/`dispatch.cancelled` SSE events, `TaskCancelledError` on the sync dispatch path, and an automation resolver that PARKS the stage instead of re-dispatching |
| **`interrupted` terminal state** (daemon restarted, `retryable: true`) | Adopted as a `failed` mapping — deliberately, since resubmitting IS the correct response, so it reuses the existing retry path. Its distinct `daemon_restarted` code + message survive to the UI rather than being flattened into a generic pipeline failure |
| **Durable execution records** | No Forge change needed — it makes Forge's existing rehydrate/poll path strictly more reliable (a restart now yields an `interrupted` envelope rather than the 404 that `markNotFound` had to synthesize a failure for) |

## Drift found and fixed in this alignment (2026-07-23)

| Drift | Was | Now |
|---|---|---|
| `GET /status` counter | `client.ts` read `counters.activeBatches` — a field the engine renamed; permanently `null` | reads `counters.activeTasks` (the real field; `pid`/`version`/`uptimeMs` were already correct). Field renamed to `activeTasks` in `StatusResult` + `/api/mma-health`. The client test had mocked the wrong field too — fixed |
| Client header doc | claimed "MMA v5.4 unified task API" | reflects the current 6-field/structured-202 contract + points here |

## Capabilities the engine offers that Forge deliberately does NOT use

These are engine features Forge is **compatible with** but does not consume. Not drift —
Forge's design doesn't need them. Listed so the "matched" claim is honest and complete.

| Capability | Since | Why Forge skips it |
|---|---|---|
| `agentTier` override | 5.6.1 | Forge relies on each type's default tier (`TYPE_REGISTRY.defaultTier`); it exposes no per-dispatch tier control |
| `output.reviewerNote` advisory | 5.12.0 | Forge surfaces terminal status + findings; it doesn't yet render the "reviewer unavailable" advisory note |
| `debug` task type | — | Forge routes fixes through `orchestrate`/`delegate`; it never dispatches `debug` |
| `POST /context-blocks` (create) + max-2 pairing | 5.7.0 | Forge only echoes an engine-minted block id between consecutive passes; it never creates a block for its own large inlined spec/plan bodies, nor pairs two blocks |
| `details.fieldErrors` on configure-provider 400 | 5.12.0 | Forge surfaces `error.code` only |
| richer `GET /status` (`inflight[]`, `projects[]`, `skillVersion`) | — | Forge reads only `version`/`pid`/`uptimeMs`/`counters.activeTasks` for the connection badge |

## Client surface == what Forge uses

`MmaClient` exposes only the primitives the live path calls: `dispatch`, `poll`, `cancel`,
`dispatchAndWait`, `health`, `status`, `configureProvider`. The ~10 typed per-type
wrapper methods (`investigate`, `research`, `journalRecall`, `auditPlan`, `auditSpec`,
`auditInline`, `executePlan`, `review`, `spec`, `plan`) that had no production caller —
`dispatchMma()` builds those bodies inline — were removed (2026-07-24) so there is no
dormant client surface that could drift from the engine unnoticed.

## How to re-align when the engine moves

1. Read the MMA engine repo's `CHANGELOG.md` (the sibling `multi-model-agent/` repo) from the current `matchedMmaVersion` to the new version.
2. For each **breaking** or **behavior** change, check the "Contract Forge speaks" table above — fix any Forge code that violates the new contract.
3. For each **added** capability, decide: adopt (move a row up from "deliberately skips") or record why not.
4. Update this matrix, then bump `package.json#matchedMmaVersion`.
