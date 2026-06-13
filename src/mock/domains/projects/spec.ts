import { COMPONENT_TEMPLATES, defaultComponentKinds } from '@/spec/components';
import { findMockProject } from '@/mock/domains/projects/dashboard';
import type { ComponentView, SectionView } from '@/spec/spec-core';
import type { ComponentKind, ComponentStatus, ProjectPhase } from '@/db/enums';
import type { QaMessageView } from '@/components/forge/Composer';
import type { AuditPassView, AuditFinding } from '@/components/forge/SpecStageClient';

/**
 * Stateful mock for the Spec stage (Spec 4 Part A) so the Outline → Interview →
 * Document flow is walkable without a DB. The component outline mirrors
 * COMPONENT_TEMPLATES; answering a section advances its satisfaction flags,
 * nodding approves it, assembling builds the spec doc, and the audit loop
 * produces a pass timeline that unlocks the freeze handoff. Per-process — a fresh
 * confirm regenerates it (exactly right for a walk-through).
 */

interface SpecState {
  intentMd: string;
  components: ComponentView[];
  messages: Record<string, QaMessageView[]>;
  spec: { version: number; bodyMd: string } | null;
  audit: AuditPassView[];
  canFreeze: boolean;
}

const STORE = new Map<string, SpecState>();

const DEFAULT_KINDS: ComponentKind[] = defaultComponentKinds();

const INTENT =
  'Unify MMA execution behind a single POST /task endpoint: one goal-based pipeline (implementer → reviewer → deterministic annotate), a flat per-type registry, per-type skill files, reviewPolicy collapsed to reviewed|none, session reuse, and worktree isolation for write types. Remove the batch system and the read/write engine split.';

/**
 * Realistic per-component craft content (drawn from the Unified Task API design
 * spec) so the Craft conversation displays substantive spec data: each entry is
 * the Forge question rounds + the constructed draft for a component kind. Falls
 * back to the generic template-derived flow for kinds not listed here.
 */
export interface CraftSeed {
  questions: string[][];
  draftMd: string;
}

