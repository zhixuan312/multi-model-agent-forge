# Unified Task API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-route handler architecture (10 tool handlers, ToolSurfaceRegistry, BatchRegistry, 4-value ReviewPolicy, wire schema v5) with a single `POST /task` endpoint backed by a 2-phase goal pipeline, flat type registry, per-type skill files, and a lightweight TaskRegistry.

**Architecture:** `POST /task` → Zod discriminated union on `type` → TypeRegistry config lookup → load skill pair (implement.md + review.md) → 2-phase pipeline (implementer goal → reviewer goal → deterministic annotate) → TaskEnvelope response via `GET /task/:taskId`. Write types (delegate, execute_plan) get git worktree isolation. Sessions expose IDs for optional multi-turn resume.

**Tech Stack:** TypeScript, Zod, ESM (.js extensions), Vitest, Node >= 22, pnpm

**Spec:** `docs/superpowers/specs/2026-06-12-unified-task-api-design.md`

**Starting Point:** release/4.9.1 — per-route handlers under `handlers/tools/`, `ToolSurfaceRegistry`, `BatchRegistry`, `asyncDispatch`, `ReviewPolicy = 'full' | 'quality_only' | 'diff_only' | 'none'`, wire schema v5, no session IDs, no skill files, no unified directory.

**Conventions:** Greenfield — no backward compatibility. Delete freely. See `.claude/rules/development-mode.md`.

**Test runner:** `env -u MMAGENT_AUTH_TOKEN npx vitest run` (unset auth token or server handler tests fail with 401).

---

## File Structure

### New files (packages/core/src/unified/)

| File | Responsibility |
|------|----------------|
| `type-registry.ts` | `TASK_TYPES` array, `TypeConfig` interface, `TYPE_REGISTRY` map, `oppositeAgent()` helper |
| `task-input-schema.ts` | Zod discriminated union on `type` — per-type payload validation |
| `reviewer-output-parser.ts` | Extract + validate structured reviewer JSON from raw LLM output |
| `skill-loader.ts` | Load implement.md + review.md per type, with subtype fallback and caching |
| `task-registry.ts` | Lightweight in-memory task state (register/complete/fail/poll) — replaces BatchRegistry |
| `worktree-manager.ts` | Git worktree create/cleanup for write types |
| `two-phase-pipeline.ts` | Orchestrate implementer → reviewer → annotate; worktree lifecycle; session management |

### New files (packages/core/src/skills/)

```
skills/
  audit/implement.md, review.md
  investigate/implement.md, review.md
  delegate/implement.md, review.md
  execute_plan/implement.md, review.md
  review/implement.md, review.md
  debug/implement.md, review.md
  research/implement.md, review.md
  journal_recall/implement.md, review.md
  journal_record/implement.md, review.md
```

### New files (packages/server/src/http/handlers/)

| File | Responsibility |
|------|----------------|
| `unified-task.ts` | `buildUnifiedTaskHandler` (POST /task) + `buildTaskPollHandler` (GET /task/:taskId) |

### Modified files

| File | Change |
|------|--------|
| `packages/core/src/types/run-result.ts` | Add `getSessionId(): string \| null` to `Session` interface |
| `packages/core/src/providers/claude.ts` (or `claude-session.ts`) | Implement `getSessionId()` |
| `packages/core/src/providers/codex.ts` (or `codex-cli-session.ts`) | Implement `getSessionId()` |
| `packages/core/src/providers/provider-factory.ts` | Increase `SAFETY_CEILING` from 100 to 200 |
| `packages/core/src/events/wire-schema.ts` | Bump `SCHEMA_VERSION` from 5 to 6 |
| `packages/server/src/http/server.ts` | Register unified routes, remove per-tool registration loop |

### Deleted files (Phase 4)

| Path | Reason |
|------|--------|
| `packages/server/src/http/handlers/tools/*.ts` (10 files) | Replaced by unified-task.ts |
| `packages/server/src/http/handlers/control/batch.ts` | Replaced by GET /task/:taskId |
| `packages/server/src/http/async-dispatch.ts` | Inlined into unified handler |
| `packages/server/src/http/execution-context.ts` | Inlined into pipeline |
| `packages/core/src/stores/batch-registry.ts` | Replaced by unified/task-registry.ts |
| `packages/core/src/stores/batch-cache.ts` | Removed (callers re-send payload per Principle 9) |
| `packages/core/src/tool-surface/tool-surface-registry.ts` | Replaced by unified/type-registry.ts |
| `packages/core/src/tool-surface/register-all-tools.ts` | Replaced by TYPE_REGISTRY constant |
| `packages/core/src/tools/*/tool-config.ts` | Replaced by skill files |

---

## Phase 1 — Core Infrastructure

---

### Task 1: Type Registry

**Files:**
- Create: `packages/core/src/unified/type-registry.ts`
- Test: `tests/unified/type-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unified/type-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  TASK_TYPES,
  TYPE_REGISTRY,
  getTypeConfig,
  oppositeAgent,
} from '../../packages/core/src/unified/type-registry.js';
import type { TaskType, TypeConfig } from '../../packages/core/src/unified/type-registry.js';

describe('type-registry', () => {
  it('TASK_TYPES contains exactly 9 types', () => {
    expect(TASK_TYPES).toHaveLength(9);
    expect(TASK_TYPES).toContain('delegate');
    expect(TASK_TYPES).toContain('audit');
    expect(TASK_TYPES).toContain('investigate');
    expect(TASK_TYPES).toContain('execute_plan');
    expect(TASK_TYPES).toContain('review');
    expect(TASK_TYPES).toContain('debug');
    expect(TASK_TYPES).toContain('research');
    expect(TASK_TYPES).toContain('journal_recall');
    expect(TASK_TYPES).toContain('journal_record');
  });

  it('every TASK_TYPE has a TYPE_REGISTRY entry', () => {
    for (const t of TASK_TYPES) {
      expect(TYPE_REGISTRY[t]).toBeDefined();
    }
  });

  it('getTypeConfig returns config for valid types', () => {
    const cfg = getTypeConfig('delegate');
    expect(cfg.defaultTier).toBe('standard');
    expect(cfg.worktree).toBe(true);
    expect(cfg.sandbox).toBe('cwd-only');
  });

  it('getTypeConfig throws for unknown type', () => {
    expect(() => getTypeConfig('nope' as TaskType)).toThrow();
  });

  it('write types default to standard tier', () => {
    expect(getTypeConfig('delegate').defaultTier).toBe('standard');
    expect(getTypeConfig('execute_plan').defaultTier).toBe('standard');
  });

  it('read types default to complex tier', () => {
    for (const t of ['audit', 'investigate', 'review', 'debug', 'research', 'journal_recall'] as const) {
      expect(getTypeConfig(t).defaultTier).toBe('complex');
    }
  });

  it('worktree is true only for write types', () => {
    const worktreeTypes = TASK_TYPES.filter(t => TYPE_REGISTRY[t].worktree);
    expect(worktreeTypes).toEqual(['delegate', 'execute_plan']);
  });

  it('oppositeAgent inverts tiers', () => {
    expect(oppositeAgent('standard')).toBe('complex');
    expect(oppositeAgent('complex')).toBe('standard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/type-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/core/src/unified/type-registry.ts`:

```typescript
export const TASK_TYPES = [
  'audit',
  'investigate',
  'delegate',
  'execute_plan',
  'review',
  'debug',
  'research',
  'journal_recall',
  'journal_record',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export type AgentType = 'standard' | 'complex';
export type SandboxPolicy = 'read-only' | 'cwd-only';

export interface TypeConfig {
  defaultTier: AgentType;
  worktree: boolean;
  sandbox: SandboxPolicy;
}

export const TYPE_REGISTRY: Record<TaskType, TypeConfig> = {
  audit:          { defaultTier: 'complex',  worktree: false, sandbox: 'read-only' },
  investigate:    { defaultTier: 'complex',  worktree: false, sandbox: 'read-only' },
  delegate:       { defaultTier: 'standard', worktree: true,  sandbox: 'cwd-only'  },
  execute_plan:   { defaultTier: 'standard', worktree: true,  sandbox: 'cwd-only'  },
  review:         { defaultTier: 'complex',  worktree: false, sandbox: 'read-only' },
  debug:          { defaultTier: 'complex',  worktree: false, sandbox: 'read-only' },
  research:       { defaultTier: 'complex',  worktree: false, sandbox: 'read-only' },
  journal_recall: { defaultTier: 'complex',  worktree: false, sandbox: 'read-only' },
  journal_record: { defaultTier: 'complex',  worktree: false, sandbox: 'cwd-only'  },
};

export function getTypeConfig(type: TaskType): TypeConfig {
  const cfg = TYPE_REGISTRY[type];
  if (!cfg) throw new Error(`Unknown task type: ${type}`);
  return cfg;
}

export function oppositeAgent(tier: AgentType): AgentType {
  return tier === 'standard' ? 'complex' : 'standard';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/type-registry.test.ts`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/unified/type-registry.ts tests/unified/type-registry.test.ts
git commit -m "feat(unified): add type registry with 9 task types"
```

---

### Task 2: Reviewer Output Parser

**Files:**
- Create: `packages/core/src/unified/reviewer-output-parser.ts`
- Test: `tests/unified/reviewer-output-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unified/reviewer-output-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseReviewerOutput } from '../../packages/core/src/unified/reviewer-output-parser.js';
import type { ReviewerOutput } from '../../packages/core/src/unified/reviewer-output-parser.js';

describe('reviewer-output-parser', () => {
  const validOutput: ReviewerOutput = {
    findings: [
      {
        severity: 'high',
        category: 'correctness',
        description: 'Missing null check',
        location: 'src/foo.ts:42',
        fix: 'applied',
      },
    ],
    summary: 'One issue found and fixed.',
    verdict: 'changes_made',
  };

  it('parses valid JSON in fenced code block', () => {
    const raw = `Some preamble text.\n\`\`\`json\n${JSON.stringify(validOutput, null, 2)}\n\`\`\`\nSome epilogue.`;
    const result = parseReviewerOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(1);
      expect(result.data.findings[0].severity).toBe('high');
      expect(result.data.verdict).toBe('changes_made');
    }
  });

  it('parses bare JSON without fences', () => {
    const raw = JSON.stringify(validOutput);
    const result = parseReviewerOutput(raw);
    expect(result.ok).toBe(true);
  });

  it('returns error for non-JSON', () => {
    const result = parseReviewerOutput('No JSON here at all.');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No JSON');
      expect(result.raw).toBe('No JSON here at all.');
    }
  });

  it('returns error for invalid schema', () => {
    const bad = JSON.stringify({ findings: 'not an array', summary: 'x', verdict: 'approved' });
    const result = parseReviewerOutput(bad);
    expect(result.ok).toBe(false);
  });

  it('accepts approved verdict with empty findings', () => {
    const clean = { findings: [], summary: 'All good.', verdict: 'approved' };
    const result = parseReviewerOutput(JSON.stringify(clean));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings).toHaveLength(0);
      expect(result.data.verdict).toBe('approved');
    }
  });

  it('validates severity enum values', () => {
    const bad = {
      findings: [{ severity: 'extreme', category: 'x', description: 'y', location: 'z', fix: 'applied' }],
      summary: 'x',
      verdict: 'approved',
    };
    const result = parseReviewerOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/reviewer-output-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/core/src/unified/reviewer-output-parser.ts`:

```typescript
import { z } from 'zod';

const findingSchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.string(),
  description: z.string(),
  location: z.string(),
  fix: z.enum(['applied', 'suggested']),
});

