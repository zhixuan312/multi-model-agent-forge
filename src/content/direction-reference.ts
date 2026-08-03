// Structured reference data for the in-app Guide's mechanism explainer.
//
// Sourced from `multi-model-agent/DIRECTION.md` (principles) and from the engine's own
// skill files — `packages/core/src/skills/<type>/implement.md` — so an evaluator reads
// what the harness applies, not a paraphrase. The citation used to name
// `core/src/tools/<route>/*-criteria.ts`, a directory the engine replaced with `skills/`;
// following it led nowhere.
//
// NOTHING CHECKS THIS AUTOMATICALLY. The engine is a sibling repo, not a dependency Forge
// can import in a test, so these constants can only be verified by reading the engine
// beside them — which is how `WRITE_STAGES` came to describe a stage machine that had been
// deleted. Re-read the engine when touching this file; a green suite says nothing here.

export interface Principle {
  n: number;
  title: string;
  text: string;
}

/** The six GLOBAL principles, verbatim from DIRECTION.md § Global Principles.
 *  Engine-specific principles (right-agent routing, the rod set, don't-make-agents-
 *  fail, self-contained requests) live in the engine's own section, not here. */
export const PRINCIPLES: Principle[] = [
  {
    n: 1,
    title: "We help, we don't replace",
    text: "The engineer does judgment; we do labor and gating. We never decide what to build, which approach to take, or whether to merge. The engineer's judgment is input; our output is evidence.",
  },
  {
    n: 2,
    title: 'Quality is structural, not aspirational',
    text: "Quality comes from structure — independent checks, not a model grading its own work: a *different* agent reviews the engine's output, human gates review Forge's, and the proof surface measures independently. (The engine's two-phase review mechanism is detailed under *The engine*, below.) Findings are advisory signal for the engineer, never inflated into failure.",
  },
  {
    n: 3,
    title: 'Evidence and economics are first-class — and honest',
    text: "We prove the work was worth it: real savings against a real baseline, issues caught, routing transparency — reported so it is defensible to anyone, not just the owner. Unknown is never dressed up as zero, and if a number would mislead, we don't show it.",
  },
  {
    n: 4,
    title: 'No autonomy theater',
    text: "Work runs in bounded units with checkpoints, not hours-long autonomous sessions — the engineer decides what happens next. Even Forge's automated mode gates the design phases and keeps a human on the merge. (The engine's cost-ceiling and wall-clock mechanism is detailed under *The engine*, below.)",
  },
  {
    n: 5,
    title: 'The platform is the product; models are configuration',
    text: 'We optimize the system around models, never a model-specific branch — and the whole product stays provider-neutral: the engine routes any model, Forge orchestrates any model, and the proof surface reports across families without favor.',
  },
  {
    n: 6,
    title: "We harness the lifecycle; we don't author it",
    text: 'We instrument and gate each stage — evaluation, review, audit — but the engineer makes every call: what to build, which approach, whether to advance. We are the rails and the gates, never the driver.',
  },
];

// ── Read-only route criteria (exact, from core/src/skills/<route>/) ──

import type { Severity } from '@/lib/severity';
import { LEARNING_CATEGORIES, type LearningCategory } from '@/journal/types';

export interface Criterion {
  id: number;
  title: string;
  desc: string;
  /** Optional perspective group (audit-plan groups its 12 into 3). */
  group?: string;
}

/**
 * What each severity MEANS for a given route — one line per tier.
 *
 * `Record<Severity, string>`, not a hand-written interface listing the four keys: this file
 * holds eight of these ladders, and as a standalone interface a new tier would have had to be
 * added here and then remembered in all eight. Now the compiler names every one.
 */
export type SeverityLadder = Record<Severity, string>;

export interface RouteSubtype {
  key: string;
  /** What this subtype is pointed at. */
  blurb: string;
  criteria: Criterion[];
  /** Subtype-specific overrides (audit spec/skill differ from the route default). */
  findingMeaning?: string;
  severity?: SeverityLadder;
}

