// @vitest-environment node
// In-memory fakes for Spec-7 (Build pipeline) tests. NO real database, MMA, git,
// or LLM is ever contacted — every effectful dependency is a fake. DB state is
// provided per-test via `createMockDb` (tests/test-utils/mock-db).
import { ProjectEventBus, type ProjectEvent } from '@/sse/event-bus';
import type { GitRunner, GitRunResult } from '@/build/branch';
import type { CommandRunner, CommandOutcome } from '@/build/command-runner';
import type { PlanFs } from '@/build/plan-fs';

/** A bus that records every published event for assertions. */
export class RecordingBus extends ProjectEventBus {
  readonly events: Array<{ projectId: string; event: ProjectEvent }> = [];
  publish(projectId: string, event: ProjectEvent): void {
    this.events.push({ projectId, event });
    super.publish(projectId, event);
  }
  ofType<T extends ProjectEvent['type']>(type: T): Array<Extract<ProjectEvent, { type: T }>> {
    return this.events.map((e) => e.event).filter((e): e is Extract<ProjectEvent, { type: T }> => e.type === type);
  }
}

/** An in-memory PlanFs (records writes + appends; serves reads). */
export class FakePlanFs implements PlanFs {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  failWriteOn: string | null = null;
  async mkdir(dir: string): Promise<void> {
    this.dirs.add(dir);
  }
  async writeFile(path: string, content: string): Promise<void> {
    if (this.failWriteOn && path.includes(this.failWriteOn)) throw new Error('EACCES: write denied');
    this.files.set(path, content);
  }
  async readFile(path: string): Promise<string> {
    if (!this.files.has(path)) throw new Error('ENOENT');
    return this.files.get(path)!;
  }
  async appendFile(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? '') + content);
  }
}

/**
 * A scriptable git runner. `responses` maps a matcher (first two argv words) to a
 * GitRunResult; unmatched argv default to code 0 with the given default stdout.
 * Records every invocation for sequence assertions.
 */
export class FakeGit {
  readonly calls: Array<{ repoPath: string; argv: string[] }> = [];
  private readonly script: (argv: string[], repoPath: string) => GitRunResult;
  constructor(script: (argv: string[], repoPath: string) => GitRunResult) {
    this.script = script;
  }
  runner: GitRunner = async (repoPath, argv) => {
    this.calls.push({ repoPath, argv });
    return this.script(argv, repoPath);
  };
  /** All argv joined, for "did it call `checkout -b X`" assertions. */
  argvStrings(): string[] {
    return this.calls.map((c) => c.argv.join(' '));
  }
}

