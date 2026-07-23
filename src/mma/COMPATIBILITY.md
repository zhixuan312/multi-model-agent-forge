# Forge ↔ MMA engine compatibility

**Matched engine version:** `5.12.0` (see `package.json#matchedMmaVersion`, wire `SCHEMA_VERSION` 6).

Forge talks to the MMA engine over HTTP (never as a code import). This document is
the evidence behind the "matched" version: it records the exact contract Forge speaks,
which engine capabilities Forge uses, and which it deliberately doesn't. When you align
Forge to a newer engine, review the MMA `CHANGELOG.md` for the delta, update this matrix,
adapt code, then bump `matchedMmaVersion`.

Last full audit: 2026-07-23 (engine 5.0→5.12 reviewed route-by-route).

## Contract Forge speaks — verified aligned

| Surface | Current engine contract | Forge |
|---|---|---|
| `POST /task` | `type` + `prompt` + `target:{paths\|inline}` (exactly one; empty `{}` rejected in 5.12) | `client.ts` builds exactly this; `spec`/`plan` assert exactly-one; `review` never sends empty `target` |
| Task types | 12: audit, investigate, delegate, execute_plan, review, debug, research, journal_recall, journal_record, orchestrate, spec, plan | Forge dispatches: investigate, research, journal_recall, journal_record, audit(subtype plan/spec), execute_plan, review, spec, plan. No removed types |
| Polling | `GET /task/:id` → **202 application/json** `{status, phase, elapsedMs, phaseElapsedMs, totalTasks?}` | `client.poll()` parses the structured-202 JSON (`phase`/`elapsedMs`/`totalTasks`) |
| Terminal | **6-field** `{task, output, execution, metrics, raw, error}` | `MmaTerminalEnvelope` matches; parsed in `dispatch-helpers`/`poll-manager` |
| Failure | Async failures return the 6-field envelope with the failure in `error` (non-null only when `status==='failed'`) | `dispatch-helpers.ts` treats non-null `envelope.error` as failure (not silent success) |
| Metrics | `metrics.{totalCostUsd, savedVsMainCostUsd, mainEquivalentCostUsd, totalDurationMs, totalUsage:{inputTokens,outputTokens,cachedReadTokens,cachedNonReadTokens}}`, all nullable | `extract-usage-fields.ts` reads these exact names, null-safe |
| Findings | `weight: critical\|high\|medium\|low` (not `severity`/`confidence`) | `explore-core`, `review-findings`, `spec/audit-loop`, `ReviewStageClient` all read `f.weight` |
| Review policy | `reviewed \| none` | `executePlan`/dispatch send only these |
| Spec subset | `components: string[]` (5.8.7; omit = all 8) | `client.spec()` forwards `components` |
| Context blocks | `contextBlockIds` (max 2), soft-skipped if missing | threaded through investigate/research/recall/audit/review/spec/plan |
| Configure provider | response field `verified` (not `usable`); 400 carries `details.fieldErrors` | `configure-provider.ts` reads `verified` |
| `X-MMA-Main-Model` | required on `POST /task` (400 without) | always set — `server-client.ts` falls back to `DEFAULT_MAIN_MODEL` |

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
| `orchestrate` task type + `main` tier | 5.2.0 | Forge is the orchestrator — it drives the SDLC itself via its own stage handlers, so it never delegates a session-persistent "brain" to the engine |
| `sessionIds` cross-call resume | 5.4.3 | Forge dispatches each stage as an independent task; it has no multi-call worker session to resume |
| `agentTier` override | 5.6.1 | Forge relies on each type's default tier (`TYPE_REGISTRY.defaultTier`); it exposes no per-dispatch tier control |
| journal `topic` dimension | 5.10.0 | Forge's journal is team-level and recall is unscoped today. Topic-scoped recall (e.g. per repo/project) is a **candidate enhancement**, not adopted yet — would need a decision on what the topic value is |
| `output.reviewerNote` advisory | 5.12.0 | Forge surfaces terminal status + findings; it doesn't yet render the "reviewer unavailable" advisory note |
| richer `GET /status` (`inflight[]`, `projects[]`, `skillVersion`) | — | Forge reads only `version`/`pid`/`uptimeMs`/`counters.activeTasks` for the connection badge |

## How to re-align when the engine moves

1. Read the MMA engine repo's `CHANGELOG.md` (the sibling `multi-model-agent/` repo) from the current `matchedMmaVersion` to the new version.
2. For each **breaking** or **behavior** change, check the "Contract Forge speaks" table above — fix any Forge code that violates the new contract.
3. For each **added** capability, decide: adopt (move a row up from "deliberately skips") or record why not.
4. Update this matrix, then bump `package.json#matchedMmaVersion`.