export interface ReadRoute {
  route: string;
  tool: string;
  /** Problem-finding (may return zero findings) vs Answer-finding (must emit ≥1). */
  kind: string;
  mustEmit: boolean;
  outcomes: string;
  findingMeaning: string;
  severity: SeverityLadder;
  subtypes: RouteSubtype[];
}

const IMPACT_LADDER: SeverityLadder = {
  critical: 'Severe — must fix before the artifact is used',
  high: 'Significant issue',
  medium: 'Moderate issue',
  low: 'Minor / polish',
};

export const READ_ROUTES: ReadRoute[] = [
  {
    route: 'audit',
    tool: 'audit',
    kind: 'Problem-finding (may return zero findings)',
    mustEmit: false,
    outcomes: 'found / clean',
    findingMeaning: 'An issue in the artifact. Severity = impact.',
    severity: IMPACT_LADDER,
    subtypes: [
      {
        key: 'default',
        blurb: 'General prose-coherence audit (design docs, recommendations, post-mortems, READMEs). Does not verify against any codebase.',
        criteria: [
          { id: 1, title: 'RECOMMENDATION-COHERENCE', desc: "Proposed fix actually solves the stated problem under the doc's own constraints." },
          { id: 2, title: 'INTERNAL CONTRADICTION', desc: 'Section A says something incompatible with section B.' },
          { id: 3, title: 'CROSS-ITEM DUPLICATION', desc: 'Two items address the same root cause without acknowledging each other.' },
          { id: 4, title: 'INDEPENDENCE-CLAIMED-WITHOUT-EVIDENCE', desc: 'X is asserted independent of Y without evidence.' },
          { id: 5, title: 'ARGUMENT SOUNDNESS', desc: 'Evidence chain does not support the conclusion.' },
          { id: 6, title: 'COMPLETENESS AGAINST CONSTRAINTS', desc: 'Constraints stated elsewhere make a recommendation infeasible.' },
          { id: 7, title: 'FIX ACTIONABILITY', desc: 'Proposed fix is too vague to implement.' },
          { id: 8, title: 'DRIFT / STALENESS', desc: 'Counts/claims contradict newer material in the same doc.' },
          { id: 9, title: 'SCOPE-CREEP / FRAMING', desc: 'Recommendations exceed evidence, or framing misrepresents contents.' },
          { id: 10, title: 'STRUCTURAL CONSISTENCY', desc: 'Similar items do not follow the same shape.' },
          { id: 11, title: 'METADATA COMPLETENESS', desc: 'Missing version / last-updated / date support.' },
        ],
      },
      {
        key: 'plan',
        blurb: 'Verifies a code-execution plan against the actual codebase. 12 perspectives in 3 groups. Finding = concrete plan-vs-codebase drift.',
        criteria: [
          { id: 1, title: 'PATH EXISTENCE', desc: 'Every `Files:` path resolves correctly for its label.', group: 'External codebase coherence' },
          { id: 2, title: 'SYMBOL EXISTENCE', desc: 'USE-intent symbols in code blocks exist in source.', group: 'External codebase coherence' },
          { id: 3, title: 'SIGNATURE MATCH', desc: 'Planned call/return shape matches the actual signature.', group: 'External codebase coherence' },
          { id: 4, title: 'IMPORT GRAPH', desc: 'Imports in plan code blocks resolve under the USE/DEFINE rule.', group: 'External codebase coherence' },
          { id: 5, title: 'TEST HARNESS AVAILABILITY', desc: 'Test helpers/factories/fixtures the task uses exist.', group: 'External codebase coherence' },
          { id: 6, title: 'STEP SEQUENCE WITHIN TASK', desc: 'Numbered steps are executable in order.', group: 'External codebase coherence' },
          { id: 7, title: 'CROSS-TASK DEPENDENCIES', desc: 'Task ordering reflects introduced symbols used by later tasks.', group: 'External codebase coherence' },
          { id: 8, title: 'VERIFICATION COMMAND VALIDITY', desc: '`Run:` / verify commands match real project tooling.', group: 'External codebase coherence' },
          { id: 9, title: 'TASK GRANULARITY', desc: 'Each task fits one focused sub-agent run.', group: 'Intra-plan structure' },
          { id: 11, title: 'PLACEHOLDER LANGUAGE', desc: 'No TBD/TODO/vague code-step prose blocks literal execution.', group: 'Intra-plan structure' },
          { id: 12, title: 'PLAN SKELETON', desc: 'Required top-level / task structure exists.', group: 'Intra-plan structure' },
          { id: 10, title: 'SPEC COVERAGE', desc: 'Every load-bearing spec requirement maps to ≥1 task and no task is extra-spec.', group: 'Spec alignment' },
        ],
      },
      {
        key: 'spec',
        blurb: 'Requirement-prose executability audit (9 criteria). Finding = a place where the spec prose fails the executability test.',
        findingMeaning: 'A place where the spec prose fails the executability test.',
        severity: {
          critical: 'Blocks executability',
          high: 'Significant ambiguity / gap',
          medium: 'Clarity gap',
          low: 'Polish',
        },
        criteria: [
          { id: 1, title: 'REQUIREMENT-TESTABILITY', desc: 'Each shall/must/should has a concrete observable outcome.' },
          { id: 2, title: 'SCOPE-EXPLICITNESS-AND-DECOMPOSABILITY', desc: 'Scope is explicit and sized for one implementation plan.' },
          { id: 3, title: 'ACCEPTANCE-CRITERIA-COVERAGE', desc: 'Each requirement maps to acceptance criteria or is explicitly non-testable.' },
          { id: 4, title: 'NON-FUNCTIONAL-CAPTURED', desc: 'Load-bearing non-functionals are stated.' },
          { id: 5, title: 'REQUIREMENT-CONFLICT', desc: 'Incompatible requirements are surfaced.' },
          { id: 6, title: 'DECISION-TRACE', desc: 'Implementation-shaping decisions include reasoning.' },
          { id: 7, title: 'ASSUMPTION-EXPOSURE', desc: 'Hidden assumptions are made explicit.' },
          { id: 8, title: 'PLACEHOLDER-SCAN', desc: 'No unresolved authoring placeholders block planning.' },
          { id: 9, title: 'DESIGN-DECOMPOSITION-PRESENT', desc: 'Architecture / components / data-flow / error-handling / testing present enough for planning.' },
        ],
      },
      {
        key: 'skill',
        blurb: 'SKILL.md reader-effectiveness audit (7 criteria). Finding = a place where the skill text fails the reader-effectiveness test.',
        findingMeaning: 'A place where the skill text fails the reader-effectiveness test.',
        severity: {
          critical: 'Wrong tool routing',
          high: 'Wrong-field dispatch',
          medium: 'Reader hesitation',
          low: 'Stylistic / link / metadata',
        },
        criteria: [
          { id: 1, title: 'WHEN-TO-USE-SPECIFICITY', desc: 'The trigger conditions are specific enough to route correctly.' },
          { id: 2, title: 'INPUT-SHAPE-COMPLETENESS', desc: 'Required inputs / fields are fully specified.' },
          { id: 3, title: 'OUTPUT-SHAPE-CONTRACT', desc: 'The response/output contract is unambiguous.' },
          { id: 4, title: 'ANTI-PATTERN-COVERAGE', desc: 'Common misuse patterns are called out.' },
          { id: 5, title: 'RECIPE-VS-SKILL-SCOPE', desc: 'Scope boundary between this skill and adjacent recipes is clear.' },
          { id: 6, title: 'VERSION-FRONTMATTER', desc: 'Version / frontmatter metadata is present and correct.' },
          { id: 7, title: 'LINK-INTEGRITY', desc: 'Internal/external links resolve.' },
        ],
      },
    ],
  },
  {
    route: 'review',
    tool: 'review',
    kind: 'Problem-finding (may return zero findings)',
    mustEmit: false,
    outcomes: 'found / clean',
    findingMeaning: 'An issue introduced or worsened by the change under review.',
    severity: {
      critical: 'Production-breaking on merge',
      high: 'Correctness gap surfacing in normal use',
      medium: 'Maintainability / fragility',
      low: 'Style',
    },
    subtypes: [
      {
        key: 'default',
        blurb: 'Quality / security / correctness pass over source code, one worker per file. The 10 categories a careful maintainer scans before pressing merge.',
        criteria: [
          { id: 1, title: 'TEST GAP', desc: 'Behavior changes without tests that exercise the change.' },
          { id: 2, title: 'CROSS-FILE RIPPLE', desc: 'Changed public symbol/shape has unupdated external references.' },
          { id: 3, title: 'PRE-EXISTING-BUG-VS-NEW-REGRESSION', desc: 'Separate prior bugs from defects introduced or worsened by the diff.' },
          { id: 4, title: 'MISSING EDGE CASE', desc: 'Changed path misses null/empty/timeout/error/zero/negative handling.' },
          { id: 5, title: 'RACE / CONCURRENCY', desc: 'Shared-state / TOCTOU / atomicity hazards.' },
          { id: 6, title: 'RESOURCE LEAK', desc: 'Opened handles/promises lack guaranteed cleanup.' },
          { id: 7, title: 'BACKWARD-COMPAT BREAK', desc: 'Public API/type/schema/env/CLI breaks callers.' },
          { id: 8, title: 'SECURITY REGRESSION', desc: 'Auth bypass / injection / untrusted sink / data exposure / sandbox weakening.' },
          { id: 9, title: 'PERFORMANCE REGRESSION', desc: 'N+1 / unbounded / blocking I/O / deep clone / request-time work shifts.' },
          { id: 10, title: 'IMPLICIT-CONTRACT ASSUMPTION', desc: 'Changed code relies on unstated caller/environment behavior.' },
        ],
      },
    ],
  },
  {
    route: 'debug',
    tool: 'debug',
    kind: 'Answer-finding (must emit ≥1 finding)',
    mustEmit: true,
    outcomes: 'found / not_applicable',
    findingMeaning: 'A root-cause hypothesis (or contributing factor).',
    severity: {
      critical: 'Confirmed root cause',
      high: 'Very likely root cause; one step unconfirmed',
      medium: 'Plausible hypothesis',
      low: 'Peripheral observation',
    },
    subtypes: [
      {
        key: 'default',
        blurb: 'Investigate a failure from 5 angles — reproduce, trace, localize the root cause.',
        criteria: [
          { id: 1, title: 'SYMPTOM-LOCATION ANGLE', desc: 'Trace upstream from where the failure surfaces.' },
          { id: 2, title: 'RECENT-CHANGE ANGLE', desc: 'Inspect recent diffs/commits on involved files.' },
          { id: 3, title: 'TEST-FAILURE ANGLE', desc: 'Read failing/expected test assertions and locate the contract break.' },
          { id: 4, title: 'REPRODUCTION ANGLE', desc: 'Infer the minimum input/state/config that triggers the failure.' },
          { id: 5, title: 'CONCURRENCY / CONFIGURATION ANGLE', desc: 'Check timing/ordering/async/env/config dependencies.' },
        ],
      },
    ],
  },
  {
    route: 'investigate',
    tool: 'investigate',
    kind: 'Answer-finding (must emit ≥1 finding)',
    mustEmit: true,
    outcomes: 'found / not_applicable',
    findingMeaning: 'A candidate answer to the question. Severity = confidence.',
    severity: {
      critical: 'Direct verbatim citation',
      high: 'Clearly inferable from cited source',
      medium: 'Single interpretation step required',
      low: 'Weak inference',
    },
    subtypes: [
      {
        key: 'default',
        blurb: 'Answer a question about the codebase from 5 perspectives; each finding is a candidate answer ranked by confidence.',
        criteria: [
          { id: 1, title: 'DIRECT-SYMBOL-TRACE PERSPECTIVE', desc: 'Start from named/implied symbols/files and follow imports/calls/types step-by-step.' },
          { id: 2, title: 'CALLER-ANALYSIS PERSPECTIVE', desc: 'Inspect callers/consumers and their assumed contract.' },
          { id: 3, title: 'TEST-DRIVEN PERSPECTIVE', desc: 'Read sibling tests and what they assert.' },
          { id: 4, title: 'CROSS-FILE DEPENDENCY-MAP PERSPECTIVE', desc: 'Map participating modules/config/receivers around the data path.' },
          { id: 5, title: 'DOCUMENTATION/COMMENT-LENS PERSPECTIVE', desc: 'Read docstrings/README/design-doc/in-code comments and cross-check against code.' },
        ],
      },
    ],
  },
];