export const CRAFT_CONTENT: Partial<Record<ComponentKind, CraftSeed>> = {
  context_scope: {
    questions: [
      [
        'What problem space does this sit in, and what is the current state of execution in MMA?',
        'What is explicitly in scope for this spec versus deferred to follow-up specs?',
      ],
    ],
    draftMd: `### Background

MMA today runs **two** execution pipelines — a sequential criteria loop for read routes (audit, investigate, review, debug, research, journal_recall) and goal-based execution for write routes (delegate, execute_plan). Two engines violates Principle 7 ("rods are thin presets over one engine").

### Scope

**In scope:** a single \`POST /task\` endpoint, a unified two-phase pipeline (implementer → reviewer → deterministic annotate), a flat type registry, per-type skill files, and \`reviewPolicy\` collapsed to \`reviewed | none\`.

**Out of scope:** Forge client migration, wire-schema v6 coordination, OpenAPI regeneration, and skill-file prompt content (iterative, not spec-driven).`,
  },
  goals_nongoals: {
    questions: [
      ['What does success look like for the unified pipeline?', 'What are the explicit non-goals we are committing to?'],
    ],
    draftMd: `### Goals

- One endpoint, one pipeline, one mental model — every type runs implementer → reviewer → annotate.
- Type-specific behavior lives in **skill files**, not pipeline branching.
- Adding a new type = a registry entry + two skill files, with **zero** pipeline code changes.

### Non-goals

- No server-side multi-task fan-out — the caller fires N concurrent \`POST /task\` calls.
- No \`retry\` route — callers re-send the original payload (self-contained requests, Principle 9).
- No LLM judge in annotate — outputs are parsed deterministically.`,
  },
  proposed_design: {
    questions: [
      [
        'Walk through the request lifecycle from POST /task to the response envelope.',
        'How is the implementer/reviewer tier resolved, and why the inversion?',
      ],
      [
        'How do worktree (write) types differ in the pipeline?',
        'When is the worktree cleaned up versus preserved?',
      ],
    ],
    draftMd: `### Design overview

Every task runs the same pipeline: parse + validate (Zod discriminated union on \`type\`) → resolve tiers (implementer = requested/default, reviewer = **opposite** tier) → resolve providers → optional worktree setup → load \`implement.md\` + \`review.md\` → Phase 1 implementer goal → Phase 2 reviewer goal (if reviewed) → deterministic annotate → compose envelope → cleanup.

### System-context diagram

\`\`\`mermaid
flowchart LR
  C[Caller] -->|POST /task| H[Unified handler]
  H --> P1[Implementer goal]
  P1 --> P2[Reviewer goal]
  P2 --> A[Annotate]
  A --> E[TaskEnvelope]
\`\`\`

### Design details

Tier inversion maximizes model diversity (Principle 3): the reviewer always runs on the opposite tier, so a different model — different training data, different failure modes — checks the work. Worktree types execute both phases in \`.mma/worktrees/<short-id>\`; a worktree with no changes is auto-removed, one with changes is preserved and its branch returned.`,
  },
  interfaces_apis: {
    questions: [
      ['What is the dispatch and poll contract — request shape and status codes?', 'How is the type-specific payload validated?'],
    ],
    draftMd: `### Interfaces & APIs

\`POST /task\` accepts \`{ type, agentTier?, reviewPolicy?, sessionIds?, cwd, contextBlockIds?, ...payload }\` → \`202 { taskId }\`. \`GET /task/:taskId\` returns \`202 text/plain\` (pending headline) or \`200 application/json\` (terminal \`TaskEnvelope\`), and \`404\` for unknown ids.

Type-specific payloads (e.g. \`audit: { filePaths }\`, \`investigate: { question }\`, \`delegate: { tasks }\`) are validated by a **Zod discriminated union** on \`type\`.`,
  },
  data_storage: {
    questions: [
      ['What does the terminal response envelope contain?', 'How are sessions represented, including providers without durable resume?'],
    ],
    draftMd: `### Data model & schema

The terminal \`TaskEnvelope\` carries \`{ taskId, type, status: 'done' | 'done_with_concerns' | 'failed', report, sessions, worktree | null, cost, error | null }\`. \`sessions.implementer\` / \`sessions.reviewer\` each expose \`{ tier, sessionId | null, resumeSupported }\` — \`sessionId\` is null for providers without durable resume (Codex); \`reviewer\` is null when \`reviewPolicy: 'none'\`.

### Storage & retention

Provider sessions **survive** task completion (Claude SDK sessions persist at \`~/.claude/projects/\`); local handles are released and ids returned for optional reuse.`,
  },
  alternatives: {
    questions: [
      ['What alternatives were considered for the batch / fan-out feature?', 'Why collapse reviewPolicy from four values to two?'],
    ],
    draftMd: `### Options considered

We considered keeping server-side multi-task batches and the 4-value \`reviewPolicy\` (\`full | quality_only | diff_only | none\`).

### Why rejected

Server-side batches added coordination complexity (headline aggregation, cost rollup, multi-envelope state) for something the caller achieves with N concurrent calls — removing it deletes \`batch-registry.ts\`, \`batch-cache.ts\`, and the batch endpoint. The \`reviewPolicy\` refinements are now fully expressed by the \`review.md\` skill, so the pipeline only needs \`reviewed | none\`.`,
  },
  cross_cutting: {
    questions: [
      ['What is the sandbox and tier model, and how does it apply across both phases?', 'Any security, observability, or performance considerations?'],
    ],
    draftMd: `### Security & privacy

Sandbox policy is **derived from type** and applies to both phases: read-only types run both implementer and reviewer read-only; write types run cwd-only scoped to the worktree. The \`investigate\` enrichment hook canonicalizes file paths with a cwd-escape check.

### Observability

Telemetry is simplified to **per-task** (was per-batch). Bounded execution (wall-clock + idle guards) still enforces limits.

### Performance & NFRs

A single wall-clock guard covers both phases (shared deadline first; per-phase budgets later if Phase 2 starves). The safety ceiling is raised to 200 concurrent sessions.`,
  },
  test_validation: {
    questions: [
      ['What is the testing strategy across unit, integration, and contract layers?', 'What are the key acceptance criteria for the pipeline and sessions?'],
    ],
    draftMd: `### Test strategy

- **Unit:** type-registry validity, per-type Zod schemas, structured-reviewer-output parser, deterministic annotate, session-id extraction.
- **Integration:** full pipeline per type, \`reviewPolicy: none\` path, worktree lifecycle (with / without changes), session resume, mixed providers, timeout.
- **Contract / goldens:** dispatch 202, poll shapes, per-type envelope, legacy-route 404s, wire-schema v6.

### Acceptance & regression

AC8 reviewed → both phases run, \`sessions.reviewer\` non-null. AC9 none → implementer only, reviewer null. AC10 implementer on requested tier, reviewer opposite. AC22 resuming \`sessionIds.implementer\` continues the conversation (Claude).`,
  },
  rollout_migration: {
    questions: [
      ['What is the migration path given dev-mode (no backward compatibility)?', 'What gets removed versus kept?'],
    ],
    draftMd: `### Rollout plan

Dev-mode (v0.1.0): implement \`POST /task\` + the 2-phase pipeline **alongside** existing routes, create skill files (delegate + audit first), wire worktree + session reuse, then delete old per-route handlers, the batch system, and the criteria loop; regenerate contract goldens.

### Migration & backout

Wire schema bumps **5 → 6** (\`reviewPolicy\` 4→2, \`batchId\`→\`taskId\`), needing downstream coordination. Removed: \`batch-registry.ts\`, \`batch-cache.ts\`, \`GET /batch/:id\`, per-tool handlers, \`briefSlot()\`, \`ToolSurfaceRegistry\`. Kept (simplified): provider factory, RunnerShell + adapters, session management, cost metering, sandbox enforcement.`,
  },
};

