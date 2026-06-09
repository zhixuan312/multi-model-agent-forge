// @vitest-environment node
// Shared live-DB fixtures + in-memory fakes for Spec-7 (Build pipeline) tests.
// Throwaway rows use distinct prefixes so cleanup is exhaustive. NO real MMA, git,
// or LLM is ever contacted — every effectful dep is a fake.
import { sql, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema/identity';
import { project, stage, projectMember, projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { artifact } from '@/db/schema/artifacts';
import { actionLog } from '@/db/schema/audit';
import { ProjectEventBus, type ProjectEvent } from '@/sse/event-bus';
import type { GitRunner, GitRunResult } from '@/build/branch';
import type { CommandRunner, CommandOutcome } from '@/build/command-runner';
import type { PlanFs } from '@/build/plan-fs';

export const TEST_PROJECT_PREFIX = '__forge_build_test__';
export const TEST_MEMBER_PREFIX = '__forge_build_member__';
export const TEST_REPO_PREFIX = '__forge_build_repo__';

function rnd(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
export function uniqueName(prefix: string, label = ''): string {
  return `${prefix}${label}_${rnd()}`;
}

export async function seedMember(label = 'm'): Promise<{ id: string }> {
  const db = getDb();
  const username = uniqueName(TEST_MEMBER_PREFIX, label);
  const [m] = await db.insert(member).values({ username, displayName: username }).returning({ id: member.id });
  return { id: m.id };
}

export async function seedRepo(label = 'r', pathOnDisk = '/work/repo', kind = 'node'): Promise<{ id: string; name: string; pathOnDisk: string }> {
  const db = getDb();
  const name = uniqueName(TEST_REPO_PREFIX, label);
  const [r] = await db
    .insert(repo)
    .values({ name, pathOnDisk, defaultBranch: 'main', kind })
    .returning({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk });
  return { id: r.id, name: r.name, pathOnDisk: r.pathOnDisk };
}

export async function seedProject(opts?: { repoIds?: string[] }): Promise<{ projectId: string; ownerId: string }> {
  const db = getDb();
  const owner = await seedMember('owner');
  const name = uniqueName(TEST_PROJECT_PREFIX, 'p');
  const [proj] = await db
    .insert(project)
    .values({ name, visibility: 'public', phase: 'build', currentStage: 'plan', ownerId: owner.id })
    .returning({ id: project.id });
  await db.insert(stage).values(
    (['exploration', 'spec', 'plan', 'execute', 'review'] as const).map((kind) => ({
      projectId: proj.id,
      kind,
      status: 'pending' as const,
    })),
  );
  await db.insert(projectMember).values({ projectId: proj.id, memberId: owner.id, role: 'owner' });
  if (opts?.repoIds?.length) {
    await db.insert(projectRepo).values(opts.repoIds.map((repoId) => ({ projectId: proj.id, repoId })));
  }
  return { projectId: proj.id, ownerId: owner.id };
}

export async function seedSpec(projectId: string, body = 'Add a caching layer to the API.'): Promise<void> {
  await getDb().insert(artifact).values({ projectId, kind: 'spec', bodyMd: body, version: 1 });
}

export async function cleanupBuildFixtures(): Promise<void> {
  const db = getDb();
  const projects = await db
    .select({ id: project.id })
    .from(project)
    .where(sql`${project.name} LIKE ${TEST_PROJECT_PREFIX + '%'}`);
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length > 0) await db.delete(actionLog).where(inArray(actionLog.projectId, projectIds));

  const members = await db
    .select({ id: member.id })
    .from(member)
    .where(sql`${member.username} LIKE ${TEST_MEMBER_PREFIX + '%'}`);
  const memberIds = members.map((m) => m.id);
  if (memberIds.length > 0) await db.delete(actionLog).where(inArray(actionLog.memberId, memberIds));

  // project cascade clears stage/plan_task/mma_batch/artifact/export/project_member/project_repo.
  await db.delete(project).where(sql`${project.name} LIKE ${TEST_PROJECT_PREFIX + '%'}`);
  await db.delete(repo).where(sql`${repo.name} LIKE ${TEST_REPO_PREFIX + '%'}`);
  await db.delete(member).where(sql`${member.username} LIKE ${TEST_MEMBER_PREFIX + '%'}`);
}

/* ── In-memory fakes ──────────────────────────────────────────────────────── */

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

  async auditPlan(cwd: string, input: { filePaths: [string]; contextBlockIds?: string[] }): Promise<{ batchId: string }> {
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