// ── The development lifecycle the harness gates (flow verbatim from DIRECTION.md) ──

export interface LifecycleStage {
  /** Stage name — shown as the node title. */
  stage: string;
  /** Short description paragraphs (markdown), each leading with its tool name. */
  desc: string[];
}

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    stage: 'Design',
    desc: [
      '`mma-design` runs the interactive discovery: `investigate` looks **inward** (what the codebase has), `research` looks **outward** (prior art, best practice), and `journal-recall` looks **backward** (the project’s own past learnings) — then structures the decisions with the engineer.',
    ],
  },
  {
    stage: 'Spec',
    desc: [
      '`spec` turns the confirmed decisions into a formal **specification** on disk — context, problem, goals, requirements, testing plan, and numbered acceptance criteria.',
    ],
  },
  {
    stage: 'Spec audit',
    desc: [
      '`audit: spec` gates the requirement and testing plan for **testability and decision-trace** — the loop repeats until no critical or high findings remain, before any plan is written.',
    ],
  },
  {
    stage: 'Plan',
    desc: [
      '`plan` turns the spec into a **TDD implementation plan** — ordered, bite-sized tasks with exact file paths, code, and verification commands.',
    ],
  },
  {
    stage: 'Plan audit',
    desc: [
      '`audit: plan` checks the plan against **both the spec and the actual codebase** — every named file, symbol, and command must exist — looping until it is **executable and feasible** before a worker runs.',
    ],
  },
  {
    stage: 'Execute',
    desc: [
      'On a fresh project branch, `execute_plan` implements the plan **one task at a time, in order**; `delegate` runs ad-hoc work that has no plan. Both run on lean standard-tier agents with full tools, cost ceilings, and sandboxing.',
    ],
  },
  {
    stage: 'Review',
    desc: [
      '`review` has a *different* agent review the produced diff before merge — correctness, security, maintainability. Cross-agent review catches what self-review structurally can’t; its loop repeats until findings are clear.',
    ],
  },
  {
    stage: 'Verify',
    desc: [
      'The **whole repo builds and its tests pass green** on the branch. A failure sends `debug` (localize the root cause) and `retry` (re-run only the failed work, idempotently) back to Plan / Execute — a failure becomes a fix.',
    ],
  },
  {
    stage: 'Ship',
    desc: [
      'Push the branch and open a **pull request**. Merge only when the deferred-decision ledger is clear — **never auto-merge**. The engineer keeps the last call: what to merge.',
    ],
  },
  {
    stage: 'Record',
    desc: [
      '`journal-record` captures what this cycle learned into the durable graph — **create / refine / supersede / merge** against the existing notes, never a blind append — so the next cycle’s `journal-recall` at **Design** starts ahead. The lifecycle closes by feeding itself.',
    ],
  },
];