const reviewerOutputSchema = z.object({
  findings: z.array(findingSchema),
  summary: z.string(),
  verdict: z.enum(['approved', 'changes_made']),
});

export type ReviewerFinding = z.infer<typeof findingSchema>;
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;

export type ParseResult =
  | { ok: true; data: ReviewerOutput }
  | { ok: false; error: string; raw: string };

export function parseReviewerOutput(raw: string): ParseResult {
  const json = extractJson(raw);
  if (json === null) {
    return { ok: false, error: 'No JSON found in reviewer output', raw };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON syntax', raw };
  }

  const result = reviewerOutputSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.message, raw };
  }

  return { ok: true, data: result.data };
}

function extractJson(raw: string): string | null {
  // Try fenced code block first
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(raw);
  if (fenced) return fenced[1].trim();

  // Try bare JSON object
  const bare = /(\{[\s\S]*\})/.exec(raw);
  if (bare) return bare[1].trim();

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/reviewer-output-parser.test.ts`
Expected: PASS — all 6 assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/unified/reviewer-output-parser.ts tests/unified/reviewer-output-parser.test.ts
git commit -m "feat(unified): add reviewer output parser with Zod validation"
```

---

### Task 3: Skill Loader

**Files:**
- Create: `packages/core/src/unified/skill-loader.ts`
- Test: `tests/unified/skill-loader.test.ts`

**Note:** This task creates the loader and stub skill files for `delegate` and `audit` types only. Remaining types are added in Task 11.

- [ ] **Step 1: Create stub skill files for delegate and audit**

Create `packages/core/src/skills/delegate/implement.md`:

```markdown
# Delegate — Implementer

You are a worker executing a delegated task. Follow the task instructions precisely.

## Output Format

Produce your work directly. For write tasks, make the requested file changes. For analysis tasks, write your findings as structured text.
```

Create `packages/core/src/skills/delegate/review.md`:

```markdown
# Delegate — Reviewer

You are reviewing work produced by another agent on a delegated task.

## Review Checklist
- Did the implementer complete all requested work?
- Are file changes minimal and well-scoped?
- Are there any correctness issues?

## Output Format

```json
{
  "findings": [{ "severity": "...", "category": "...", "description": "...", "location": "...", "fix": "applied|suggested" }],
  "summary": "...",
  "verdict": "approved|changes_made"
}
```
```

Create `packages/core/src/skills/audit/implement.md`:

```markdown
# Audit — Implementer

You are auditing a document against quality criteria. Read the document thoroughly and identify issues.

## Output Format

For each finding, report severity (critical/high/medium/low), category, description, and location.
```

Create `packages/core/src/skills/audit/review.md`:

```markdown
# Audit — Reviewer

You are reviewing audit findings produced by another agent.

## Review Checklist
- Are findings accurate and actionable?
- Were any issues missed?
- Are severity levels appropriate?

## Output Format

```json
{
  "findings": [{ "severity": "...", "category": "...", "description": "...", "location": "...", "fix": "applied|suggested" }],
  "summary": "...",
  "verdict": "approved|changes_made"
}
```
```

- [ ] **Step 2: Write the failing test**

Create `tests/unified/skill-loader.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { loadSkill, validateSkillsExist, clearSkillCache } from '../../packages/core/src/unified/skill-loader.js';
import type { SkillPair } from '../../packages/core/src/unified/skill-loader.js';
import path from 'node:path';

const SKILLS_DIR = path.resolve('packages/core/src/skills');

afterEach(() => clearSkillCache());

describe('skill-loader', () => {
  it('loads implement.md and review.md for delegate', async () => {
    const pair = await loadSkill('delegate', SKILLS_DIR);
    expect(pair.implement).toContain('Delegate');
    expect(pair.implement).toContain('Implementer');
    expect(pair.review).toContain('Reviewer');
  });

  it('loads implement.md and review.md for audit', async () => {
    const pair = await loadSkill('audit', SKILLS_DIR);
    expect(pair.implement).toContain('Audit');
    expect(pair.review).toContain('Reviewer');
  });

  it('caches loaded skills across calls', async () => {
    const pair1 = await loadSkill('delegate', SKILLS_DIR);
    const pair2 = await loadSkill('delegate', SKILLS_DIR);
    expect(pair1).toBe(pair2); // same reference
  });

  it('clearSkillCache invalidates cache', async () => {
    const pair1 = await loadSkill('delegate', SKILLS_DIR);
    clearSkillCache();
    const pair2 = await loadSkill('delegate', SKILLS_DIR);
    expect(pair1).not.toBe(pair2); // different reference
    expect(pair1.implement).toBe(pair2.implement); // same content
  });

  it('throws for type with no skill directory', async () => {
    await expect(loadSkill('nonexistent' as any, SKILLS_DIR)).rejects.toThrow();
  });

  it('validateSkillsExist passes for types with both files', async () => {
    await expect(validateSkillsExist(['delegate', 'audit'], SKILLS_DIR)).resolves.toBeUndefined();
  });

  it('validateSkillsExist throws for missing type', async () => {
    await expect(validateSkillsExist(['delegate', 'nonexistent' as any], SKILLS_DIR)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/skill-loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write implementation**

Create `packages/core/src/unified/skill-loader.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskType } from './type-registry.js';

export interface SkillPair {
  implement: string;
  review: string;
}

const cache = new Map<string, SkillPair>();

export async function loadSkill(
  type: TaskType,
  skillsDir: string,
  subtype?: string,
): Promise<SkillPair> {
  const cacheKey = `${type}:${subtype ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const typeDir = join(skillsDir, type);

  let implementPath: string;
  if (subtype) {
    const subtypePath = join(typeDir, `implement-${subtype}.md`);
    try {
      await readFile(subtypePath, 'utf-8');
      implementPath = subtypePath;
    } catch {
      implementPath = join(typeDir, 'implement.md');
    }
  } else {
    implementPath = join(typeDir, 'implement.md');
  }

  const [implement, review] = await Promise.all([
    readFile(implementPath, 'utf-8'),
    readFile(join(typeDir, 'review.md'), 'utf-8'),
  ]);

  const pair: SkillPair = { implement, review };
  cache.set(cacheKey, pair);
  return pair;
}

export async function validateSkillsExist(
  types: readonly TaskType[] | TaskType[],
  skillsDir: string,
): Promise<void> {
  const errors: string[] = [];
  for (const type of types) {
    const typeDir = join(skillsDir, type);
    for (const file of ['implement.md', 'review.md']) {
      try {
        await readFile(join(typeDir, file), 'utf-8');
      } catch {
        errors.push(`${type}/${file}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Missing skill files: ${errors.join(', ')}`);
  }
}

export function clearSkillCache(): void {
  cache.clear();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/skill-loader.test.ts`
Expected: PASS — all 7 assertions green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/unified/skill-loader.ts tests/unified/skill-loader.test.ts \
  packages/core/src/skills/delegate/implement.md packages/core/src/skills/delegate/review.md \
  packages/core/src/skills/audit/implement.md packages/core/src/skills/audit/review.md
git commit -m "feat(unified): add skill loader with caching and subtype fallback"
```

---

### Task 4: Task Registry

**Files:**
- Create: `packages/core/src/unified/task-registry.ts`
- Test: `tests/unified/task-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unified/task-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TaskRegistry } from '../../packages/core/src/unified/task-registry.js';
import type { TaskEntry } from '../../packages/core/src/unified/task-registry.js';