/** Build the component outline for the picked kinds — every section starts fresh
 *  (gathering); the section-by-section interview is what advances them. */
function buildComponents(kinds: ComponentKind[]): ComponentView[] {
  return COMPONENT_TEMPLATES.filter((t) => kinds.includes(t.kind)).map((t, ci) => {
    const sections: SectionView[] = t.sections.map((s, si) => ({
      id: `mock-sec-${t.kind}-${s.key}`,
      key: s.key,
      label: s.label,
      status: 'gathering' as ComponentStatus,
      aiSatisfied: false,
      humanSatisfied: false,
      forced: false,
      draftMd: null,
      stale: false,
      orderIndex: si,
    }));
    return {
      id: `mock-cmp-${t.kind}`,
      kind: t.kind,
      label: t.label,
      primaryRoles: t.primaryRoles,
      status: rollUp(sections),
      orderIndex: ci,
      sections,
    };
  });
}

/** Component status = the least-advanced section (matches componentStatusRank). */
function rollUp(sections: SectionView[]): ComponentStatus {
  const order: ComponentStatus[] = ['gathering', 'satisfied', 'drafted', 'approved'];
  let min = 3;
  for (const s of sections) min = Math.min(min, order.indexOf(s.status));
  return order[min] ?? 'gathering';
}

function ensure(projectId: string): SpecState {
  let st = STORE.get(projectId);
  if (!st) {
    st = {
      intentMd: INTENT,
      components: [], // outline not yet confirmed → the stage lands on Outline
      messages: {},
      spec: null,
      audit: [],
      canFreeze: false,
    };
    STORE.set(projectId, st);
  }
  return st;
}

/* ── Page bundle ──────────────────────────────────────────────────────────── */

