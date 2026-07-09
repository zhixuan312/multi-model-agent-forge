// @vitest-environment node
import { vi } from 'vitest';
import {
  collectMenu,
  collectArtifact,
  collectReadyArtifacts,
  ArtifactNotReadyError,
} from '@/export/collect-artifacts';
import { buildMdExport } from '@/export/md-export';
import { reviewResultToMarkdown } from '@/export/review-adapter';
import { ProjectAccessError } from '@/projects/projects-core';
import { createMockDb, seq } from '../test-utils/mock-db';

import { rmSync } from 'fs';
import { join } from 'path';

const SPEC_BODY = '## 01. Context\nbody one\n\n## 03. Technical design\nbody three';

/* Mock readSpecFile (sync) — collect-artifacts uses the sync variant for spec. */
const readSpecFileMock = vi.fn<(id: string) => import('@/projects/project-files').SpecFile | null>();
const readJournalFileMock = vi.fn<(id: string) => import('@/projects/project-files').JournalFile | null>();

vi.mock('@/projects/project-files', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/projects/project-files')>();
  return {
    ...orig,
    readSpecFile: (...args: [string]) => readSpecFileMock(...args),
    readJournalFile: (...args: [string]) => readJournalFileMock(...args),
  };
});

beforeEach(() => {
  readSpecFileMock.mockReset();
  readJournalFileMock.mockReset();
});

afterAll(() => {
  for (const id of ['proj-1', 'test-export-ready']) {
    rmSync(join(process.cwd(), '.forge-workspace', '.mma', 'projects', id), { recursive: true, force: true });
  }
});

describe('collect-artifacts — ready/pending (Key flow A)', () => {
  it('spec present, review absent ⇒ spec ready, review pending', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    readSpecFileMock.mockReturnValue({ version: 1, updatedAt: '', bodyMd: SPEC_BODY });
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
      ),
      'select:project_audit_pass': [],
      'select:project_artifact': [],  // plan query — no plan artifact
      'select:ops_mma_batch': [],
    });
    const menu = await collectMenu(projectId, { id: ownerId, teamId: 'team-1' }, { db });
    const byKind = Object.fromEntries(menu.map((m) => [m.kind, m]));
    expect(byKind.spec.ready).toBe(true);
    expect(byKind.spec.version).toBe(1);
    expect(byKind.journal.ready).toBe(false);
    expect(byKind.exploration.ready).toBe(false);
    expect(byKind.plan.ready).toBe(false);
  });

  it('journal file present ⇒ journal ready', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    readSpecFileMock.mockReturnValue(null);
    readJournalFileMock.mockReturnValue({ bodyMd: '# Journal', version: 1, updatedAt: '' });
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'learn' }],
        [{ ownerId, visibility: 'public', phase: 'learn' }],
      ),
      'select:project_audit_pass': [],
      'select:project_participant': [],
    });
    const menu = await collectMenu(projectId, { id: ownerId, teamId: 'team-1' }, { db });
    expect(menu.find((m) => m.kind === 'journal')!.ready).toBe(true);
  });
});

describe('collect-artifacts — locked·audited flag (F4)', () => {
  it('locked (build) phase + ≥1 clean spec audit ⇒ lockedAudited true', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    readSpecFileMock.mockReturnValue({ version: 1, updatedAt: '', bodyMd: SPEC_BODY });
    const d = buildInitialDetails();
    d.stages.spec.phases.finalize.auditPasses = [{ passNo: 1, status: 'clean' }];
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'build', details: d }],
        [{ ownerId, visibility: 'public', phase: 'build', details: d }],
      ),
    });
    const spec = (await collectMenu(projectId, { id: ownerId, teamId: 'team-1' }, { db })).find((m) => m.kind === 'spec')!;
    expect(spec.lockedAudited).toBe(true);
  });

  it('unlocked (design) project ⇒ lockedAudited false even with a clean audit', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    readSpecFileMock.mockReturnValue({ version: 1, updatedAt: '', bodyMd: SPEC_BODY });
    const d = buildInitialDetails();
    d.stages.spec.phases.finalize.auditPasses = [{ passNo: 1, status: 'clean' }];
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design', details: d }],
        [{ ownerId, visibility: 'public', phase: 'design', details: d }],
      ),
    });
    const spec = (await collectMenu(projectId, { id: ownerId, teamId: 'team-1' }, { db })).find((m) => m.kind === 'spec')!;
    expect(spec.lockedAudited).toBe(false);
  });
});

describe('collect-artifacts — visibility (F-visibility)', () => {
  it('non-collaborator on a private project ⇒ ProjectAccessError', async () => {
    const projectId = 'proj-1';
    const ownerId = 'owner-1';
    const strangerId = 'stranger-1';
    readSpecFileMock.mockReturnValue(null);
    const db = createMockDb({
      'select:project': [{ id: projectId, visibility: 'private', ownerId }],
      'select:project_participant': [],
    });
    await expect(collectMenu(projectId, { id: strangerId, teamId: 'team-1' }, { db })).rejects.toBeInstanceOf(ProjectAccessError);
    readSpecFileMock.mockReturnValue(null);
    const db2 = createMockDb({
      'select:project': [{ id: projectId, visibility: 'private', ownerId }],
      'select:project_participant': [],
    });
    await expect(collectArtifact(projectId, 'spec', { id: strangerId, teamId: 'team-1' }, { db: db2 })).rejects.toBeInstanceOf(
      ProjectAccessError,
    );
  });
});