// ── The three agent layers (from DIRECTION.md § The Insight) ──

export interface AgentLayer {
  name: string;
  /** Which slot this layer maps to (markdown). */
  tag: string;
  /** The layer's responsibility (markdown). */
  role: string;
  /** Example models. */
  examples: string;
  kind: 'main' | 'slot';
}

export const AGENT_LAYERS: AgentLayer[] = [
  {
    name: 'Main agent',
    tag: 'yours — not one of our slots',
    role: 'Keeps the **judgment**: architecture, design, brainstorming, and final validation — what to build, which approach, whether to merge. It never enters our slots.',
    examples: 'Opus · GPT-5 — whatever you’re talking to',
    kind: 'main',
  },
  {
    name: 'Complex agent',
    tag: '`complex` slot',
    role: 'Advanced labor: code review, plan auditing, spec verification, security analysis.',
    examples: 'Claude Opus · GPT-5 · Claude Sonnet',
    kind: 'slot',
  },
  {
    name: 'Standard agent',
    tag: '`standard` slot',
    role: 'Heavy lifting: implementation, file writes, test runs, mechanical work.',
    examples: 'DeepSeek · MiniMax · Claude Haiku',
    kind: 'slot',
  },
];

// ── Write-route execution stages (STAGE_PLAN, from core/src/lifecycle/) ──