/** A simple ok-everything git script with a configurable commit log + diff. */
export function makeGitScript(opts: {
  isWorkTree?: boolean;
  attached?: boolean;
  clean?: boolean;
  branchExists?: boolean;
  defaultBranchExists?: boolean;
  currentBranch?: string;
  headBefore?: string;
  commitsSince?: string[]; // rev-list head_before..HEAD
  hasDiff?: boolean;
  inlineFixSha?: string;
}): (argv: string[], repoPath: string) => GitRunResult {
  const o = {
    isWorkTree: true,
    attached: true,
    clean: true,
    branchExists: false,
    defaultBranchExists: true,
    currentBranch: 'main',
    headBefore: 'BASE000',
    commitsSince: ['WORKER01'],
    hasDiff: true,
    inlineFixSha: 'FIX00001',
    ...opts,
  };
  let headValue = o.headBefore;
  return (argv): GitRunResult => {
    const j = argv.join(' ');
    if (j.startsWith('check-ref-format')) return { code: 0, stdout: '', stderr: '' };
    if (j === 'rev-parse --is-inside-work-tree') return { code: o.isWorkTree ? 0 : 128, stdout: o.isWorkTree ? 'true' : '', stderr: '' };
    if (j.startsWith('symbolic-ref')) return { code: o.attached ? 0 : 1, stdout: o.attached ? 'refs/heads/main' : '', stderr: '' };
    if (j === 'status --porcelain') return { code: 0, stdout: o.clean ? '' : ' M file.ts', stderr: '' };
    if (j.includes('refs/heads/') && j.startsWith('rev-parse --verify')) {
      const wantsBranch = j.includes('forge/');
      const exists = wantsBranch ? o.branchExists : o.defaultBranchExists;
      return { code: exists ? 0 : 1, stdout: exists ? 'SHA' : '', stderr: '' };
    }
    if (j === 'rev-parse --abbrev-ref HEAD') return { code: 0, stdout: o.currentBranch, stderr: '' };
    if (j === 'rev-parse HEAD') return { code: 0, stdout: headValue, stderr: '' };
    if (j.startsWith('checkout')) return { code: 0, stdout: '', stderr: '' };
    if (j.startsWith('rev-list')) return { code: 0, stdout: o.commitsSince.join('\n'), stderr: '' };
    if (j.startsWith('diff --quiet')) return { code: o.hasDiff ? 1 : 0, stdout: '', stderr: '' };
    if (j === 'add -A') return { code: 0, stdout: '', stderr: '' };
    if (j.startsWith('commit')) {
      headValue = o.inlineFixSha;
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

/** A scriptable CommandRunner — queues outcomes per argv[0] ('npm'/'pytest'/...). */
export class FakeCommandRunner implements CommandRunner {
  readonly calls: Array<{ argv: string[]; cwd: string }> = [];
  /** Outcomes consumed in order; default pass when the queue is empty. */
  private queue: CommandOutcome[] = [];
  constructor(outcomes: CommandOutcome[] = []) {
    this.queue = [...outcomes];
  }
  async run(argv: string[], opts: { cwd: string }): Promise<CommandOutcome> {
    this.calls.push({ argv, cwd: opts.cwd });
    return this.queue.shift() ?? { kind: 'pass' };
  }
}

/**
 * A fake MmaClient surface for the build modules: scripts the dispatch route →
 * batchId and the poll batchId → terminal envelope. Only the methods the build
 * pipeline calls are implemented.
 */
export class FakeMma {
  readonly dispatches: Array<{ route: string; cwd: string; body: unknown }> = [];
  private envelopeByRoute: Record<string, unknown[]>;
  private counter = 0;
  private readonly envByBatch = new Map<string, unknown>();
  failDispatch = false;

  constructor(envelopeByRoute: Record<string, unknown[]> = {}) {
    this.envelopeByRoute = {};
    for (const [k, v] of Object.entries(envelopeByRoute)) this.envelopeByRoute[k] = [...v];
  }

  private register(route: string): { batchId: string } {
    if (this.failDispatch) throw new Error('MMA dispatch failed');
    const batchId = `batch-${++this.counter}`;
    const env = (this.envelopeByRoute[route] ?? []).shift() ?? { headline: 'done', structuredReport: { findings: [] } };
    this.envByBatch.set(batchId, env);
    return { batchId };
  }

  async auditPlan(cwd: string, input: { paths: [string]; contextBlockIds?: string[] }): Promise<{ batchId: string }> {
    this.dispatches.push({ route: 'audit', cwd, body: { subtype: 'plan', ...input } });
    return this.register('audit');
  }
  async executePlan(cwd: string, input: unknown): Promise<{ batchId: string }> {
    this.dispatches.push({ route: 'execute-plan', cwd, body: input });
    return this.register('execute-plan');
  }
  async review(cwd: string, input: unknown): Promise<{ batchId: string }> {
    this.dispatches.push({ route: 'review', cwd, body: input });
    return this.register('review');
  }
  async poll(batchId: string): Promise<{ state: 'terminal'; envelope: unknown }> {
    return { state: 'terminal', envelope: this.envByBatch.get(batchId) ?? {} };
  }
}