describe('collect-artifacts — cover meta + section headers (F1/F3)', () => {
  it('derives all five meta fields + the NN→{status,roles} map', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    readSpecFileMock.mockReturnValue({ version: 2, updatedAt: '', bodyMd: SPEC_BODY });
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [
      { id: 'c1', templateId: 'context', approvals: ['m1'] },
      { id: 'c2', templateId: 'problem', approvals: ['m1'] },
      { id: 'c3', templateId: 'technical_design', approvals: [] },
      { id: 'c4', templateId: 'stories_tasks', approvals: ['m1'] },
    ];
    d.stages.spec.phases.finalize.auditPasses = [
      { passNo: 1, status: 'clean' },
      { passNo: 2, status: 'clean' },
    ];
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'build', details: d }],
        [{ ownerId, visibility: 'public', phase: 'build', details: d }],
      ),
      'select:team_member': [{ displayName: 'Maya Adeyemi' }],
    });
    const collected = await collectArtifact(projectId, 'spec', { id: ownerId, teamId: 'team-1' }, { db });
    expect(collected.meta.owner).toBe('Maya Adeyemi');
    expect(collected.meta.visibility).toBe('Public');
    expect(collected.meta.componentsApproved).toBe(3);
    expect(collected.meta.auditClean).toBe(2);
    expect(collected.meta.version).toBe('v2 · locked');

    expect(collected.sectionHeaders['01']).toEqual({
      status: 'Approved',
      approved: true,
      roles: '',
    });
    expect(collected.sectionHeaders['03']).toEqual({
      status: 'Gathering',
      approved: false,
      roles: '',
    });
    expect(collected.sectionHeaders['04'].roles).toBe('');
  });

  it('an unlocked project omits the · locked suffix', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const specStageId = 'stage-1';
    readSpecFileMock.mockReturnValue({ version: 1, updatedAt: '', bodyMd: SPEC_BODY });
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
      ),
      'select:team_member': [{ displayName: 'Owner' }],
      'select:project_stage': [{ id: specStageId }],
      'select:project_component': [],
      'select:project_audit_pass': [],
      'select:ops_mma_batch': [],
    });
    const c = await collectArtifact(projectId, 'spec', { id: ownerId, teamId: 'team-1' }, { db });
    expect(c.meta.version).toBe('v1');
  });
});

describe('collect-artifacts — pending throws + ready collection order', () => {
  it('collectArtifact on a pending kind throws ArtifactNotReadyError', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    readSpecFileMock.mockReturnValue(null);
    const db = createMockDb({
      'select:project': [{ ownerId, visibility: 'public', phase: 'design' }],
      'select:project_artifact': [],
      'select:ops_mma_batch': [],
    });
    await expect(collectArtifact(projectId, 'plan', { id: ownerId, teamId: 'team-1' }, { db })).rejects.toBeInstanceOf(
      ArtifactNotReadyError,
    );
  });

  it('collectReadyArtifacts returns ready ones in exploration→spec→plan→journal order (F20)', async () => {
    const projectId = 'test-export-ready';
    const ownerId = 'member-1';
    const specStageId = 'stage-1';
    const { writeExplorationSummary } = await import('@/projects/project-files');
    await writeExplorationSummary(projectId, '## Background\n\nExploration content');
    readSpecFileMock.mockReturnValue(null);
    readJournalFileMock.mockReturnValue(null);
    const db = createMockDb({
      'select:project_participant': [{ memberId: ownerId }],
      'select:project': seq(
        ...(Array(10).fill([{ ownerId, visibility: 'public', phase: 'design' }]) as Array<Array<unknown>>),
      ),
      'select:team_member': [{ displayName: 'Owner' }],
      'select:project_stage': [{ id: specStageId }],
      'select:project_component': [],
      'select:project_audit_pass': [],
    });
    const ready = await collectReadyArtifacts(projectId, { id: ownerId, teamId: 'team-1' }, { db });
    expect(ready.map((a) => a.kind)).toEqual(['exploration']);
  });
});

describe('md-export + review adapter (F19/F25)', () => {
  it('md-export is byte-faithful for a stored body', () => {
    const md = buildMdExport('spec', SPEC_BODY);
    expect(md.fileName).toBe('specification.md');
    expect(md.body).toBe(SPEC_BODY);
    expect(md.buffer.toString('utf-8')).toBe(SPEC_BODY);
  });

  it('review adapter normalizes a structured result to markdown deterministically', () => {
    const result = {
      structuredReport: {
        findingsOutcome: 'changes_required',
        findings: [{ severity: 'high', title: 'Null deref', detail: 'Guard the call.' }],
      },
    };
    const md1 = reviewResultToMarkdown(result);
    const md2 = reviewResultToMarkdown(result);
    expect(md1).toBe(md2);
    expect(md1).toContain('# Review report');
    expect(md1).toContain('Null deref');
    expect(md1).toContain('high');
    expect(buildMdExport('journal', md1).body).toBe(md1);
  });

  it('review adapter prefers a ready-made markdown body', () => {
    const md = reviewResultToMarkdown({ report: '# Custom report\n\nbody' });
    expect(md.startsWith('# Custom report')).toBe(true);
  });

  it('collectArtifact(journal) returns journal file content', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    readSpecFileMock.mockReturnValue(null);
    readJournalFileMock.mockReturnValue({ bodyMd: '# Journal\n\nTeam learnings', version: 1, updatedAt: '' });
    const db = createMockDb({
      'select:project_participant': [{ memberId: ownerId }],
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'learn' }],
        [{ ownerId, visibility: 'public', phase: 'learn' }],
      ),
      'select:team_member': [{ displayName: 'Owner' }],
      'select:project_stage': [{ id: 'stage-1' }],
      'select:project_component': [],
      'select:project_audit_pass': [],
    });
    const c = await collectArtifact(projectId, 'journal', { id: ownerId, teamId: 'team-1' }, { db });
    expect(c.bodyMd).toContain('Journal');
  });
});