export interface ExecStage {
  name: string;
  what: string;
}

/**
 * What a write route (delegate / execute_plan) actually runs, in order.
 *
 * This listed a SIX-stage machine — prepare · implement · review · rework · commit ·
 * annotate — plus `register-block`, `compose` and `terminal`. That was the engine's
 * `lifecycle/` layer, which has been deleted: write routes now run
 * `runTwoPhasePipeline` (implementer, then refiner), the caller owns the branch, and
 * `rework`/`annotate` survive only as stage NAMES in the telemetry wire format. The
 * neighbouring comment in this file already noted the lifecycle layer was gone; this
 * list had not caught up, and it is rendered in the in-app Guide.
 */
export const WRITE_STAGES: ExecStage[] = [
  { name: 'baseline', what: 'Record HEAD before any worker starts, on the branch the CALLER already checked out — the engine cuts no branch and no worktree.' },
  { name: 'implement', what: 'The worker does the work directly in the submitted cwd: full tool access, sandbox confinement, wall-clock deadline and cost ceiling, progress streaming. Git is denied to the worker.' },
  { name: 'refine', what: 'The second agent reviews and re-emits the answer in the same format — spec conformance first, then code quality. Skipped entirely when the caller sends `reviewPolicy: "none"`.' },
  { name: 'commit', what: 'The engine commits, from outside every sandbox, after checking the worker did not move HEAD or switch branch. A cancelled run deliberately commits nothing and leaves its edits in the tree.' },
];