export interface MockSpecBundle {
  projectName: string;
  intentMd: string;
  phase: ProjectPhase;
  mainTierReady: boolean;
  mmaReady: boolean;
  defaultKinds: ComponentKind[];
  initialComponents: ComponentView[];
  initialSpec: { version: number; bodyMd: string } | null;
  initialAuditHistory: AuditPassView[];
  initialCanFreeze: boolean;
  craftContent: Partial<Record<ComponentKind, CraftSeed>>;
}

export function mockSpec(projectId: string): MockSpecBundle {
  const st = ensure(projectId);
  const proj = findMockProject(projectId);
  return {
    projectName: proj?.name ?? 'Project',
    intentMd: st.intentMd,
    phase: 'design',
    mainTierReady: true,
    mmaReady: true,
    defaultKinds: DEFAULT_KINDS,
    initialComponents: st.components,
    initialSpec: st.spec,
    initialAuditHistory: st.audit,
    initialCanFreeze: st.canFreeze,
    craftContent: CRAFT_CONTENT,
  };
}

/* ── Interactive route mocks ──────────────────────────────────────────────── */

export function confirmMock(projectId: string, intentMd: string, kinds: ComponentKind[]): ComponentView[] {
  const st = ensure(projectId);
  st.intentMd = intentMd;
  st.components = buildComponents(kinds.length > 0 ? kinds : DEFAULT_KINDS);
  STORE.set(projectId, st);
  return st.components;
}

interface SectionRepaint {
  section: Pick<SectionView, 'status' | 'aiSatisfied' | 'humanSatisfied' | 'forced' | 'draftMd' | 'stale'>;
  qaMessages: QaMessageView[];
  component: { status: ComponentStatus };
}

function find(st: SpecState, sectionId: string): { comp: ComponentView; sec: SectionView } | null {
  for (const comp of st.components) {
    const sec = comp.sections.find((s) => s.id === sectionId);
    if (sec) return { comp, sec };
  }
  return null;
}

function repaint(st: SpecState, sectionId: string): SectionRepaint {
  const hit = find(st, sectionId)!;
  hit.comp.status = rollUp(hit.comp.sections);
  return {
    section: {
      status: hit.sec.status,
      aiSatisfied: hit.sec.aiSatisfied,
      humanSatisfied: hit.sec.humanSatisfied,
      forced: hit.sec.forced,
      draftMd: hit.sec.draftMd,
      stale: hit.sec.stale,
    },
    qaMessages: st.messages[sectionId] ?? [],
    component: { status: hit.comp.status },
  };
}

export function answerMock(projectId: string, sectionId: string, answerMd: string): SectionRepaint {
  const st = ensure(projectId);
  const hit = find(st, sectionId);
  if (!hit) throw new Error('unknown section');
  const msgs = st.messages[sectionId] ?? [];
  const turn = msgs.filter((m) => m.sender === 'member').length;
  msgs.push({ id: `m-${sectionId}-${msgs.length}`, sender: 'member', bodyMd: answerMd });
  // After two member answers the AI is satisfied and proposes a draft.
  if (turn >= 1) {
    hit.sec.aiSatisfied = true;
    hit.sec.status = 'drafted';
    hit.sec.draftMd = `Based on our discussion: ${answerMd.slice(0, 160)}${answerMd.length > 160 ? '…' : ''}`;
    msgs.push({
      id: `f-${sectionId}-${msgs.length}`,
      sender: 'forge',
      bodyMd: 'Thanks — I have enough to draft this section. Review the draft below and nod when it looks right.',
    });
  } else {
    hit.sec.status = 'satisfied';
    msgs.push({
      id: `f-${sectionId}-${msgs.length}`,
      sender: 'forge',
      bodyMd: 'Got it. One more thing — what constraints or edge cases should this section capture?',
    });
  }
  st.messages[sectionId] = msgs;
  return repaint(st, sectionId);
}

export function nodMock(projectId: string, sectionId: string): SectionRepaint {
  const st = ensure(projectId);
  const hit = find(st, sectionId)!;
  hit.sec.humanSatisfied = true;
  hit.sec.status = 'approved';
  if (!hit.sec.draftMd) hit.sec.draftMd = `_(approved — ${hit.sec.label})_`;
  return repaint(st, sectionId);
}

