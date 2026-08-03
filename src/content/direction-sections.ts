export type PartId = 'product' | 'engine' | 'backend' | 'forge' | 'telemetry';

export interface DirectionSection {
  id: string;
  part: PartId;
  /** Optional sub-group label within a part (e.g. Engine → Routing / Read-only / Write). */
  subgroup?: string;
  title: string;
  /** Section body, markdown. Rendered above the structured component (if any). */
  body: string;
  /** Optional structured renderer for content that needs more than prose. */
  component?: 'principles' | 'lifecycle' | 'layers' | 'write-stages' | 'research-sources' | 'journal-record' | 'journal-recall';
  /** For a read-only tool page: render that route's criteria reference. */
  routeKey?: 'audit' | 'review' | 'debug' | 'investigate';
  /** Mark as work-in-progress (designed, not yet shipped). */
  wip?: boolean;
  /** Optional "In the code" source pointer (markdown). */
  underTheHood?: string;
}

/**
 * The manifesto's four movements — the whole-product frame first, then depth per
 * surface. Product = why + what + the global rules; the three surfaces = how.
 */
export const PARTS: { part: PartId; title: string }[] = [
  { part: 'product',   title: 'The product' },
  { part: 'engine',    title: 'The engine · shared by both modes' },
  { part: 'backend',   title: 'The backend · how the engine runs' },
  { part: 'forge',     title: 'Forge · the team app' },
  { part: 'telemetry', title: 'Telemetry · proof surface' },
];

/** The product's single-statement thesis, verbatim from DIRECTION.md's opening.
 *  Shown as the page masthead so a reader gets the whole pitch at a glance. */
export const MASTHEAD_STATEMENT =
  'multi-model-agent helps engineers adopt the **full AI software development lifecycle** — as an individual or as a team — and proves the work was worth it. One engine routes the **right agent to the right task** and enforces quality with **cross-agent review**. Two adoption modes sit on that engine: the **engine directly** for the individual, **Forge** for the team. One **proof surface** shows the economics, honestly. **Models go deep; we connect them wide** — and the engineer always keeps the judgment.';