// ── Research sources (from `packages/core/src/research/` + config) ──
// The old citation named the engine's `lifecycle/` layer, which has since been deleted.

export interface ResearchSource {
  name: string;
  covers: string;
  /** Authentication required to enable the source; `null` when the source is open.
   *  NOT a dash — the placeholder glyph is the view's choice, and `ResearchSources`
   *  used to compare against a literal '—' declared over here. */
  auth: string | null;
}

/** The external sources the `research` route fans out across. Web search is
 *  Brave; three sources require credentials and are otherwise skipped. */
export const RESEARCH_SOURCES: ResearchSource[] = [
  { name: 'brave', covers: 'General web search — the web-search backend (supports `site:` filters).', auth: 'Brave API key' },
  { name: 'semantic_scholar', covers: 'Academic search and citation graph.', auth: 'API key' },
  { name: 'github_search', covers: 'GitHub repository and code search.', auth: 'GitHub token (PAT)' },
  { name: 'arxiv', covers: 'Pre-print academic papers.', auth: null },
  { name: 'rss', covers: 'RSS / Atom feeds you configure.', auth: null },
  { name: 'web_fetch', covers: 'Fetch a specific URL directly.', auth: null },
];

// ── Journal mechanism (from the mma-journal design spec, 2026-05-23) ──