export function forceMock(projectId: string, sectionId: string): SectionRepaint {
  const st = ensure(projectId);
  const hit = find(st, sectionId)!;
  hit.sec.forced = true;
  hit.sec.humanSatisfied = true;
  hit.sec.status = 'approved';
  if (!hit.sec.draftMd) hit.sec.draftMd = `_(force-advanced — ${hit.sec.label})_`;
  return repaint(st, sectionId);
}

export function assembleMock(projectId: string): { version: number; body_md: string } {
  const st = ensure(projectId);
  // Recover the outline if the in-memory store was reset (e.g. a dev HMR reload)
  // since confirm — otherwise the assembled body would be empty.
  if (st.components.length === 0) st.components = buildComponents(DEFAULT_KINDS);
  const version = (st.spec?.version ?? 0) + 1;
  const body = assembleBody(st);
  st.spec = { version, bodyMd: body };
  STORE.set(projectId, st);
  return { version, body_md: body };
}

function assembleBody(st: SpecState): string {
  const parts: string[] = [];
  for (const c of st.components) {
    parts.push(`## ${c.label}`);
    const seed = CRAFT_CONTENT[c.kind];
    if (seed) {
      // The crafted draft already carries its own ### sub-headings.
      parts.push(seed.draftMd);
    } else {
      for (const s of c.sections) {
        parts.push(`### ${s.label}`);
        parts.push(s.draftMd ?? '_Captured in the conversation._');
      }
    }
  }
  return parts.join('\n\n');
}