describe('TaskRegistry', () => {
  let reg: TaskRegistry;

  beforeEach(() => {
    reg = new TaskRegistry();
  });

  it('registers a new task as pending', () => {
    reg.register('task-1', '/repo', 'delegate');
    const entry = reg.get('task-1');
    expect(entry).toBeDefined();
    expect(entry!.state).toBe('pending');
    expect(entry!.cwd).toBe('/repo');
    expect(entry!.tool).toBe('delegate');
    expect(entry!.result).toBeNull();
    expect(entry!.runningHeadline).toBeNull();
  });

  it('returns undefined for unknown taskId', () => {
    expect(reg.get('nope')).toBeUndefined();
  });

  it('completes a task', () => {
    reg.register('task-1', '/repo', 'audit');
    reg.complete('task-1', { summary: 'done' });
    const entry = reg.get('task-1');
    expect(entry!.state).toBe('complete');
    expect(entry!.result).toEqual({ summary: 'done' });
    expect(entry!.terminalAt).toBeGreaterThan(0);
  });

  it('fails a task', () => {
    reg.register('task-1', '/repo', 'audit');
    reg.fail('task-1', { code: 'timeout', message: 'timed out' });
    const entry = reg.get('task-1');
    expect(entry!.state).toBe('failed');
    expect(entry!.result).toEqual({ code: 'timeout', message: 'timed out' });
  });

  it('sets running headline', () => {
    reg.register('task-1', '/repo', 'delegate');
    reg.setHeadline('task-1', 'Phase 1: implementing...');
    expect(reg.get('task-1')!.runningHeadline).toBe('Phase 1: implementing...');
  });

  it('counts active tasks for a cwd', () => {
    reg.register('t1', '/repo-a', 'delegate');
    reg.register('t2', '/repo-a', 'audit');
    reg.register('t3', '/repo-b', 'review');
    expect(reg.countActive('/repo-a')).toBe(2);
    expect(reg.countActive('/repo-b')).toBe(1);

    reg.complete('t1', {});
    expect(reg.countActive('/repo-a')).toBe(1);
  });

  it('isTerminal returns true for complete and failed', () => {
    reg.register('t1', '/r', 'delegate');
    expect(reg.isTerminal('t1')).toBe(false);
    reg.complete('t1', {});
    expect(reg.isTerminal('t1')).toBe(true);
  });

  it('allInFlight returns only pending tasks', () => {
    reg.register('t1', '/r', 'delegate');
    reg.register('t2', '/r', 'audit');
    reg.complete('t2', {});
    const inflight = reg.allInFlight();
    expect(inflight).toHaveLength(1);
    expect(inflight[0].taskId).toBe('t1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/task-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/core/src/unified/task-registry.ts`:

```typescript
export type TaskState = 'pending' | 'complete' | 'failed';

export interface TaskEntry {
  taskId: string;
  cwd: string;
  state: TaskState;
  tool: string;
  result: unknown;
  runningHeadline: string | null;
  startedAt: number;
  terminalAt: number | null;
}

export class TaskRegistry {
  private entries = new Map<string, TaskEntry>();

  register(taskId: string, cwd: string, tool: string): void {
    this.entries.set(taskId, {
      taskId,
      cwd,
      state: 'pending',
      tool,
      result: null,
      runningHeadline: null,
      startedAt: Date.now(),
      terminalAt: null,
    });
  }

  get(taskId: string): TaskEntry | undefined {
    return this.entries.get(taskId);
  }

  complete(taskId: string, result: unknown): void {
    const entry = this.mustGet(taskId);
    entry.state = 'complete';
    entry.result = result;
    entry.terminalAt = Date.now();
  }

  fail(taskId: string, result: unknown): void {
    const entry = this.mustGet(taskId);
    entry.state = 'failed';
    entry.result = result;
    entry.terminalAt = Date.now();
  }

  setHeadline(taskId: string, headline: string): void {
    const entry = this.mustGet(taskId);
    entry.runningHeadline = headline;
  }

  countActive(cwd: string): number {
    let count = 0;
    for (const e of this.entries.values()) {
      if (e.cwd === cwd && e.state === 'pending') count++;
    }
    return count;
  }

  isTerminal(taskId: string): boolean {
    const entry = this.entries.get(taskId);
    return entry !== undefined && entry.state !== 'pending';
  }

  allInFlight(): TaskEntry[] {
    return [...this.entries.values()].filter(e => e.state === 'pending');
  }

  private mustGet(taskId: string): TaskEntry {
    const entry = this.entries.get(taskId);
    if (!entry) throw new Error(`Task not found: ${taskId}`);
    return entry;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/task-registry.test.ts`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/unified/task-registry.ts tests/unified/task-registry.test.ts
git commit -m "feat(unified): add TaskRegistry — lightweight batch replacement"
```

---

### Task 5: Task Input Schema (Zod Discriminated Union)

**Files:**
- Create: `packages/core/src/unified/task-input-schema.ts`
- Test: `tests/unified/task-input-schema.test.ts`
- Depends on: Task 1 (type-registry.ts for `TaskType`)

- [ ] **Step 1: Write the failing test**

Create `tests/unified/task-input-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { taskInputSchema } from '../../packages/core/src/unified/task-input-schema.js';

describe('task-input-schema', () => {
  describe('common fields', () => {
    it('accepts valid delegate payload', () => {
      const result = taskInputSchema.safeParse({
        type: 'delegate',
        tasks: [{ prompt: 'Do the thing' }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects unknown type', () => {
      const result = taskInputSchema.safeParse({
        type: 'explode',
        data: 'boom',
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional agentTier override', () => {
      const result = taskInputSchema.safeParse({
        type: 'audit',
        filePaths: ['spec.md'],
        agentTier: 'standard',
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional reviewPolicy', () => {
      const result = taskInputSchema.safeParse({
        type: 'audit',
        filePaths: ['spec.md'],
        reviewPolicy: 'none',
      });
      expect(result.success).toBe(true);
    });

    it('rejects legacy reviewPolicy values', () => {
      const result = taskInputSchema.safeParse({
        type: 'audit',
        filePaths: ['spec.md'],
        reviewPolicy: 'full',
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional sessionIds', () => {
      const result = taskInputSchema.safeParse({
        type: 'audit',
        filePaths: ['spec.md'],
        sessionIds: { implementer: 'sess-123' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional contextBlockIds', () => {
      const result = taskInputSchema.safeParse({
        type: 'delegate',
        tasks: [{ prompt: 'x' }],
        contextBlockIds: ['block-1', 'block-2'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('delegate', () => {
    it('requires non-empty tasks array', () => {
      const empty = taskInputSchema.safeParse({ type: 'delegate', tasks: [] });
      expect(empty.success).toBe(false);
    });

    it('requires prompt in each task', () => {
      const bad = taskInputSchema.safeParse({ type: 'delegate', tasks: [{}] });
      expect(bad.success).toBe(false);
    });
  });

  describe('audit', () => {
    it('accepts filePaths', () => {
      const r = taskInputSchema.safeParse({ type: 'audit', filePaths: ['a.md'] });
      expect(r.success).toBe(true);
    });

    it('accepts document', () => {
      const r = taskInputSchema.safeParse({ type: 'audit', document: 'content...' });
      expect(r.success).toBe(true);
    });

    it('accepts optional subtype', () => {
      const r = taskInputSchema.safeParse({ type: 'audit', filePaths: ['a.md'], subtype: 'plan' });
      expect(r.success).toBe(true);
    });
  });

  describe('investigate', () => {
    it('requires question', () => {
      const r = taskInputSchema.safeParse({ type: 'investigate' });
      expect(r.success).toBe(false);
    });

    it('accepts question with filePaths', () => {
      const r = taskInputSchema.safeParse({
        type: 'investigate',
        question: 'How does X work?',
        filePaths: ['src/x.ts'],
      });
      expect(r.success).toBe(true);
    });
  });

  describe('execute_plan', () => {
    it('requires filePaths and taskDescriptors', () => {
      const r = taskInputSchema.safeParse({
        type: 'execute_plan',
        filePaths: ['plan.md'],
        taskDescriptors: ['Task 1: Setup'],
      });
      expect(r.success).toBe(true);
    });

    it('rejects empty taskDescriptors', () => {
      const r = taskInputSchema.safeParse({
        type: 'execute_plan',
        filePaths: ['plan.md'],
        taskDescriptors: [],
      });
      expect(r.success).toBe(false);
    });
  });

  describe('research', () => {
    it('requires researchQuestion and background of min length', () => {
      const r = taskInputSchema.safeParse({
        type: 'research',
        researchQuestion: 'What is the state of the art in X topic area?',
        background: 'We are building a system that needs to handle Y efficiently.',
      });
      expect(r.success).toBe(true);
    });

    it('rejects short researchQuestion', () => {
      const r = taskInputSchema.safeParse({
        type: 'research',
        researchQuestion: 'Why?',
        background: 'We are building a system that needs to handle Y efficiently.',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('journal_recall', () => {
    it('requires query', () => {
      const r = taskInputSchema.safeParse({ type: 'journal_recall', query: 'What did we learn about caching?' });
      expect(r.success).toBe(true);
    });

    it('rejects short query', () => {
      const r = taskInputSchema.safeParse({ type: 'journal_recall', query: 'cache' });
      expect(r.success).toBe(false);
    });
  });

  describe('journal_record', () => {
    it('requires entry', () => {
      const r = taskInputSchema.safeParse({ type: 'journal_record', entry: 'Learned something important.' });
      expect(r.success).toBe(true);
    });
  });

  describe('debug', () => {
    it('requires errorMessage', () => {
      const r = taskInputSchema.safeParse({
        type: 'debug',
        errorMessage: 'TypeError: cannot read property of undefined',
      });
      expect(r.success).toBe(true);
    });

    it('rejects empty errorMessage', () => {
      const r = taskInputSchema.safeParse({ type: 'debug', errorMessage: '' });
      expect(r.success).toBe(false);
    });
  });

  describe('review', () => {
    it('accepts filePaths', () => {
      const r = taskInputSchema.safeParse({ type: 'review', filePaths: ['src/foo.ts'] });
      expect(r.success).toBe(true);
    });

    it('accepts code string', () => {
      const r = taskInputSchema.safeParse({ type: 'review', code: 'const x = 1;' });
      expect(r.success).toBe(true);
    });

    it('accepts focus areas', () => {
      const r = taskInputSchema.safeParse({ type: 'review', filePaths: ['a.ts'], focus: ['security', 'perf'] });
      expect(r.success).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/task-input-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/core/src/unified/task-input-schema.ts`:

```typescript
import { z } from 'zod';

const reviewPolicySchema = z.enum(['reviewed', 'none']);

const sessionIdsSchema = z.object({
  implementer: z.string().optional(),
  reviewer: z.string().optional(),
}).optional();

const commonFields = {
  agentTier: z.enum(['standard', 'complex']).optional(),
  reviewPolicy: reviewPolicySchema.optional(),
  sessionIds: sessionIdsSchema,
  contextBlockIds: z.array(z.string()).optional(),
};

const delegateTaskSchema = z.object({
  prompt: z.string().min(1),
  filePaths: z.array(z.string()).optional(),
  contextBlockIds: z.array(z.string()).optional(),
});

export const taskInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('delegate'),
    tasks: z.array(delegateTaskSchema).min(1),
    ...commonFields,
  }),
  z.object({
    type: z.literal('audit'),
    document: z.string().optional(),
    filePaths: z.array(z.string()).optional(),
    subtype: z.enum(['default', 'plan', 'spec', 'skill']).optional(),
    ...commonFields,
  }),
  z.object({
    type: z.literal('investigate'),
    question: z.string().min(1),
    filePaths: z.array(z.string()).optional(),
    ...commonFields,
  }),
  z.object({
    type: z.literal('execute_plan'),
    filePaths: z.array(z.string()).min(1),
    taskDescriptors: z.array(z.string()).min(1),
    perTaskReviewPolicy: z.record(z.string(), z.string()).optional(),
    ...commonFields,
  }),
  z.object({
    type: z.literal('review'),
    filePaths: z.array(z.string()).optional(),
    code: z.string().optional(),
    focus: z.array(z.string()).optional(),
    ...commonFields,
  }),
  z.object({
    type: z.literal('debug'),
    errorMessage: z.string().min(1),
    filePaths: z.array(z.string()).optional(),
    ...commonFields,
  }),
  z.object({
    type: z.literal('research'),
    researchQuestion: z.string().min(20),
    background: z.string().min(20),
    ...commonFields,
  }),
  z.object({
    type: z.literal('journal_recall'),
    query: z.string().min(10),
    ...commonFields,
  }),
  z.object({
    type: z.literal('journal_record'),
    entry: z.string().min(1),
    ...commonFields,
  }),
]);

export type TaskInput = z.infer<typeof taskInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/task-input-schema.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/unified/task-input-schema.ts tests/unified/task-input-schema.test.ts
git commit -m "feat(unified): add task input schema — Zod discriminated union on type"
```

---

### Task 6: Session ID Exposure on Providers

**Files:**
- Modify: `packages/core/src/types/run-result.ts` — add `getSessionId()` to `Session` interface
- Modify: `packages/core/src/providers/claude.ts` (or `claude-session.ts`) — implement `getSessionId()`
- Modify: `packages/core/src/providers/codex.ts` (or `codex-cli-session.ts`) — implement `getSessionId()`
- Test: `tests/unified/session-id.test.ts`

**Note:** Read the actual file names on release/4.9.1. The provider files may be named `claude.ts`/`codex.ts` (runner files) with session classes inline, or split into separate session files. Adjust paths accordingly.

- [ ] **Step 1: Write the failing test**

Create `tests/unified/session-id.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Session interface', () => {
  it('Session interface requires getSessionId method', async () => {
    // Dynamic import to verify the type exists at runtime
    const mod = await import('../../packages/core/src/types/run-result.js');
    // The Session interface is a type — verify it's exported by checking the module
    // This is a compile-time check; runtime verification below uses the providers

    // If Session is exported as a type-only, this will pass compilation
    // The real assertion is that providers implement it (see provider tests below)
    expect(true).toBe(true);
  });
});

describe('ClaudeSession.getSessionId', () => {
  it('returns null before first send', () => {
    // Must check the actual provider file to construct a ClaudeSession
    // At 4.9.1 the session is created via provider.openSession()
    // For unit testing, check that the method exists on the prototype

    // Import the session class — adjust path based on actual file structure
    // This test verifies the method signature; integration test covers actual ID capture
  });
});

describe('CodexCliSession.getSessionId', () => {
  it('returns null before first send', () => {
    // Same pattern as Claude — verify method exists
  });
});
```

**Important:** The actual test must be written after reading the provider files to understand constructor signatures. The worker should:
1. Read `packages/core/src/providers/claude.ts` to find the session class
2. Read `packages/core/src/providers/codex.ts` to find the session class
3. Read `packages/core/src/types/run-result.ts` to find the `Session` interface
4. Add `getSessionId(): string | null` to the `Session` interface
5. Implement on both session classes (capture sessionId from provider responses, return via getter)

- [ ] **Step 2: Add getSessionId to Session interface**

In `packages/core/src/types/run-result.ts`, find the `Session` interface and add:

```typescript
getSessionId(): string | null;
```

- [ ] **Step 3: Implement getSessionId on ClaudeSession**

In the Claude session class, add a private `sessionId: string | null = null` field. Capture the session ID from Claude SDK response events (look for `session_id` on SDKMessage). Return via getter:

```typescript
getSessionId(): string | null {
  return this.sessionId ?? null;
}
```

- [ ] **Step 4: Implement getSessionId on CodexCliSession**

In the Codex session class, add a private `threadId: string | null = null` field. Capture from subprocess event output. Return via getter:

```typescript
getSessionId(): string | null {
  return this.threadId ?? null;
}
```

- [ ] **Step 5: Run build to verify types compile**

Run: `npm run build`
Expected: No type errors — all Session implementations satisfy the interface.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/run-result.ts packages/core/src/providers/
git commit -m "feat(providers): expose getSessionId() on Session interface"
```

---

### Task 7: Worktree Manager

**Files:**
- Create: `packages/core/src/unified/worktree-manager.ts`
- Test: `tests/unified/worktree-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unified/worktree-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeManager } from '../../packages/core/src/unified/worktree-manager.js';
import type { WorktreeInfo } from '../../packages/core/src/unified/worktree-manager.js';

describe('WorktreeManager', () => {
  let exec: ReturnType<typeof vi.fn>;
  let manager: WorktreeManager;

  beforeEach(() => {
    exec = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    manager = new WorktreeManager(exec);
  });

  describe('create', () => {
    it('creates worktree with correct branch name', async () => {
      const info = await manager.create('/repo', 'abc123', 'delegate');
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git worktree add'),
        expect.objectContaining({ cwd: '/repo' }),
      );
      expect(info.branch).toMatch(/^mma\/delegate-/);
      expect(info.path).toMatch(/\.mma\/worktrees\//);
      expect(info.hasChanges).toBe(false);
    });

    it('runs pnpm install when package.json exists', async () => {
      // First call: git worktree add (succeeds)
      // Second call: test -f package.json (succeeds)
      // Third call: pnpm install
      exec
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })  // worktree add
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })  // test -f
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // pnpm install

      const info = await manager.create('/repo', 'abc123', 'delegate');
      expect(info.path).toBeTruthy();
    });
  });

  describe('cleanup', () => {
    it('removes worktree with no changes', async () => {
      // git status --porcelain returns empty
      exec.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
      // git worktree remove
      exec.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
      // git branch -d
      exec.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

      const preserved = await manager.cleanup('/repo/.mma/worktrees/abc', 'mma/delegate-abc');
      expect(preserved).toBe(false);
    });

    it('preserves worktree with changes', async () => {
      exec.mockResolvedValueOnce({ stdout: 'M src/foo.ts\n', stderr: '', exitCode: 0 });

      const preserved = await manager.cleanup('/repo/.mma/worktrees/abc', 'mma/delegate-abc');
      expect(preserved).toBe(true);
    });
  });

  describe('hasChanges', () => {
    it('returns false when git status is clean', async () => {
      exec.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
      expect(await manager.hasChanges('/repo/.mma/worktrees/abc')).toBe(false);
    });

    it('returns true when git status has output', async () => {
      exec.mockResolvedValueOnce({ stdout: 'M file.ts\n', stderr: '', exitCode: 0 });
      expect(await manager.hasChanges('/repo/.mma/worktrees/abc')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/worktree-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/core/src/unified/worktree-manager.ts`:

```typescript
import { join } from 'node:path';

export interface WorktreeInfo {
  branch: string;
  path: string;
  hasChanges: boolean;
}

export type ExecResult = { stdout: string; stderr: string; exitCode: number };
export type ExecFn = (cmd: string, opts: { cwd: string }) => Promise<ExecResult>;

export class WorktreeManager {
  constructor(private exec: ExecFn) {}

  async create(cwd: string, taskId: string, type: string): Promise<WorktreeInfo> {
    const shortId = taskId.slice(0, 8);
    const branch = `mma/${type}-${shortId}`;
    const worktreePath = join(cwd, '.mma', 'worktrees', shortId);

    await this.exec(
      `git worktree add "${worktreePath}" -b "${branch}"`,
      { cwd },
    );

    // Install deps if package.json exists
    const testResult = await this.exec(
      `test -f "${join(worktreePath, 'package.json')}"`,
      { cwd: worktreePath },
    ).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));

    if (testResult.exitCode === 0) {
      await this.exec('pnpm install --frozen-lockfile', { cwd: worktreePath });
    }

    return { branch, path: worktreePath, hasChanges: false };
  }

  async hasChanges(worktreePath: string): Promise<boolean> {
    const result = await this.exec('git status --porcelain', { cwd: worktreePath });
    return result.stdout.trim().length > 0;
  }

  async cleanup(worktreePath: string, branch: string): Promise<boolean> {
    const dirty = await this.hasChanges(worktreePath);
    if (dirty) return true;

    await this.exec(`git worktree remove "${worktreePath}"`, { cwd: worktreePath });
    await this.exec(`git branch -d "${branch}"`, { cwd: worktreePath }).catch(() => {});
    return false;
  }

  async getInfo(worktreePath: string, branch: string): Promise<WorktreeInfo> {
    return {
      branch,
      path: worktreePath,
      hasChanges: await this.hasChanges(worktreePath),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/worktree-manager.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/unified/worktree-manager.ts tests/unified/worktree-manager.test.ts
git commit -m "feat(unified): add WorktreeManager for write-type isolation"
```

---

### Task 8: Two-Phase Pipeline

**Files:**
- Create: `packages/core/src/unified/two-phase-pipeline.ts`
- Test: `tests/unified/two-phase-pipeline.test.ts`
- Depends on: Tasks 1, 2, 3, 6, 7

This is the central orchestrator. It wires together the type registry, skill loader, worktree manager, reviewer output parser, and provider sessions.

- [ ] **Step 1: Write the failing test**

Create `tests/unified/two-phase-pipeline.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runTwoPhasePipeline } from '../../packages/core/src/unified/two-phase-pipeline.js';
import type { PipelineInput, PipelineResult } from '../../packages/core/src/unified/two-phase-pipeline.js';

// Mock provider that returns canned responses
function mockProvider(implementerResponse: string, reviewerResponse?: string) {
  const sessions: any[] = [];
  return {
    openSession: vi.fn().mockImplementation(() => {
      const isReviewer = sessions.length > 0;
      const response = isReviewer ? (reviewerResponse ?? '') : implementerResponse;
      const session = {
        send: vi.fn().mockResolvedValue({
          output: response,
          costUsd: 0.01,
          inputTokens: 100,
          outputTokens: 50,
        }),
        close: vi.fn().mockResolvedValue(undefined),
        getSessionId: vi.fn().mockReturnValue(`sess-${sessions.length}`),
      };
      sessions.push(session);
      return session;
    }),
    sessions,
  };
}

const validReviewerJson = JSON.stringify({
  findings: [],
  summary: 'Looks good.',
  verdict: 'approved',
});

describe('two-phase-pipeline', () => {
  it('runs implementer only when reviewPolicy is none', async () => {
    const provider = mockProvider('Implementer did the work.');
    const result = await runTwoPhasePipeline({
      type: 'audit',
      implementerSkill: '# Audit implementer skill',
      reviewerSkill: '# Audit reviewer skill',
      taskPayload: JSON.stringify({ filePaths: ['spec.md'] }),
      implementerProvider: provider,
      reviewerProvider: provider,
      implementerTier: 'complex',
      reviewerTier: 'standard',
      reviewPolicy: 'none',
      cwd: '/tmp/test',
      sandboxPolicy: 'read-only',
    });

    expect(result.status).toBe('done');
    expect(result.implementerOutput).toBe('Implementer did the work.');
    expect(result.reviewerOutput).toBeNull();
    expect(result.reviewerRaw).toBeNull();
    expect(result.sessions.implementer.sessionId).toBe('sess-0');
    expect(result.sessions.reviewer).toBeNull();
    expect(result.cost.implementerUsd).toBe(0.01);
    expect(result.cost.reviewerUsd).toBeNull();
    expect(provider.openSession).toHaveBeenCalledTimes(1);
  });

  it('runs both phases when reviewPolicy is reviewed', async () => {
    const implProvider = mockProvider('Implementer output.');
    const revProvider = mockProvider('', `\`\`\`json\n${validReviewerJson}\n\`\`\``);

    const result = await runTwoPhasePipeline({
      type: 'audit',
      implementerSkill: '# Audit implementer skill',
      reviewerSkill: '# Audit reviewer skill',
      taskPayload: JSON.stringify({ filePaths: ['spec.md'] }),
      implementerProvider: implProvider,
      reviewerProvider: revProvider,
      implementerTier: 'complex',
      reviewerTier: 'standard',
      reviewPolicy: 'reviewed',
      cwd: '/tmp/test',
      sandboxPolicy: 'read-only',
    });

    expect(result.status).toBe('done');
    expect(result.implementerOutput).toBe('Implementer output.');
    expect(result.reviewerOutput).not.toBeNull();
    expect(result.reviewerOutput!.verdict).toBe('approved');
    expect(result.sessions.reviewer).not.toBeNull();
    expect(result.cost.reviewerUsd).toBe(0.01);
  });

  it('returns done_with_concerns when reviewer output is unparseable', async () => {
    const implProvider = mockProvider('Work done.');
    const revProvider = mockProvider('', 'This is not JSON at all.');

    const result = await runTwoPhasePipeline({
      type: 'audit',
      implementerSkill: '# skill',
      reviewerSkill: '# skill',
      taskPayload: '{}',
      implementerProvider: implProvider,
      reviewerProvider: revProvider,
      implementerTier: 'complex',
      reviewerTier: 'standard',
      reviewPolicy: 'reviewed',
      cwd: '/tmp/test',
      sandboxPolicy: 'read-only',
    });

    expect(result.status).toBe('done_with_concerns');
    expect(result.reviewerOutput).toBeNull();
    expect(result.reviewerParseError).toContain('No JSON');
    expect(result.reviewerRaw).toBe('This is not JSON at all.');
  });

  it('returns session IDs from both phases', async () => {
    const implProvider = mockProvider('output');
    const revProvider = mockProvider('', `\`\`\`json\n${validReviewerJson}\n\`\`\``);

    const result = await runTwoPhasePipeline({
      type: 'delegate',
      implementerSkill: '# skill',
      reviewerSkill: '# skill',
      taskPayload: '{}',
      implementerProvider: implProvider,
      reviewerProvider: revProvider,
      implementerTier: 'standard',
      reviewerTier: 'complex',
      reviewPolicy: 'reviewed',
      cwd: '/tmp/test',
      sandboxPolicy: 'cwd-only',
    });

    expect(result.sessions.implementer.sessionId).toBe('sess-0');
    expect(result.sessions.implementer.tier).toBe('standard');
    expect(result.sessions.reviewer!.sessionId).toBe('sess-0');
    expect(result.sessions.reviewer!.tier).toBe('complex');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/two-phase-pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/core/src/unified/two-phase-pipeline.ts`:

```typescript
import { parseReviewerOutput } from './reviewer-output-parser.js';
import type { ReviewerOutput } from './reviewer-output-parser.js';
import type { TaskType, AgentType, SandboxPolicy } from './type-registry.js';

export interface SessionInfo {
  tier: AgentType;
  sessionId: string | null;
  resumeSupported: boolean;
}

export interface PipelineInput {
  type: TaskType;
  implementerSkill: string;
  reviewerSkill: string;
  taskPayload: string;
  implementerProvider: any;       // Provider interface
  reviewerProvider: any;          // Provider interface
  implementerTier: AgentType;
  reviewerTier: AgentType;
  reviewPolicy: 'reviewed' | 'none';
  cwd: string;
  sandboxPolicy: SandboxPolicy;
  worktreeEnabled?: boolean;
  taskId?: string;
  implementerGoal?: string;
  reviewerGoal?: string;
  timeoutMs?: number;
  resumeImplementer?: string;
  resumeReviewer?: string;
}

export interface TurnResult {
  output: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface PipelineResult {
  status: 'done' | 'done_with_concerns' | 'failed';
  implementerOutput: string;
  implementerTurn: TurnResult;
  reviewerOutput: ReviewerOutput | null;
  reviewerRaw: string | null;
  reviewerTurn: TurnResult | null;
  reviewerParseError: string | null;
  sessions: {
    implementer: SessionInfo;
    reviewer: SessionInfo | null;
  };
  cost: {
    implementerUsd: number;
    reviewerUsd: number | null;
  };
  worktree: { branch: string; path: string; hasChanges: boolean } | null;
}

export async function runTwoPhasePipeline(input: PipelineInput): Promise<PipelineResult> {
  // Phase 1: Implementer
  const implSession = await input.implementerProvider.openSession(
    input.resumeImplementer ? { resume: input.resumeImplementer } : {},
  );

  const implPrompt = buildImplementerPrompt(input);
  const implTurn: TurnResult = await implSession.send(implPrompt, {
    cwd: input.cwd,
    sandboxPolicy: input.sandboxPolicy,
    goal: input.implementerGoal,
    timeoutMs: input.timeoutMs,
  });

  const implSessionId = implSession.getSessionId?.() ?? null;
  const implSessionInfo: SessionInfo = {
    tier: input.implementerTier,
    sessionId: implSessionId,
    resumeSupported: implSessionId !== null,
  };

  // Phase 1 only — skip reviewer
  if (input.reviewPolicy === 'none') {
    return {
      status: 'done',
      implementerOutput: implTurn.output,
      implementerTurn: implTurn,
      reviewerOutput: null,
      reviewerRaw: null,
      reviewerTurn: null,
      reviewerParseError: null,
      sessions: { implementer: implSessionInfo, reviewer: null },
      cost: { implementerUsd: implTurn.costUsd, reviewerUsd: null },
      worktree: null,
    };
  }

  // Phase 2: Reviewer
  const revSession = await input.reviewerProvider.openSession(
    input.resumeReviewer ? { resume: input.resumeReviewer } : {},
  );

  const revPrompt = buildReviewerPrompt(input, implTurn.output);
  const revTurn: TurnResult = await revSession.send(revPrompt, {
    cwd: input.cwd,
    sandboxPolicy: input.sandboxPolicy,
    goal: input.reviewerGoal,
    timeoutMs: input.timeoutMs,
  });

  const revSessionId = revSession.getSessionId?.() ?? null;
  const revSessionInfo: SessionInfo = {
    tier: input.reviewerTier,
    sessionId: revSessionId,
    resumeSupported: revSessionId !== null,
  };

  // Parse reviewer output
  const parsed = parseReviewerOutput(revTurn.output);
  let status: PipelineResult['status'] = 'done';
  let reviewerOutput: ReviewerOutput | null = null;
  let reviewerParseError: string | null = null;

  if (parsed.ok) {
    reviewerOutput = parsed.data;
  } else {
    status = 'done_with_concerns';
    reviewerParseError = parsed.error;
  }

  return {
    status,
    implementerOutput: implTurn.output,
    implementerTurn: implTurn,
    reviewerOutput,
    reviewerRaw: revTurn.output,
    reviewerTurn: revTurn,
    reviewerParseError,
    sessions: { implementer: implSessionInfo, reviewer: revSessionInfo },
    cost: { implementerUsd: implTurn.costUsd, reviewerUsd: revTurn.costUsd },
    worktree: null,
  };
}

function buildImplementerPrompt(input: PipelineInput): string {
  return `${input.implementerSkill}\n\n---\n\n## Task\n\n${input.taskPayload}`;
}

function buildReviewerPrompt(input: PipelineInput, implementerOutput: string): string {
  return `${input.reviewerSkill}\n\n---\n\n## Implementer Output\n\n${implementerOutput}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/two-phase-pipeline.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/unified/two-phase-pipeline.ts tests/unified/two-phase-pipeline.test.ts
git commit -m "feat(unified): add two-phase pipeline — implementer → reviewer → annotate"
```

---

## Phase 2 — Unified Handler

---

### Task 9: Unified Task Handler (POST /task + GET /task/:taskId)

**Files:**
- Create: `packages/server/src/http/handlers/unified-task.ts`
- Test: `tests/unified/unified-task-handler.test.ts`
- Depends on: Tasks 1, 3, 4, 5, 8

This handler replaces all 10 per-route handlers and the batch polling handler.

- [ ] **Step 1: Write the failing test**

Create `tests/unified/unified-task-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildUnifiedTaskHandler, buildTaskPollHandler } from '../../packages/server/src/http/handlers/unified-task.js';
import { TaskRegistry } from '../../packages/core/src/unified/task-registry.js';

// Minimal HandlerDeps mock
function mockDeps() {
  return {
    config: { skills: { dir: 'packages/core/src/skills' } },
    logWriter: { write: vi.fn() },
    bus: { emit: vi.fn() },
    projectRegistry: {
      reserveProject: vi.fn().mockReturnValue({
        ok: true,
        projectContext: {
          cwd: '/repo',
          contextBlocks: { get: vi.fn(), set: vi.fn() },
        },
      }),
    },
    taskRegistry: new TaskRegistry(),
  };
}

// Minimal req/res mocks
function mockReq(method: string, url: string) {
  return { method, url, headers: {} };
}

function mockRes() {
  let body = '';
  let statusCode = 0;
  let headers: Record<string, string> = {};
  return {
    writeHead: vi.fn((code: number, hdrs: Record<string, string>) => {
      statusCode = code;
      headers = hdrs;
    }),
    end: vi.fn((data: string) => { body = data; }),
    get statusCode() { return statusCode; },
    get body() { return body; },
    get headers() { return headers; },
  };
}

describe('buildUnifiedTaskHandler', () => {
  it('returns 400 for invalid type', async () => {
    const deps = mockDeps();
    const handler = buildUnifiedTaskHandler(deps as any);
    const res = mockRes();

    await handler(mockReq('POST', '/task') as any, res as any, {}, {
      body: { type: 'invalid_type' },
      cwd: '/repo',
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('returns 202 with taskId for valid delegate', async () => {
    const deps = mockDeps();
    const handler = buildUnifiedTaskHandler(deps as any);
    const res = mockRes();

    await handler(mockReq('POST', '/task') as any, res as any, {}, {
      body: {
        type: 'delegate',
        tasks: [{ prompt: 'Do the thing' }],
      },
      cwd: '/repo',
    });

    expect(res.statusCode).toBe(202);
    const parsed = JSON.parse(res.body);
    expect(parsed.taskId).toBeDefined();
    expect(typeof parsed.taskId).toBe('string');
  });

  it('returns 400 for missing required fields', async () => {
    const deps = mockDeps();
    const handler = buildUnifiedTaskHandler(deps as any);
    const res = mockRes();

    await handler(mockReq('POST', '/task') as any, res as any, {}, {
      body: { type: 'delegate' },  // missing tasks
      cwd: '/repo',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('buildTaskPollHandler', () => {
  it('returns 404 for unknown taskId', async () => {
    const deps = mockDeps();
    const handler = buildTaskPollHandler(deps as any);
    const res = mockRes();

    await handler(mockReq('GET', '/task/unknown-id') as any, res as any, { taskId: 'unknown-id' }, {});

    expect(res.statusCode).toBe(404);
  });

  it('returns 202 with headline for pending task', async () => {
    const deps = mockDeps();
    deps.taskRegistry.register('task-abc', '/repo', 'delegate');
    deps.taskRegistry.setHeadline('task-abc', 'Phase 1: working...');
    const handler = buildTaskPollHandler(deps as any);
    const res = mockRes();

    await handler(mockReq('GET', '/task/task-abc') as any, res as any, { taskId: 'task-abc' }, {});

    expect(res.statusCode).toBe(202);
    expect(res.body).toContain('Phase 1');
  });

  it('returns 200 with result for completed task', async () => {
    const deps = mockDeps();
    deps.taskRegistry.register('task-abc', '/repo', 'delegate');
    deps.taskRegistry.complete('task-abc', { status: 'done', report: {} });
    const handler = buildTaskPollHandler(deps as any);
    const res = mockRes();

    await handler(mockReq('GET', '/task/task-abc') as any, res as any, { taskId: 'task-abc' }, {});

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/unified-task-handler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/server/src/http/handlers/unified-task.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { taskInputSchema } from '@zhixuan92/multi-model-agent-core/unified/task-input-schema.js';
import { getTypeConfig, oppositeAgent } from '@zhixuan92/multi-model-agent-core/unified/type-registry.js';
import { loadSkill } from '@zhixuan92/multi-model-agent-core/unified/skill-loader.js';
import { runTwoPhasePipeline } from '@zhixuan92/multi-model-agent-core/unified/two-phase-pipeline.js';
import type { TaskType } from '@zhixuan92/multi-model-agent-core/unified/type-registry.js';
import type { RawHandler } from '../request-pipeline.js';

// Adjust imports based on actual HandlerDeps, sendJson, sendError patterns
// The worker must read the existing handler files to match the exact patterns

interface HandlerDeps {
  config: any;
  logWriter: any;
  bus: any;
  projectRegistry: any;
  taskRegistry: any;
}

export function buildUnifiedTaskHandler(deps: HandlerDeps): RawHandler {
  return async (_req, res, _params, ctx) => {
    const parsed = taskInputSchema.safeParse(ctx.body);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: { code: 'invalid_request', message: parsed.error.message },
      });
      return;
    }

    const input = parsed.data;
    const cwd = ctx.cwd;

    // Validate cwd
    if (!cwd) {
      sendJson(res, 400, { error: { code: 'invalid_cwd', message: 'cwd is required' } });
      return;
    }

    // Reserve project
    const reserve = deps.projectRegistry.reserveProject(cwd);
    if (!reserve.ok) {
      sendJson(res, 503, { error: { code: 'capacity_exceeded', message: reserve.reason } });
      return;
    }

    const taskId = randomUUID();
    const type = input.type as TaskType;
    const typeConfig = getTypeConfig(type);

    // Resolve tiers
    const implementerTier = input.agentTier ?? typeConfig.defaultTier;
    const reviewerTier = oppositeAgent(implementerTier);
    const reviewPolicy = input.reviewPolicy ?? 'reviewed';

    // Register task
    deps.taskRegistry.register(taskId, cwd, type);

    // Return 202 immediately
    sendJson(res, 202, { taskId, statusUrl: `/task/${taskId}` });

    // Run pipeline asynchronously
    setImmediate(() => {
      void (async () => {
        try {
          // Load skill files
          const skillsDir = deps.config.skills?.dir ?? 'packages/core/src/skills';
          const skillPair = await loadSkill(type, skillsDir, (input as any).subtype);

          // Resolve providers (uses existing createProvider from provider-factory)
          const implProvider = createProviderForTier(deps.config, implementerTier);
          const revProvider = createProviderForTier(deps.config, reviewerTier);

          // Extract task payload (everything except common fields)
          const { type: _t, agentTier: _at, reviewPolicy: _rp, sessionIds: _si, contextBlockIds: _cbi, ...payload } = input;

          const result = await runTwoPhasePipeline({
            type,
            implementerSkill: skillPair.implement,
            reviewerSkill: skillPair.review,
            taskPayload: JSON.stringify(payload),
            implementerProvider: implProvider,
            reviewerProvider: revProvider,
            implementerTier,
            reviewerTier,
            reviewPolicy,
            cwd,
            sandboxPolicy: typeConfig.sandbox,
            worktreeEnabled: typeConfig.worktree,
            taskId,
            resumeImplementer: input.sessionIds?.implementer,
            resumeReviewer: input.sessionIds?.reviewer,
          });

          // Build response envelope
          const envelope = {
            taskId,
            type,
            status: result.status,
            report: result.reviewerOutput ?? { raw: result.implementerOutput },
            sessions: {
              implementer: result.sessions.implementer,
              reviewer: result.sessions.reviewer,
            },
            worktree: result.worktree,
            cost: result.cost,
            error: null,
          };

          deps.taskRegistry.complete(taskId, envelope);
        } catch (err: any) {
          deps.taskRegistry.fail(taskId, {
            taskId,
            type,
            status: 'failed',
            error: { code: err.code ?? 'provider_error', message: err.message },
          });
        }
      })();
    });
  };
}

export function buildTaskPollHandler(deps: HandlerDeps): RawHandler {
  return async (_req, res, params, _ctx) => {
    const taskId = params.taskId;
    const entry = deps.taskRegistry.get(taskId);

    if (!entry) {
      sendJson(res, 404, { error: { code: 'not_found', message: `Task ${taskId} not found` } });
      return;
    }

    if (!deps.taskRegistry.isTerminal(taskId)) {
      res.writeHead(202, { 'Content-Type': 'text/plain' });
      res.end(entry.runningHeadline ?? 'Processing...');
      return;
    }

    sendJson(res, 200, entry.result);
  };
}

function sendJson(res: any, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function createProviderForTier(config: any, tier: string): any {
  // Delegates to existing provider-factory.ts createProvider()
  // Worker must wire this to the real import
  const { createProvider } = require('@zhixuan92/multi-model-agent-core');
  return createProvider(tier, config);
}
```

**Important for worker:** The handler above is a structural skeleton. The worker must:
1. Read `packages/server/src/http/handlers/tools/delegate.ts` for the exact `RawHandler` type, `sendJson`/`sendError` patterns, and `HandlerDeps` interface
2. Read `packages/server/src/http/request-pipeline.ts` for the middleware context shape (`ctx.body`, `ctx.cwd`, etc.)
3. Match the existing patterns exactly — ESM imports with `.js` extensions, no `require()`

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/unified-task-handler.test.ts`
Expected: PASS — all 6 assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/http/handlers/unified-task.ts tests/unified/unified-task-handler.test.ts
git commit -m "feat(server): add unified POST /task + GET /task/:taskId handler"
```

---

### Task 10: Server Route Wiring

**Files:**
- Modify: `packages/server/src/http/server.ts`
- Depends on: Task 9

- [ ] **Step 1: Read the current server.ts**

Read `packages/server/src/http/server.ts` to understand route registration. At 4.9.1 it loops through `ToolSurfaceRegistry` entries and registers per-tool handlers. Replace with unified route registration.

- [ ] **Step 2: Replace per-tool registration with unified routes**

In `packages/server/src/http/server.ts`, replace the `registerToolHandlers()` loop with:

```typescript
import { buildUnifiedTaskHandler, buildTaskPollHandler } from './handlers/unified-task.js';

// Replace the ToolSurfaceRegistry-based registration:
router.register('POST', '/task', buildUnifiedTaskHandler(deps));
router.register('GET', '/task/:taskId', buildTaskPollHandler(deps));
```

Keep `context-blocks`, `health`, and `status` routes unchanged. Remove the batch polling route (`GET /batch/:id`).

- [ ] **Step 3: Update HandlerDeps to include TaskRegistry**

In the deps construction, replace `batchRegistry: new BatchRegistry()` with `taskRegistry: new TaskRegistry()`:

```typescript
import { TaskRegistry } from '@zhixuan92/multi-model-agent-core/unified/task-registry.js';

const taskRegistry = new TaskRegistry();
const deps: HandlerDeps = {
  config,
  logWriter,
  bus,
  projectRegistry,
  taskRegistry,
};
```

- [ ] **Step 4: Add skill validation at startup**

Before starting the HTTP listener, validate that all skill files exist:

```typescript
import { validateSkillsExist } from '@zhixuan92/multi-model-agent-core/unified/skill-loader.js';
import { TASK_TYPES } from '@zhixuan92/multi-model-agent-core/unified/type-registry.js';

await validateSkillsExist(TASK_TYPES, config.skills?.dir ?? 'packages/core/src/skills');
```

- [ ] **Step 5: Run build to verify compilation**

Run: `npm run build`
Expected: No type errors. All imports resolve.

- [ ] **Step 6: Run all existing tests**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run`
Expected: Existing tests that hit per-route endpoints will fail (expected — they'll be updated in Task 17). New unified tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/http/server.ts
git commit -m "feat(server): wire unified /task routes, add skill validation at startup"
```

---

## Phase 3 — Remaining Skill Files + Enrichment

---

### Task 11: Skill Files for All Remaining Types

**Files:**
- Create: `packages/core/src/skills/investigate/implement.md`
- Create: `packages/core/src/skills/investigate/review.md`
- Create: `packages/core/src/skills/execute_plan/implement.md`
- Create: `packages/core/src/skills/execute_plan/review.md`
- Create: `packages/core/src/skills/review/implement.md`
- Create: `packages/core/src/skills/review/review.md`
- Create: `packages/core/src/skills/debug/implement.md`
- Create: `packages/core/src/skills/debug/review.md`
- Create: `packages/core/src/skills/research/implement.md`
- Create: `packages/core/src/skills/research/review.md`
- Create: `packages/core/src/skills/journal_recall/implement.md`
- Create: `packages/core/src/skills/journal_recall/review.md`
- Create: `packages/core/src/skills/journal_record/implement.md`
- Create: `packages/core/src/skills/journal_record/review.md`

**Note:** Skill file prompt content is iterative per the spec (§15 Open Item 1). Create stub files with structural markers that the reviewer output parser expects. Each file must:
1. Define the role (implementer or reviewer)
2. List what to check / what to produce
3. For `review.md`: mandate the structured JSON output format

- [ ] **Step 1: Read existing tool-config.ts files for each type**

Read these files to extract domain-specific criteria that should be encoded in the skill file:
- `packages/core/src/tools/investigate/tool-config.ts`
- `packages/core/src/tools/execute-plan/tool-config.ts` (hyphenated directory name)
- `packages/core/src/tools/review/tool-config.ts`
- `packages/core/src/tools/debug/tool-config.ts`
- `packages/core/src/tools/research/tool-config.ts`
- `packages/core/src/tools/journal-record/tool-config.ts`
- `packages/core/src/tools/journal-recall/tool-config.ts`

Extract the `criteria`, `briefSlot`, and `done` conditions from each. These become the implement.md content.

- [ ] **Step 2: Create implement.md for each type**

For each type, write an `implement.md` that encodes the type's criteria as a single goal prompt. Template:

```markdown
# [Type] — Implementer

You are [role description]. [Primary instruction].

## Criteria
- [criterion 1 from existing tool-config]
- [criterion 2]
- ...

## Output Format
[What to produce — structured text, file changes, etc.]

## Definition of Done
- [ ] All criteria addressed
- [ ] Output matches expected format
- [ ] [type-specific checks]
```

- [ ] **Step 3: Create review.md for each type**

For each type, write a `review.md` with the structured output mandate:

```markdown
# [Type] — Reviewer

You are reviewing work produced by another agent on a [type] task.

## Review Checklist
- [type-specific checks]
- Were any criteria missed?
- Are findings accurate (not hallucinated)?

## Output Format

You MUST produce a JSON block:

```json
{
  "findings": [{ "severity": "critical|high|medium|low", "category": "...", "description": "...", "location": "...", "fix": "applied|suggested" }],
  "summary": "...",
  "verdict": "approved|changes_made"
}
```
```

- [ ] **Step 4: Run skill validation**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/skill-loader.test.ts`

Then add a test that validates all 9 types:

```typescript
it('validateSkillsExist passes for all TASK_TYPES', async () => {
  await expect(validateSkillsExist(TASK_TYPES, SKILLS_DIR)).resolves.toBeUndefined();
});
```

Expected: PASS — all 9 types have both files.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills/
git commit -m "feat(skills): add implement.md + review.md for all 9 task types"
```

---

### Task 12: Type-Specific Enrichment Hooks

**Files:**
- Modify: `packages/server/src/http/handlers/unified-task.ts`
- Modify: `packages/core/src/unified/type-registry.ts` (add enrichment hook type)
- Test: `tests/unified/enrichment-hooks.test.ts`
- Depends on: Task 9

Three types need pre-dispatch processing that can't be pushed into the Zod schema:
1. **investigate**: file path canonicalization + cwd escape check (security)
2. **execute_plan**: inject cwd from URL into body
3. **research**: resolve context blocks + check API availability (Brave)

- [ ] **Step 1: Read existing enrichment logic**

Read these handler files to extract the pre-dispatch logic:
- `packages/server/src/http/handlers/tools/investigate.ts` — look for path canonicalization
- `packages/server/src/http/handlers/tools/execute-plan.ts` — look for cwd injection
- `packages/server/src/http/handlers/tools/research.ts` — look for API availability check

- [ ] **Step 2: Define enrichment hook interface**

In `packages/core/src/unified/type-registry.ts`, add:

```typescript
export type EnrichmentHook = (
  input: Record<string, unknown>,
  cwd: string,
) => Record<string, unknown> | Promise<Record<string, unknown>>;
```

Add an optional `enrich` field to `TypeConfig`:

```typescript
export interface TypeConfig {
  defaultTier: AgentType;
  worktree: boolean;
  sandbox: SandboxPolicy;
  enrich?: EnrichmentHook;
}
```

- [ ] **Step 3: Implement enrichment hooks**

In `unified-task.ts`, call the enrichment hook before building the task payload:

```typescript
const typeConfig = getTypeConfig(type);
let enrichedPayload = payload;
if (typeConfig.enrich) {
  enrichedPayload = await typeConfig.enrich(payload, cwd);
}
```

The actual enrichment functions are extracted from the existing handler files. For example, investigate enrichment:

```typescript
function enrichInvestigate(input: Record<string, unknown>, cwd: string): Record<string, unknown> {
  if (input.filePaths && Array.isArray(input.filePaths)) {
    const resolved = (input.filePaths as string[]).map(fp => {
      const abs = path.resolve(cwd, fp);
      if (!abs.startsWith(cwd)) throw new Error(`Path escapes cwd: ${fp}`);
      return abs;
    });
    return { ...input, filePaths: resolved };
  }
  return input;
}
```

- [ ] **Step 4: Write enrichment tests**

Create `tests/unified/enrichment-hooks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('investigate enrichment', () => {
  it('canonicalizes relative file paths', () => {
    // Test that ./src/foo.ts resolves to /repo/src/foo.ts
  });

  it('rejects paths that escape cwd', () => {
    // Test that ../../etc/passwd throws
  });
});

describe('execute_plan enrichment', () => {
  it('injects cwd into payload', () => {
    // Test that cwd is set on the payload
  });
});
```

- [ ] **Step 5: Run tests**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/enrichment-hooks.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/unified/type-registry.ts packages/server/src/http/handlers/unified-task.ts tests/unified/enrichment-hooks.test.ts
git commit -m "feat(unified): add type-specific enrichment hooks for investigate, execute_plan, research"
```

---

## Phase 4 — Cutover: Delete Old Code

---

### Task 13: Delete Per-Route Handlers + ToolSurfaceRegistry

**Files:**
- Delete: `packages/server/src/http/handlers/tools/delegate.ts`
- Delete: `packages/server/src/http/handlers/tools/audit.ts`
- Delete: `packages/server/src/http/handlers/tools/investigate.ts`
- Delete: `packages/server/src/http/handlers/tools/review.ts`
- Delete: `packages/server/src/http/handlers/tools/debug.ts`
- Delete: `packages/server/src/http/handlers/tools/execute-plan.ts`
- Delete: `packages/server/src/http/handlers/tools/research.ts`
- Delete: `packages/server/src/http/handlers/tools/journal-record.ts`
- Delete: `packages/server/src/http/handlers/tools/journal-recall.ts`
- Delete: `packages/server/src/http/handlers/tools/retry.ts`
- Delete: `packages/core/src/tool-surface/tool-surface-registry.ts`
- Delete: `packages/core/src/tool-surface/register-all-tools.ts`
- Modify: `packages/core/src/index.ts` — remove ToolSurfaceRegistry re-exports
- Modify: `packages/server/src/http/server.ts` — remove ToolSurfaceRegistry import
- Depends on: Task 10 (unified routes wired)

- [ ] **Step 1: Verify unified handler serves all types**

Before deleting anything, confirm:
Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/`
Expected: All unified tests pass.

- [ ] **Step 2: Delete per-route handler files**

```bash
rm packages/server/src/http/handlers/tools/delegate.ts
rm packages/server/src/http/handlers/tools/audit.ts
rm packages/server/src/http/handlers/tools/investigate.ts
rm packages/server/src/http/handlers/tools/review.ts
rm packages/server/src/http/handlers/tools/debug.ts
rm packages/server/src/http/handlers/tools/execute-plan.ts
rm packages/server/src/http/handlers/tools/research.ts
rm packages/server/src/http/handlers/tools/journal-record.ts
rm packages/server/src/http/handlers/tools/journal-recall.ts
rm packages/server/src/http/handlers/tools/retry.ts
```

- [ ] **Step 3: Delete ToolSurfaceRegistry**

```bash
rm packages/core/src/tool-surface/tool-surface-registry.ts
rm packages/core/src/tool-surface/register-all-tools.ts
```

If the `tool-surface/` directory is now empty, delete it:
```bash
rmdir packages/core/src/tool-surface/
```

- [ ] **Step 4: Remove imports from barrel exports**

In `packages/core/src/index.ts`, remove any re-exports of `ToolSurfaceRegistry`, `buildToolSurfaceRegistry`, `registerAllTools`, or `SurfaceEntry`.

In `packages/server/src/http/server.ts`, remove the `ToolSurfaceRegistry` import and the `registerToolHandlers()` call/function.

- [ ] **Step 5: Run build to find broken imports**

Run: `npm run build`
Expected: Compilation errors will point to any remaining references to deleted files. Fix each one.

- [ ] **Step 6: Run tests**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run`
Expected: Tests that referenced per-route handlers or ToolSurfaceRegistry will fail. These need updating in Task 17. Unified tests should pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: delete per-route handlers and ToolSurfaceRegistry"
```

---

### Task 14: Delete Batch System

**Files:**
- Delete: `packages/core/src/stores/batch-registry.ts`
- Delete: `packages/core/src/stores/batch-cache.ts`
- Delete: `packages/server/src/http/handlers/control/batch.ts`
- Delete: `packages/server/src/http/async-dispatch.ts`
- Delete: `packages/server/src/http/execution-context.ts`
- Modify: `packages/core/src/index.ts` — remove batch re-exports
- Modify: `packages/server/src/http/server.ts` — remove batch route + imports
- Depends on: Task 13

- [ ] **Step 1: Delete batch files**

```bash
rm packages/core/src/stores/batch-registry.ts
rm packages/core/src/stores/batch-cache.ts
rm packages/server/src/http/handlers/control/batch.ts
rm packages/server/src/http/async-dispatch.ts
rm packages/server/src/http/execution-context.ts
```

- [ ] **Step 2: Remove batch route registration**

In `packages/server/src/http/server.ts`, remove:
- `GET /batch/:id` route registration
- `BatchRegistry` import and instantiation
- `asyncDispatch` import (if any remain)

- [ ] **Step 3: Remove batch re-exports from core index**

In `packages/core/src/index.ts`, remove re-exports of `BatchRegistry`, `BatchCache`, `BatchEntry`, `BatchState`.

- [ ] **Step 4: Search for remaining batch references**

```bash
grep -rn 'batch' packages/core/src/ packages/server/src/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'
```

Fix or delete any remaining references. Common places: event types (batchId in telemetry), HandlerDeps interface, test fixtures.

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: All batch references resolved. No type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete BatchRegistry, BatchCache, async-dispatch, batch handler"
```

---

### Task 15: Delete Per-Tool Config Files

**Files:**
- Delete: `packages/core/src/tools/delegate/tool-config.ts`
- Delete: `packages/core/src/tools/audit/tool-config.ts`
- Delete: `packages/core/src/tools/investigate/tool-config.ts`
- Delete: `packages/core/src/tools/review/tool-config.ts`
- Delete: `packages/core/src/tools/debug/tool-config.ts`
- Delete: `packages/core/src/tools/execute-plan/tool-config.ts`
- Delete: `packages/core/src/tools/research/tool-config.ts`
- Delete: `packages/core/src/tools/journal-record/tool-config.ts`
- Delete: `packages/core/src/tools/journal-recall/tool-config.ts`
- Delete: `packages/core/src/tools/retry/tool-config.ts`
- Depends on: Task 13

- [ ] **Step 1: List all tool-config files**

```bash
find packages/core/src/tools -name 'tool-config.ts' -type f
```

- [ ] **Step 2: Delete all tool-config files**

```bash
find packages/core/src/tools -name 'tool-config.ts' -type f -delete
```

If any `tools/` directories are now empty, delete them:
```bash
find packages/core/src/tools -type d -empty -delete
```

If the entire `tools/` directory is empty:
```bash
rmdir packages/core/src/tools/ 2>/dev/null || true
```

- [ ] **Step 3: Remove any tool-config imports**

```bash
grep -rn 'tool-config' packages/ --include='*.ts' | grep -v node_modules
```

Delete or update each reference.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete per-tool tool-config.ts files — replaced by skill files"
```

---

## Phase 5 — Wire Schema, ReviewPolicy, Safety Tweaks

---

### Task 16: ReviewPolicy Collapse + Wire Schema v6

**Files:**
- Modify: `packages/core/src/events/wire-schema.ts` — bump SCHEMA_VERSION to 6
- Modify: `packages/core/src/types/review-policy.ts` (or wherever ReviewPolicy is defined)
- Modify: `packages/core/src/events/task-envelope.ts` — update reviewPolicy field type
- Test: `tests/contract/wire-schema-version.test.ts` (if exists)

- [ ] **Step 1: Collapse ReviewPolicy to 2 values**

Find the ReviewPolicy type definition. At 4.9.1 it's:
```typescript
export type ReviewPolicy = 'full' | 'quality_only' | 'diff_only' | 'none';
```

Replace with:
```typescript
export type ReviewPolicy = 'reviewed' | 'none';
```

- [ ] **Step 2: Update all references to old ReviewPolicy values**

```bash
grep -rn "'full'\|'quality_only'\|'diff_only'" packages/ --include='*.ts' | grep -v node_modules
```

Replace `'full'` → `'reviewed'`, delete `'quality_only'` and `'diff_only'` branches.

- [ ] **Step 3: Bump SCHEMA_VERSION**

In `packages/core/src/events/wire-schema.ts`:
```typescript
export const SCHEMA_VERSION = 6;
```

- [ ] **Step 4: Update wire schema contract test**

If `tests/contract/wire-schema-version.test.ts` exists, update the expected version from 5 to 6.

- [ ] **Step 5: Run build and tests**

Run: `npm run build && env -u MMAGENT_AUTH_TOKEN npx vitest run`
Expected: Build passes. Wire schema test passes with v6.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(wire): collapse ReviewPolicy to reviewed|none, bump SCHEMA_VERSION to 6"
```

---

### Task 17: Safety Ceiling Increase + Watchdog Tweaks

**Files:**
- Modify: `packages/core/src/providers/provider-factory.ts`
- Modify: bounded-execution thrash detection (if applicable)
- Test: `tests/contract/lifecycle/safety-ceiling.test.ts` (update expected value)

- [ ] **Step 1: Increase SAFETY_CEILING**

In `packages/core/src/providers/provider-factory.ts`, change:
```typescript
const SAFETY_CEILING = 100;
```
to:
```typescript
const SAFETY_CEILING = 200;
```

- [ ] **Step 2: Skip thrash detection for reviewer phases**

Find the progress/thrash watchdog code (likely in `packages/core/src/bounded-execution/`). The thrash detector aborts when no file changes are detected. This false-fires on reviewer phases that legitimately produce no file changes (read-only review).

Add a condition to skip thrash detection when:
- The current phase is a reviewer phase, OR
- The type's sandbox is `read-only`

The worker should read the bounded-execution files to find the exact check location.

- [ ] **Step 3: Update safety ceiling test**

If `tests/contract/lifecycle/safety-ceiling.test.ts` asserts `SAFETY_CEILING === 100`, update to `200`.

- [ ] **Step 4: Run tests**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/provider-factory.ts packages/core/src/bounded-execution/
git commit -m "fix: increase safety ceiling to 200, skip thrash detection for reviewer phases"
```

---

## Phase 6 — Contract Tests + Final Sweep

---

### Task 18: Update Contract Tests + Goldens

**Files:**
- Modify: `tests/contract/manifest.test.ts` — update route list
- Modify: `tests/contract/goldens/` — regenerate per-endpoint goldens
- Modify: `tests/contract/http/` — update handler tests to use /task endpoint
- Modify: `tests/contract/observability.test.ts` — update event shape if needed
- Depends on: Tasks 13-16 (all deletions complete)

- [ ] **Step 1: Update route manifest golden**

Read `tests/contract/manifest.test.ts`. It asserts the exact set of registered routes. Update to match the new surface:

```typescript
const EXPECTED_ROUTES = [
  { method: 'POST', path: '/task' },
  { method: 'GET', path: '/task/:taskId' },
  { method: 'POST', path: '/context-blocks' },
  { method: 'DELETE', path: '/context-blocks/:blockId' },
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/status' },
];
```

Remove all per-tool route assertions (`/delegate`, `/audit`, `/investigate`, etc.) and `GET /batch/:id`.

- [ ] **Step 2: Update per-endpoint goldens**

Check `tests/contract/goldens/` for golden files referencing old endpoints. Delete goldens for removed routes. Create goldens for:
- `POST /task` → 202 response shape
- `GET /task/:taskId` → pending (202) and terminal (200) shapes

- [ ] **Step 3: Update HTTP contract tests**

Read files under `tests/contract/http/`. Any test that posts to `/delegate`, `/audit`, etc. must be rewritten to post to `/task` with the appropriate `type` discriminator.

For example, a test that was:
```typescript
const res = await post('/delegate', { tasks: [...] });
```
becomes:
```typescript
const res = await post('/task', { type: 'delegate', tasks: [...] });
```

- [ ] **Step 4: Update observability tests**

If `tests/contract/observability.test.ts` asserts on event shapes containing `batchId` or old ReviewPolicy values, update:
- `batchId` → `taskId` (if the wire event changed)
- `'full'` → `'reviewed'`

- [ ] **Step 5: Run all contract tests**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/contract/`
Expected: All contract tests pass with updated goldens.

- [ ] **Step 6: Commit**

```bash
git add tests/contract/
git commit -m "test(contract): update goldens and assertions for unified /task endpoint"
```

---

### Task 19: Update Packaged Skills (Server Skill Files)

**Files:**
- Modify: `packages/server/src/skills/mma-*/SKILL.md` (any that reference per-route endpoints)

- [ ] **Step 1: Find references to old endpoints**

```bash
grep -rn '/delegate\|/audit\|/investigate\|/execute-plan\|/review\|/debug\|/research\|/journal-record\|/journal-recall\|/retry\|/batch/' packages/server/src/skills/ --include='*.md'
```

- [ ] **Step 2: Update endpoint references**

In each SKILL.md that references old per-route endpoints, update to `POST /task` with the `type` field. For example:

Before: `POST /delegate with { tasks: [...] }`
After: `POST /task with { type: "delegate", tasks: [...] }`

Before: `GET /batch/:id`
After: `GET /task/:taskId`

- [ ] **Step 3: Update batchId → taskId references**

```bash
grep -rn 'batchId' packages/server/src/skills/ --include='*.md'
```

Replace with `taskId`.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/skills/
git commit -m "docs(skills): update packaged skill files — /task endpoint, taskId references"
```

---

### Task 20: Dead Code Sweep

**Files:**
- Various — discovered during sweep
- Depends on: All previous tasks

- [ ] **Step 1: Grep for orphaned references**

Run these checks to find dead code:

```bash
# References to deleted modules
grep -rn 'ToolSurfaceRegistry\|SurfaceEntry\|registerAllTools\|buildToolSurfaceRegistry' packages/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'

# References to batch system
grep -rn 'BatchRegistry\|BatchCache\|BatchEntry\|batchId\|asyncDispatch' packages/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'

# References to old ReviewPolicy values
grep -rn "'full'\|'quality_only'\|'diff_only'" packages/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'

# References to deleted handler files
grep -rn 'handlers/tools/' packages/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'

# References to tool-config
grep -rn 'tool-config' packages/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'

# Unused imports (build will catch most)
npm run build 2>&1 | grep 'unused\|not found\|cannot find'
```

- [ ] **Step 2: Remove each orphaned reference**

For each hit from Step 1:
- If it's a re-export: delete the line
- If it's an import: delete the import and any code using it
- If it's a type reference: update to the new type
- If it's test code: update or delete the test

- [ ] **Step 3: Run full build + test suite**

Run: `npm run build && env -u MMAGENT_AUTH_TOKEN npx vitest run`
Expected: PASS — zero errors, zero dead references.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: dead code sweep — remove orphaned references to deleted modules"
```

---

### Task 21: Integration Smoke Test

**Files:**
- Create: `tests/unified/smoke.test.ts`
- Depends on: All previous tasks

- [ ] **Step 1: Write smoke test**

Create `tests/unified/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TASK_TYPES, TYPE_REGISTRY, getTypeConfig, oppositeAgent } from '../../packages/core/src/unified/type-registry.js';
import { taskInputSchema } from '../../packages/core/src/unified/task-input-schema.js';
import { loadSkill, validateSkillsExist } from '../../packages/core/src/unified/skill-loader.js';
import { parseReviewerOutput } from '../../packages/core/src/unified/reviewer-output-parser.js';
import { TaskRegistry } from '../../packages/core/src/unified/task-registry.js';
import path from 'node:path';

const SKILLS_DIR = path.resolve('packages/core/src/skills');

describe('Unified Task API — Integration Smoke', () => {
  it('all 9 types registered and have skill files', async () => {
    expect(TASK_TYPES).toHaveLength(9);
    await validateSkillsExist(TASK_TYPES, SKILLS_DIR);
  });

  it('every type has valid TypeConfig', () => {
    for (const t of TASK_TYPES) {
      const cfg = getTypeConfig(t);
      expect(['standard', 'complex']).toContain(cfg.defaultTier);
      expect(typeof cfg.worktree).toBe('boolean');
      expect(['read-only', 'cwd-only']).toContain(cfg.sandbox);
    }
  });

  it('reviewer tier is always opposite of implementer tier', () => {
    for (const t of TASK_TYPES) {
      const cfg = getTypeConfig(t);
      const revTier = oppositeAgent(cfg.defaultTier);
      expect(revTier).not.toBe(cfg.defaultTier);
    }
  });

  it('schema accepts a valid payload for each type', () => {
    const payloads: Record<string, object> = {
      delegate: { type: 'delegate', tasks: [{ prompt: 'test' }] },
      audit: { type: 'audit', filePaths: ['spec.md'] },
      investigate: { type: 'investigate', question: 'How does X work?' },
      execute_plan: { type: 'execute_plan', filePaths: ['plan.md'], taskDescriptors: ['Task 1'] },
      review: { type: 'review', filePaths: ['src/foo.ts'] },
      debug: { type: 'debug', errorMessage: 'TypeError: x is not a function' },
      research: { type: 'research', researchQuestion: 'What is the state of the art in X?', background: 'We need to understand the landscape.' },
      journal_recall: { type: 'journal_recall', query: 'What did we learn about caching?' },
      journal_record: { type: 'journal_record', entry: 'Learned that caching needs TTL.' },
    };

    for (const [type, payload] of Object.entries(payloads)) {
      const result = taskInputSchema.safeParse(payload);
      expect(result.success, `${type} should parse: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('skill files load for all types', async () => {
    for (const t of TASK_TYPES) {
      const pair = await loadSkill(t, SKILLS_DIR);
      expect(pair.implement.length).toBeGreaterThan(0);
      expect(pair.review.length).toBeGreaterThan(0);
    }
  });

  it('TaskRegistry lifecycle: register → headline → complete → poll', () => {
    const reg = new TaskRegistry();
    reg.register('t1', '/repo', 'delegate');
    expect(reg.get('t1')!.state).toBe('pending');
    expect(reg.isTerminal('t1')).toBe(false);

    reg.setHeadline('t1', 'Working...');
    expect(reg.get('t1')!.runningHeadline).toBe('Working...');

    reg.complete('t1', { status: 'done' });
    expect(reg.isTerminal('t1')).toBe(true);
    expect(reg.get('t1')!.result).toEqual({ status: 'done' });
  });

  it('reviewer output parser handles valid and invalid JSON', () => {
    const valid = parseReviewerOutput('```json\n{"findings":[],"summary":"ok","verdict":"approved"}\n```');
    expect(valid.ok).toBe(true);

    const invalid = parseReviewerOutput('no json here');
    expect(invalid.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run smoke test**

Run: `env -u MMAGENT_AUTH_TOKEN npx vitest run tests/unified/smoke.test.ts`
Expected: PASS — all 7 assertions green.

- [ ] **Step 3: Run full test suite**

Run: `npm run build && env -u MMAGENT_AUTH_TOKEN npx vitest run`
Expected: PASS — all tests green, build clean.

- [ ] **Step 4: Commit**

```bash
git add tests/unified/smoke.test.ts
git commit -m "test(unified): add integration smoke test — all 9 types end-to-end"
```

---

## Spec Coverage Verification

| Spec Section | Implementing Task(s) |
|---|---|
| §2.1 POST /task dispatch | Task 9 (handler), Task 10 (wiring) |
| §2.2 GET /task/:taskId poll | Task 9 (handler), Task 10 (wiring) |
| §2.3 TaskType enum | Task 1 (type-registry) |
| §2.4 Type-specific payload | Task 5 (Zod schema) |
| §3 Type Registry | Task 1 |
| §4 Execution Pipeline | Task 8 (two-phase-pipeline) |
| §5 Skills Architecture | Task 3 (loader), Task 11 (all skill files) |
| §6 Tier Model | Task 1 (defaultTier + oppositeAgent) |
| §7 Review Policy | Task 16 (collapse to 2 values) |
| §8 Session Reuse | Task 6 (getSessionId), Task 8 (resume in pipeline) |
| §9 Response Envelope | Task 9 (envelope construction) |
| §10 Worktree Isolation | Task 7 (worktree manager), Task 8 (pipeline integration) |
| §11 Deletions | Tasks 13-15 (handlers, batch, tool-config) |
| §12 Migration Path | Phases 1-6 (entire plan) |
| §13 Invariants | Enforced across Tasks 1, 5, 7, 8, 9 |
| §14 Acceptance Criteria AC1-AC27 | Tasks 9, 18 (contract tests) |
| §15 Error Handling | Task 9 (handler error responses), Task 12 (enrichment validation) |
| §16 Testing Strategy | Tasks 1-8 (unit), Task 21 (integration), Task 18 (contract) |
| §17.2 Safety ceiling | Task 17 |
| §17.3 Progress watchdog | Task 17 |
| §17.5 Enrichment hooks | Task 12 |