export interface FlowStep {
  name: string;
  /** Step detail (markdown). */
  detail: string;
}

/**
 * What each OKF `type` means (from journal_record/implement.md).
 *
 * The TYPES come from `LEARNING_CATEGORIES` — the taxonomy the product classifies with — and
 * this file supplies the prose for each. It used to restate the six names as well, so the
 * manual held its own copy of the taxonomy it describes: a seventh category would have gone
 * undocumented in silence, and a renamed one would have left the manual describing a type
 * that no longer exists. The record is TOTAL, so a new category cannot be added without
 * writing the line that explains it.
 */
const JOURNAL_TYPE_DETAIL: Record<LearningCategory, string> = {
  decision: 'What was tried and what happened — and what to do instead, and when it applies.',
  design: 'Why the system is structured this way — the constraints it creates, what breaks if violated.',
  behavior: 'How the user works — the preferences and patterns worth honoring next time.',
  process: 'What works in the SDLC — a repeatable way of running the work itself.',
  knowledge: 'A research finding or ecosystem fact — established once, reused instead of re-derived.',
  style: 'A documentation or code convention the project follows.',
};

export const JOURNAL_TYPES: FlowStep[] = LEARNING_CATEGORIES.map((name) => ({
  name,
  detail: JOURNAL_TYPE_DETAIL[name],
}));

/** Record flow — POST /journal-record, the write route. */
export const JOURNAL_RECORD: FlowStep[] = [
  { name: 'Read', detail: 'The complex worker reads `index.md`, the related nodes, and `schema.md` with read-only tools — the existing graph as context.' },
  { name: 'Decide', detail: 'Dedup judgment against existing nodes: **create** (new lesson), **refine** (more detail), **supersede** (conclusion changed), or **merge** (duplicate).' },
  { name: 'Write', detail: 'Writes/edits the node file(s), updates the `index.md` catalogue, and appends one line to the immutable `log.md` — only under `.mma/journal/`.' },
  { name: 'Review', detail: 'A reviewer critiques the file changes — right outcome, valid frontmatter + edges, no stray writes — and the worker reworks until they converge. Cross-agent, not unilateral.' },
  { name: 'Commit', detail: 'The standard git-commit handler commits the files (or no-ops if the project isn’t a repo — the files persist on disk either way).' },
];

/** Recall flow — POST /journal-recall, the read route. */
export const JOURNAL_RECALL: FlowStep[] = [
  { name: 'Query', detail: 'A vague, conceptual question — no tags or exact terms needed.' },
  { name: 'Read index', detail: 'The read-only worker reads `index.md` to find the candidate nodes.' },
  { name: 'Traverse', detail: 'Opens the relevant nodes and **follows their frontmatter edges** to gather the connected subgraph.' },
  { name: 'Synthesize', detail: 'Ranks the learnings by how directly they answer and composes an answer — never a raw dump.' },
  { name: 'Return', detail: 'Findings, each citing its node (`id` + path), plus a synthesis; superseded nodes are excluded unless history is asked for.' },
];

export interface StoreLayer {
  file: string;
  /** What this file holds (markdown). */
  holds: string;
}

/** The journal store — WikiLLM three layers, project-scoped. */
export const JOURNAL_STORE: StoreLayer[] = [
  { file: 'schema.md', holds: 'Conventions — the edge-type vocabulary, status enum, and tag taxonomy every record worker follows.' },
  { file: 'index.md', holds: 'Catalogue — one row per node (`id` · status · title · tags). At this scale the index *is* the retrieval infrastructure; no embeddings.' },
  { file: 'nodes/NNNN-*.md', holds: 'One file per learning — frontmatter (`id`, `status`, `tags`, typed `links`) + Context / Consequences. The graph edges live here.' },
  { file: 'log.md', holds: 'Immutable, append-only — one line per raw learning submitted. Provenance and audit.' },
];