const AUDIT_FINDINGS: AuditFinding[][] = [
  // Pass 1 — a full sweep: 21 findings across every severity (2 critical · 5 high · 8 medium · 6 low).
  [
    { severity: 'critical', category: 'security', claim: 'The worktree sandbox check trusts the resolved path but never re-validates after symlink resolution — a crafted symlink lets a write task escape cwd.' },
    { severity: 'critical', category: 'correctness', claim: 'Phase-2 review can run on the same session as Phase-1, so a compromised implementer prompt can suppress its own review — violates Principle 3.' },
    { severity: 'high', category: 'testability', claim: 'Phase-2 starvation is acknowledged but the shared-deadline budget has no concrete threshold — untestable as written.' },
    { severity: 'high', category: 'correctness', claim: 'The implementer structured-output format is deferred yet annotate depends on it — leaves a parsing gap.' },
    { severity: 'high', category: 'reliability', claim: 'No retry/backoff is specified for a provider 5xx during implement — the whole task fails instead of degrading.' },
    { severity: 'high', category: 'security', claim: 'POST /task accepts an arbitrary cwd with no allow-list; a caller can point a write task at any path on the host.' },
    { severity: 'high', category: 'data-integrity', claim: 'Concurrent write tasks share one git index in the same worktree — parallel commits can corrupt the tree.' },
    { severity: 'medium', category: 'completeness', claim: 'The type registry lists default tier + sandbox but not the reviewer tier per type — cross-tier review can’t be configured.' },
    { severity: 'medium', category: 'observability', claim: 'Stage timings are emitted but cost-per-stage is not attributed back to the calling main model.' },
    { severity: 'medium', category: 'api', claim: 'GET /task/:taskId has no terminal-vs-pending discriminator beyond HTTP status — clients must guess.' },
    { severity: 'medium', category: 'performance', claim: 'Collapsing the per-criterion loop into one goal prompt drops prefix caching, but the token-cost delta is not estimated.' },
    { severity: 'medium', category: 'migration', claim: 'The batch-system removal lists files to delete but not the consumers that still import batch-registry.' },
    { severity: 'medium', category: 'sessions', claim: 'Session reuse is Claude-only, yet sessionIds are exposed for all providers — Codex reuse will silently no-op.' },
    { severity: 'medium', category: 'clarity', claim: '“reviewed | none” is defined but the default per type isn’t stated, so behavior on an unset policy is ambiguous.' },
    { severity: 'medium', category: 'error-handling', claim: 'The enrichment hook can throw, but fail-open vs fail-closed behavior on a hook failure is unspecified.' },
    { severity: 'low', category: 'clarity', claim: 'The type-specific enrichment-hook contract is named but its interface is not specified.' },
    { severity: 'low', category: 'naming', claim: '“implement.md” / “review.md” skill filenames aren’t reserved — a custom type named “review” would collide.' },
    { severity: 'low', category: 'docs', claim: 'The wire-schema bump (v5→v6) is mentioned without a field-level diff.' },
    { severity: 'low', category: 'consistency', claim: 'Some sections say “worker” and others “implementer” for the same role.' },
    { severity: 'low', category: 'ergonomics', claim: 'No example request body is given for the simplest read task (investigate).' },
    { severity: 'low', category: 'observability', claim: 'Log lines omit the taskId, making multi-task runs hard to correlate.' },
  ],
  // Pass 2 — 9 findings remain after the first round of fixes (still 1 high → revised).
  [
    { severity: 'high', category: 'security', claim: 'POST /task now has a cwd allow-list, but symlinked paths inside cwd still aren’t normalized before the write.' },
    { severity: 'medium', category: 'completeness', claim: 'The reviewer tier is in the registry, yet two types still default it to the implementer’s tier.' },
    { severity: 'medium', category: 'api', claim: 'GET /task/:taskId documents the terminal discriminator but not the pending-headline format.' },
    { severity: 'medium', category: 'observability', claim: 'Cost-per-stage is emitted but not rolled up into the task-level total.' },
    { severity: 'medium', category: 'sessions', claim: 'Codex session reuse now no-ops explicitly, but the response doesn’t signal that to the caller.' },
    { severity: 'low', category: 'naming', claim: 'A custom type named “review” still collides with the reserved review.md skill file.' },
    { severity: 'low', category: 'docs', claim: 'The v5→v6 diff is added, but the migration note omits reviewPolicy’s removed values.' },
    { severity: 'low', category: 'consistency', claim: '“worker” vs “implementer” wording is fixed in the overview but not in the diagrams.' },
    { severity: 'low', category: 'ergonomics', claim: 'Example request bodies cover read tasks but not execute_plan.' },
  ],
  // Pass 3 — only 3 low findings remain → clean, freeze unlocks.
  [
    { severity: 'low', category: 'clarity', claim: 'The enrichment-hook interface is specified, but one field’s nullability is left implicit.' },
    { severity: 'low', category: 'docs', claim: 'A changelog entry for the worktree-isolation default is still missing.' },
    { severity: 'low', category: 'consistency', claim: 'Two log lines still omit the taskId.' },
  ],
];

export function auditMock(projectId: string): {
  pass: { passNo: number; verdict: 'clean' | 'revised'; findingsCount: number; findings: AuditFinding[] };
  contextBlockId: string | null;
  history: AuditPassView[];
  canFreeze: boolean;
} {
  const st = ensure(projectId);
  const passNo = st.audit.length + 1;
  const findings = AUDIT_FINDINGS[passNo - 1] ?? [];
  const hasCritHigh = findings.some((f) => f.severity === 'critical' || f.severity === 'high');
  const verdict: 'clean' | 'revised' = hasCritHigh ? 'revised' : 'clean';
  st.audit.push({ passNo, findingsCount: findings.length, verdict });
  st.canFreeze = !hasCritHigh;
  STORE.set(projectId, st);
  return { pass: { passNo, verdict, findingsCount: findings.length, findings }, contextBlockId: null, history: st.audit, canFreeze: st.canFreeze };
}

export function auditOverrideMock(projectId: string): { canFreeze: boolean } {
  const st = ensure(projectId);
  st.canFreeze = true;
  STORE.set(projectId, st);
  return { canFreeze: true };
}