export const DIRECTION_SECTIONS: DirectionSection[] = [
  // ═══════════════════════════ I — THE PRODUCT ═══════════════════════════
  {
    id: 'insight-and-bet',
    part: 'product',
    title: 'The insight',
    body: `Providers go deep. We connect wide.

> ${MASTHEAD_STATEMENT}

Every model vendor races to be more capable on its own — reasoning, coding, tool use, long context. What no single vendor ships is the **horizontal layer** that makes a fleet of them behave like one reviewed system, wrapped in a **lifecycle a person or a team can actually adopt**.

multi-model-agent is that layer: one engine that routes the right task to the right agent, reviews the work across agents, bounds the cost — and proves it. The providers go deeper; we connect them wider.

### The aim

We help every user — the individual power-user and the product team alike — adopt the **full AI SDLC**, and we assist product teams in their delivery work.

The lifecycle — design → spec → plan → execute → review → verify → ship, with \`audit\` gating the spec and the plan and the journal feeding the next cycle — isn't a feature bolted on; it's the thing we help you adopt, instrument, and trust. Whether one engineer wields it directly or a team runs it through a gated workflow, the aim is the same: **more of the delivery lifecycle, done with a routed, reviewed, evidenced harness.**

### The bet

A reviewed multi-agent harness delivers quality as good as — or better than — a single frontier model running alone, at a fraction of the cost, and we **measure** it.

A solo frontier run is one model, one pass, no independent check. The harness adds the right agent per task, an independent cross-agent review, and audit gates over the spec and the plan — then routes routine work to lean tiers so the full harness stays affordable. The bet: the reviewed harness becomes **the unit of AI software engineering** — the question shifts from "which model should I use?" to "how is my harness configured, and how wide is its lifecycle coverage?"

We hold ourselves to this and prove it with honest evidence — see the telemetry proof surface below. If the bet stops holding for a task class, we say so and route it differently.`,
  },
  {
    id: 'principles',
    part: 'product',
    title: 'The global principles',
    body: `Six principles govern every surface — the engine, Forge, and telemetry alike. Each is a rule we've tested against real usage; the surface-specific *mechanisms* (routing, the rods, the review pipeline) live in each surface's own section, below.`,
    component: 'principles',
  },
  {
    id: 'reviewed-lifecycle',
    part: 'product',
    title: 'The AI Development Life Cycle (AIDLC)',
    body: `The work isn't a flat stream of isolated tasks — it's an **AI Development Life Cycle (AIDLC)**, and the harness instruments and guards every stage end to end. Each specialized tool is a **rod**: a gate over one stage of the cycle below.

**We harness the lifecycle; we do not author it.** The harness enforces evaluation, review, and audit at each gate — but the engineer makes every call: what to build, which approach, whether to merge. This is today's snapshot, not the boundary: the rod set is open and expected to widen as AI software engineering matures.

**Two ways to run the chain.** A solo engineer drives it **by hand** — the \`mma-*\` skills chain the rods, with \`mma-design\` running the interactive design phase and \`/mma-flow\` scripting the whole lifecycle end to end (spec → audit → plan → audit → execute → review → PR). A team runs the *same* rods through **Forge**, which turns the chain into a gated, standardized workflow. Same lifecycle, same rods — the mode only changes who holds the baton.`,
    component: 'lifecycle',
  },
  {
    id: 'one-engine-two-modes',
    part: 'product',
    title: 'One engine, two modes',
    body: `There is one engine and two ways to adopt it.

- **The engine, directly — the individual mode.** The npm package plus installable skills, called from whatever agent client you already use. Flexible, unopinionated about workflow, deployed however you like. The power-user path: maximum control, minimum ceremony.
- **Forge — the team mode.** A collaborative orchestration app built on the engine, giving a team a standardized, gated SDLC workflow with roles, review gates, and shared knowledge. For a product team that wants the lifecycle consistent across people, not reinvented per engineer.

Same engine underneath. The mode is a choice about **how much structure you want** — not a different product.

### The surface map

Two modes, but three surfaces — because the proof is its own surface:

- **The engine** executes each stateless per-stage rod and returns evidence. It is the shared labor layer both modes run on — reached directly by the individual, over HTTP by Forge. On this page it spans two movements: **The engine** (the shared routes) and **The backend** (how those routes run).
- **Forge** owns the SDLC chain and its gates, driving the engine from outside over HTTP. It is the team workflow. *(Forge, below.)*
- **Telemetry** aggregates usage from *both* the engine and Forge and presents the economic proof. It is the evidence surface. *(Telemetry, below.)*

This page — hosted inside **authenticated Forge**, the team app — is the product's global north star across every surface; each surface's own \`GUIDELINES.md\` carries its product-specific direction.`,
  },
  {
    id: 'what-we-wont-do',
    part: 'product',
    title: "What we won't do & where we're going",
    body: `Seven things we refuse to do — each one protects the engineer's judgment, the honesty of the evidence, or the thinness of the platform.

- **We won't optimize for a specific model.** Quirk fixes go in the platform, not in model-specific branches.
- **We won't make decisions for the engineer.** We execute, review, audit, and report; you decide what to build and whether to merge.
- **We won't accumulate domain logic.** Rods stay thin presets over generic primitives.
- **We won't maintain workflow state.** Each request is self-contained; the caller — or Forge — owns the workflow.
- **We won't chase autonomy.** Bounded execution with structured checkpoints, not hours-long autonomous runs.
- **We won't compete with models.** When a single model suffices, we make it easy to route there with review off; we adapt to what models can do.
- **We won't dress up the numbers.** Real savings against a real baseline, advisory findings shown as advisory, no vanity metrics — if a number would mislead, we don't show it.

### Where we're going

Four directions, none of which hard-code the lifecycle into the platform:

- **Perfect the protocol** — delegation should feel as native as a built-in tool: terse-prompt intake intelligence, response clarity (headlines + verdicts + cost, no post-processing), reliability at scale.
- **Widen the lifecycle** — more rods, more gates, caller-defined rods registered at runtime, provider-aware routing that surfaces which agent handles which task shape well.
- **Make the economics undeniable** — deeper per-task and fleet-level savings against real baselines, quality-caught accounting, routing transparency, trend over time; public where it builds trust and defensible to anyone.
- **Both modes mature** — the individual gets more power with less ceremony; the team gets a more complete, more standardized workflow.

Providers go deep. We connect wide — and we keep widening.`,
  },

  // ═══════════════════════ II — THE ENGINE · SHARED LABOR LAYER ═══════════════════════
  {
    id: 'routing-two-slots',
    part: 'engine',
    subgroup: 'Routing',
    title: 'Routing & the three layers',
    body: `The engine is the **shared labor layer both modes run on** — the individual calls it directly from whatever agent client they use; Forge calls the *same routes* over HTTP. The routing model, the three layers, and the read / write / orchestration route taxonomy on the following pages are global to the product: they don't change between the direct and the team path.

The work runs across **three layers**. Your own agent (or Forge, on a team's behalf) stays on top and keeps the judgment; beneath it sit the **two labor slots you configure** — \`complex\` and \`standard\`. These are labor *categories*, not intelligence tiers: you decide what each one means for your workflow and budget, and a cheaper model can fill a slot as your fleet changes.`,
    component: 'layers',
  },

  // Read-only — return findings, never edit files; skip cross-agent review.
  {
    id: 'tool-audit',
    part: 'engine',
    subgroup: 'Read-only',
    title: 'Audit',
    routeKey: 'audit',
    body: `\`audit\` audits a prose artifact against a fixed, named criteria set — pick the **subtype** for the artifact: \`default\` (general prose), \`spec\` (requirements), \`plan\` (a plan checked against the codebase), \`skill\` (a SKILL.md). Read-only: it returns findings, never edits. Every read-only route shares one finding format (\`## Finding N:\` + severity + evidence). Each subtype's exact criteria:`,
    underTheHood: `Primary: \`core/src/skills/audit/\` (\`implement.md\`, \`review.md\`).`,
  },
  {
    id: 'tool-review',
    part: 'engine',
    subgroup: 'Read-only',
    title: 'Review',
    routeKey: 'review',
    body: `\`review\` runs a quality / security / correctness pass over source code — one worker per file, read-only. Reach for it **before merge**. Its 10 criteria are what a careful maintainer scans for:`,
    underTheHood: `Primary: \`core/src/skills/review/\` (\`implement.md\`, \`review.md\`).`,
  },
  {
    id: 'tool-debug',
    part: 'engine',
    subgroup: 'Read-only',
    title: 'Debug',
    routeKey: 'debug',
    body: `\`debug\` investigates a failure and proposes **root-cause hypotheses** — read-only: it diagnoses, it doesn't fix. It must emit at least one finding. It works the problem from five angles:`,
    underTheHood: `Primary: \`core/src/skills/debug/\` (\`implement.md\`, \`review.md\`).`,
  },
  {
    id: 'tool-investigate',
    part: 'engine',
    subgroup: 'Read-only',
    title: 'Investigate',
    routeKey: 'investigate',
    body: `\`investigate\` answers a question about the codebase — each finding is a **candidate answer** ranked by confidence. Read-only. It approaches the question from five perspectives:`,
    underTheHood: `Primary: \`core/src/skills/investigate/\` (\`implement.md\`, \`review.md\`).`,
  },
  {
    id: 'tool-research',
    part: 'engine',
    subgroup: 'Read-only',
    title: 'Research',
    body: `\`research\` reaches **outside** the codebase — multi-source external research with citations. Bibliographic, not opinionated; read-only. **Web search is via Brave** (with \`site:\` filters); a few sources need credentials and are skipped if a key isn't configured. It fans out across these sources:`,
    component: 'research-sources',
    underTheHood: `Primary: \`core/src/research/\` (orchestrator, query-plan, web-search, adapters); skill at \`core/src/skills/research/\`. Keys: \`research.brave.apiKeys\`, \`builtinAdapters.semanticScholarApiKey\`, \`builtinAdapters.githubPat\`.`,
  },

  // Write — produce file changes / artifacts; run the full reviewed lifecycle.
  {
    id: 'tool-spec',
    part: 'engine',
    subgroup: 'Write',
    title: 'Spec',
    body: `\`spec\` turns confirmed design decisions into a formal **specification document** on disk — context, problem, goals, requirements, alternatives, testing plan, risks, and numbered acceptance criteria. A write route: an implementer drafts it and a cross-agent refiner tightens it for testability and decision-trace before it lands (the same reviewed two-phase pipeline as \`delegate\`). Reach for it once a design is settled and you want the requirements written down; \`mma-spec\` is the skill that calls it. Audit the result with \`audit\` (subtype \`spec\`) before planning.`,
    underTheHood: `Primary: \`core/src/skills/spec/\` (\`implement.md\`, \`review.md\`); task type \`spec\` dispatched via \`POST /task\`.`,
  },
  {
    id: 'tool-plan',
    part: 'engine',
    subgroup: 'Write',
    title: 'Plan',
    body: `\`plan\` turns a spec on disk into a **TDD implementation plan** — ordered, bite-sized tasks with exact file paths, complete code blocks, and verification commands, written for an engineer with zero prior context. A write route: an implementer drafts the plan and a cross-agent refiner tightens it for executability before it lands (the same reviewed two-phase pipeline as \`delegate\`). Reach for it once a spec exists; \`mma-plan\` is the skill that calls it. Audit the result with \`audit\` (subtype \`plan\`) against the codebase, then implement it with \`execute_plan\`.`,
    underTheHood: `Primary: \`core/src/skills/plan/\` (\`implement.md\`, \`review.md\`); task type \`plan\` dispatched via \`POST /task\`.`,
  },
  {
    id: 'tool-delegate',
    part: 'engine',
    subgroup: 'Write',
    title: 'Delegate',
    body: `\`delegate\` is the power tool — a batch of ad-hoc tasks (no plan file) run in **parallel** on standard-tier agents, each through the full reviewed lifecycle. It's the general-purpose fallback when no specialized rod fits: research, multi-file edits, mechanical refactors. Artifact-producing, so cross-agent review runs by default; if a task fails, escalation can retry it on a stronger agent. Every write task runs the full stage chain below:`,
    component: 'write-stages',
    underTheHood: `Primary: \`core/src/unified/two-phase-pipeline.ts\`, \`core/src/skills/delegate/\`, \`core/src/providers/\`.`,
  },
  {
    id: 'tool-execute-plan',
    part: 'engine',
    subgroup: 'Write',
    title: 'Execute plan',
    body: `\`execute_plan\` implements tasks from a **plan file on disk** — the task descriptors select plan headings verbatim, and **one worker session implements them sequentially, in order, on the branch the caller checked out**. It is *not* a parallel fan-out — that's \`delegate\`; \`execute_plan\` is the sequential, plan-driven counterpart. Per-task **review policy** is selectable (\`reviewed\` / \`none\`) so mechanical tasks skip cross-agent review while risky ones get the full pass. Each task runs the same reviewed write lifecycle as \`delegate\`. Reach for it when a written plan exists; \`delegate\` when it doesn't.`,
    underTheHood: `Primary: \`core/src/unified/two-phase-pipeline.ts\`, \`core/src/skills/execute_plan/\`.`,
  },
  // Journal recall — the read side of the project's durable learnings store.
  {
    id: 'tool-journal-recall',
    part: 'engine',
    subgroup: 'Read-only',
    title: 'Journal recall',
    body: `\`journal_recall\` reads the project's durable **learnings store** — ask a vague, conceptual question and a read-only worker returns the relevant prior lessons ranked by relevance, shaped like \`investigate\`. Reach for it before designing or attempting something, so you don't re-tread ground the project already covered. It follows Karpathy's [LLM-Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — retrieval indexed over embeddings, not keyword tags. How a question is turned back into learnings:`,
    component: 'journal-recall',
    underTheHood: `Primary: \`core/src/skills/journal_recall/\`; skill \`mma-journal-recall\`. Task type \`journal_recall\` dispatched via \`POST /task\` (read-only). Reads the markdown store at \`.mma/journal/\`.`,
  },
  // Journal record — the write side of the same store (grouped under Write in the TOC).
  {
    id: 'tool-journal-record',
    part: 'engine',
    subgroup: 'Write',
    title: 'Journal record',
    body: `\`journal_record\` writes a new learning into the project's durable **knowledge graph**, stored in the shape of Google's [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) (OKF) — a portable, vendor-neutral directory of markdown files with YAML frontmatter, each node carrying a required **\`type\`** and linked into a graph. OKF formalizes the same LLM-Wiki pattern the journal is built on, so the store is readable by humans, agents, and any OKF tool without a translation layer.

The route is precise and artifact-producing, so it runs the full reviewed lifecycle like \`delegate\`; and rather than blindly appending, a record **integrates into existing nodes** — create / refine / supersede / merge. Every learning carries one of **six \`type\`s** so recall can retrieve by the *kind* of lesson — the types, then how a record flows and where it lands:`,
    component: 'journal-record',
    underTheHood: `Primary: \`core/src/skills/journal_record/\`; skill \`mma-journal-record\`. Task type \`journal_record\` dispatched via \`POST /task\` (artifact-producing, cross-agent reviewed). Writes the markdown store at \`.mma/journal/\` (\`schema.md\`, \`index.md\`, \`log.md\`, \`nodes/\`) — worker-driven, no bespoke store module.`,
  },

  // ═══════════════════════ III — THE BACKEND · HOW THE ENGINE RUNS ═══════════════════════
  // How the engine executes each routed task: fast, cheap, and bounded.
  {
    id: 'provider-runtimes',
    part: 'backend',
    subgroup: 'Runtime',
    title: 'Built on the providers’ own runtimes',
    body: `The backend is the engine's **execution layer** — how each route from the previous movement actually runs, not a separate surface. It starts with a boundary: we build on the providers' own agent runtimes rather than reimplementing them. **Claude and Claude-compatible** work runs through the **Claude Agent SDK** (\`@anthropic-ai/claude-agent-sdk\`); **OpenAI and OpenAI-compatible** work runs through the official **Codex CLI** (\`codex exec\`).

That's a deliberate boundary: **we don't control the agent loop or how the model uses its tools** — that lives inside the provider's runtime, and it's theirs to own. The providers are pouring enormous effort into making that loop deeper and better with every release; betting against them there would mean reinventing a wheel the people closest to the model are already perfecting.

So we stay above it. We **don't reinvent the wheel — we collaborate with the best, and grow on their success.** Every time a provider deepens its runtime, the whole harness gets better for free. When one ships a new capability — a longer context window, context compaction, a **goal-driven loop** that runs a task to a stated outcome — the harness can adopt it underneath and, where it helps, wire it into how a task is implemented, at the caller's choice. A provider getting better never makes us less useful; it makes us **more capable**.

And because we **connect wide**, the gains cross clients. Your own agent might be Claude Code, yet a task can still run on Codex underneath — so you get OpenAI's advances without leaving your client, and a Codex user gets Anthropic's the same way. **Providers go deep on their own models; we connect them so every engineer rides all of it.**`,
    underTheHood: `Primary: \`core/src/providers/claude.ts\` + \`claude-session.ts\` (\`@anthropic-ai/claude-agent-sdk\`), \`core/src/providers/codex.ts\` + \`codex-cli-session.ts\` (the official \`codex\` CLI). The harness orchestrates above these in \`core/src/unified/two-phase-pipeline.ts\`.`,
  },
  {
    id: 'cache-tokens',
    part: 'backend',
    subgroup: 'Runtime',
    title: 'Optimizing cache-token usage',
    body: `Most of what an agent run costs is **re-sending the same context** — the system prompt, the tool definitions, the brief, the files already read. Provider **prompt caches** make a repeated prefix nearly free, so the harness is engineered to maximize cache hits. We pull two levers.

**1 · Session reuse.** Because each task rides one reused session per slot (see *Built on the providers' own runtimes*), the conversation prefix stays identical and warm across stages. Turn 0 pays for the full context; every later turn sends **only the delta** and reads the rest from cache — the worker never re-greps or re-reads what's already in the thread.

**2 · A standardized prompt prefix.** Every call is assembled the same way: the stable parts first — system prompt, tool / criteria taxonomy, the brief — with a cache breakpoint at the end of that block, and the one thing that changes (the specific instruction or criterion) **last**. Because that prefix is byte-identical call to call, the provider serves it from cache instead of re-billing it.

Both follow the same rule the provider caches reward: **static content first, dynamic content last, the prefix held byte-identical, and kept warm within the cache's TTL.** The payoff lands straight in the saved-cost numbers — cached tokens cost a fraction of fresh ones.`,
    underTheHood: `Primary: \`core/src/unified/skill-loader.ts\` (stable skill prefix assembly), \`core/src/providers/session-helpers.ts\` (session reuse + resume).`,
  },
  {
    id: 'bounded-execution',
    part: 'backend',
    subgroup: 'Runtime',
    title: 'Bounded execution',
    body: `Every task runs inside hard bounds — it can't run away, hang, or spin forever. This is the backend mechanism behind the global principle *No autonomy theater*.

- **Wall-clock cap.** A per-task timeout (default **60 minutes**) is checked before every stage; if the budget is exceeded the task halts cleanly with a \`timeout\` reason and still runs its finalize step — never a half-written limbo.
- **Idle / stall watchdog.** If the underlying agent goes silent — no turn-start, text, or tool-call event — for the stall window (default **20 minutes**), the in-flight call is force-aborted. It catches a *hung* provider, not a slow one.
- **Progress guard.** On write tasks, a watchdog flags a worker that burns turns without producing a diff.
- **Clean cancellation.** When a batch is aborted, tasks that never started return a zero-cost cancelled result — never a partial-charged ghost.

Within a call the system owns these loops; between calls the engineer orchestrates — no autonomous sessions, no runaway runs. Time and stall budgets are caller-overridable per task, and cost is **metered precisely** on every result.`,
    underTheHood: `Primary: \`core/src/bounded-execution/\` — \`activity-tracker.ts\`, \`cost-compute.ts\`. Provider-level \`wallClockDeadline\` + \`abortSignal\` enforce time + cost bounds. Defaults in \`core/src/config/schema.ts\`.`,
  },

  // Orchestration — plumbing that helps the caller drive the engine across calls; no workflow state kept.
  {
    id: 'tool-context-block',
    part: 'backend',
    subgroup: 'Orchestration',
    title: 'Register context block',
    body: `Register a document once — a spec, a plan, a prior round's findings — and get back an **ID** you pass to later calls via \`contextBlockIds\`, instead of re-uploading the same content into every worker prompt. Register when a document larger than ~2 KB will be referenced by two or more calls.

It also powers **delta mode**: every read-only result registers its own terminal block automatically, so passing a prior round's ID into round 2 lets the next round track which findings were already **fixed** rather than re-flagging everything. Blocks are immutable, live for the session, and count against the project's quota.`,
    underTheHood: `Primary: \`core/src/stores/\` (context-block-tool, expand-context-blocks, project-context-registry).`,
  },
  {
    id: 'tool-retry',
    part: 'backend',
    subgroup: 'Orchestration',
    title: 'Retry',
    body: `When a task comes back mixed — some indices \`done\`, some \`failed\` — \`retry_tasks\` takes the prior \`taskId\` and re-runs **only the failed indices**, idempotently, inheriting the original task's configuration and diagnostics. Successful indices are never re-run or re-charged.

It's a write route, so retried tasks go through the same lifecycle (and can escalate). Reach for it instead of re-dispatching the whole task list — that would re-charge every task that already succeeded.`,
    underTheHood: `Primary: \`core/src/skills/retry_tasks/\`, \`core/src/unified/task-registry.ts\`.`,
  },
  {
    id: 'tool-task-poll',
    part: 'backend',
    subgroup: 'Orchestration',
    title: 'Poll task',
    body: `Poll a running or completed task by ID (\`GET /task/:taskId\`) — returns the full result envelope including per-index results, status, cost, and timing. For async workflows that dispatch via \`POST /task\` and poll for completion.`,
    underTheHood: `Primary: \`core/src/unified/task-registry.ts\`; handler at \`packages/server/src/http/handlers/unified-task.ts\`.`,
  },

  // ═══════════════════════ IV — FORGE · THE TEAM APP ═══════════════════════
  {
    id: 'forge-role',
    part: 'forge',
    title: 'Forge — the team mode',
    body: `**Forge is the team adoption mode** — a collaborative orchestration app built on the engine, over HTTP. Where using the engine directly is the flexible individual path, Forge gives a team the same lifecycle made *standard*: consistent stages, review gates, roles, and a shared knowledge graph.

Forge owns the SDLC chain and its gates; the engine executes each stateless per-stage rod. It never links the engine's internals — the boundary is strictly HTTP.`,
  },
  {
    id: 'forge-spine',
    part: 'forge',
    title: 'The gated SDLC spine',
    // Stage names as the STEPPER shows them. This said "Exploration" and "Journal" — the
    // enum keys — while a reader looking at Forge sees "Explore" and "Reflect". A manual
    // that names a stage something the product does not call it sends the reader hunting.
    body: `Every project moves through a **gated spine** — Explore → Spec → Plan → Execute → Review → Reflect — each stage a gate the work must clear before advancing. Standardization is the point: the workflow is the same across people, so a team's delivery doesn't depend on which engineer drove it.

- **Explore** — an investigate / research fan-out, then synthesis.
- **Spec** — per-component Q&A authoring, then audit.
- **Plan** — a TDD plan, then audit against the codebase.
- **Execute** — build on the engine, land a PR.
- **Review** — apply cross-agent review findings.
- **Reflect** — harvest learnings into the team's knowledge graph.`,
  },
  {
    id: 'forge-automation',
    part: 'forge',
    title: 'Automation gates at design',
    body: `Forge's **automated mode** can drive the post-design stages — but never the design phases (exploration and early spec are hand-authored), and **it never auto-merges**. Output always lands as a **PR for human review**.

This is Forge's expression of the global principle *No autonomy theater*: the team keeps the judgment at the two places it matters most — **what to build**, and **what to merge**.`,
  },
  {
    id: 'forge-collaboration',
    part: 'forge',
    title: 'Roles, gates & shared knowledge',
    body: `Quality becomes legible to a *team* through roles and gates. Spec components map to role owners (business, PM, SWE, QE); review gates surface findings the team acts on. Cross-agent review from the engine, plus human gates, is how quality becomes structural for a team.

Knowledge is a **team asset**: a team-level journal — a decision graph — records learnings and is recalled before work, so the team doesn't re-tread ground it already covered. Access is scoped by a three-tier model — **org admin** (shared infra: the engine connection, model tiers, teams, cross-team usage), **team admin**, and **member** — so shared credentials and cross-team usage stay separate from a team's own work.`,
  },

  // ═══════════════════════ V — TELEMETRY · PROOF SURFACE ═══════════════════════
  {
    id: 'telemetry-role',
    part: 'telemetry',
    title: 'Telemetry — the proof surface',
    body: `**Telemetry is the proof surface.** It aggregates usage from *both* adoption modes — the engine (individual) and Forge (team) — and presents the economic evidence: how much was saved against a real baseline, what cross-agent review caught, and how work was routed.

It presents evidence; it does not do the labor. (The page you're reading is not part of it — this manual is hosted by **authenticated Forge**, the team app.)`,
  },
  {
    id: 'telemetry-evidence-model',
    part: 'telemetry',
    title: 'One evidence model',
    body: `One **evidence model** spans both modes, so "saved" means the same thing everywhere:

- **Savings** are measured against a *main-equivalent baseline* — actual spend versus what the parent agent alone would have cost.
- **Attribution is per-stage** — cost and model belong to the tier that actually ran each stage, never a route-wide default.
- **The unit is disclosed** — a savings claim is only as credible as its denominator, so the method is shown, not asserted.`,
  },
  {
    id: 'telemetry-honest-null',
    part: 'telemetry',
    title: 'Honest-null discipline',
    body: `**Unknown is not zero.** \`null\` means unknown; \`0\` means genuinely zero. We never fabricate a \`$0\` or \`custom\` sentinel to make a shape look complete, and dashboards keep the unknown portion *visible* rather than folding it into a plausible total. (This isn't theoretical: coercing unresolved cost to zero once under-reported savings — $304 against a true ~$335.)

And cost is never shown alone — a savings number always sits beside **what was caught** (findings, review verdicts), so it can't be read as "cheaper-but-worse."`,
  },
  {
    id: 'telemetry-public-gated',
    part: 'telemetry',
    title: 'Public aggregate, gated detail',
    body: `The posture is **public aggregate, gated detail.** The aggregate economics — savings against the baseline, findings caught, routing — is meant to be public and *defensible to anyone*: lead with one headline against one explicit baseline, disclose the unit, and expect a third-party teardown, so be honest even when the number is unflattering. Per-task drill-through and diagnostics stay gated.`,
    wip: true,
  },
];
