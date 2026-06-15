// @vitest-environment node
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

const SPEC_BODY = '## 01. Context\nbody one\n\n## 03. Technical design\nbody three';

describe('collect-artifacts — ready/pending (Key flow A)', () => {
  it('spec present, review absent ⇒ spec ready, review pending', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
      ),
      'select:audit_pass': [],
      'select:artifact': seq([], [{ id: 'art-1', bodyMd: SPEC_BODY, version: 1 }], []),
      'select:mma_batch': [],
    });
    const menu = await collectMenu(projectId, { id: ownerId }, { db });
    const byKind = Object.fromEntries(menu.map((m) => [m.kind, m]));
    expect(byKind.spec.ready).toBe(true);
    expect(byKind.spec.version).toBe(1);
    expect(byKind.review.ready).toBe(false);
    expect(byKind.exploration.ready).toBe(false);
    expect(byKind.plan.ready).toBe(false);
  });

  it('a DONE review batch ⇒ review ready', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
      ),
      'select:audit_pass': [],
      'select:artifact': [],
      'select:mma_batch': [{ result: { structuredReport: { findingsOutcome: 'clean', findings: [] } } }],
    });
    const menu = await collectMenu(projectId, { id: ownerId }, { db });
    expect(menu.find((m) => m.kind === 'review')!.ready).toBe(true);
  });
});

describe('collect-artifacts — frozen·audited flag (F4)', () => {
  it('frozen phase + ≥1 clean spec audit ⇒ frozenAudited true', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'frozen' }],
        [{ ownerId, visibility: 'public', phase: 'frozen' }],
      ),
      'select:audit_pass': [{ id: 'audit-1' }],
      'select:artifact': seq([], [{ id: 'art-1', bodyMd: SPEC_BODY, version: 1 }], []),
      'select:mma_batch': [],
    });
    const spec = (await collectMenu(projectId, { id: ownerId }, { db })).find((m) => m.kind === 'spec')!;
    expect(spec.frozenAudited).toBe(true);
  });

  it('unfrozen project ⇒ frozenAudited false even with a clean audit', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
      ),
      'select:audit_pass': [{ id: 'audit-1' }],
      'select:artifact': seq([], [{ id: 'art-1', bodyMd: SPEC_BODY, version: 1 }], []),
      'select:mma_batch': [],
    });
    const spec = (await collectMenu(projectId, { id: ownerId }, { db })).find((m) => m.kind === 'spec')!;
    expect(spec.frozenAudited).toBe(false);
  });
});

describe('collect-artifacts — visibility (F-visibility)', () => {
  it('non-collaborator on a private project ⇒ ProjectAccessError', async () => {
    const projectId = 'proj-1';
    const ownerId = 'owner-1';
    const strangerId = 'stranger-1';
    const db = createMockDb({
      'select:project': [{ id: projectId, visibility: 'private', ownerId }],
      'select:project_member': [],
    });
    await expect(collectMenu(projectId, { id: strangerId }, { db })).rejects.toBeInstanceOf(ProjectAccessError);
    const db2 = createMockDb({
      'select:project': [{ id: projectId, visibility: 'private', ownerId }],
      'select:project_member': [],
    });
    await expect(collectArtifact(projectId, 'spec', { id: strangerId }, { db: db2 })).rejects.toBeInstanceOf(
      ProjectAccessError,
    );
  });
});

describe('collect-artifacts — cover meta + section headers (F1/F3)', () => {
  it('derives all five meta fields + the NN→{status,roles} map', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const specStageId = 'stage-1';
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'frozen' }],
        [{ ownerId, visibility: 'public', phase: 'frozen' }],
      ),
      'select:iam_member': [{ displayName: 'Maya Adeyemi' }],
      'select:stage': [{ id: specStageId }],
      'select:component': [
        { status: 'approved', roles: ['business', 'PM'], orderIndex: 0 },
        { status: 'approved', roles: ['PM'], orderIndex: 1 },
        { status: 'gathering', roles: ['SWE'], orderIndex: 2 },
        { status: 'approved', roles: [], orderIndex: 3 },
      ],
      'select:audit_pass': [{ id: 'audit-1' }, { id: 'audit-2' }],
      'select:artifact': [{ id: 'art-1', bodyMd: SPEC_BODY, version: 2 }],
      'select:mma_batch': [],
    });
    const collected = await collectArtifact(projectId, 'spec', { id: ownerId }, { db });
    expect(collected.meta.owner).toBe('Maya Adeyemi');
    expect(collected.meta.visibility).toBe('Public');
    expect(collected.meta.componentsApproved).toBe(3);
    expect(collected.meta.auditClean).toBe(2);
    expect(collected.meta.version).toBe('v2 · frozen');

    expect(collected.sectionHeaders['01']).toEqual({
      status: 'Approved',
      approved: true,
      roles: 'business · PM',
    });
    expect(collected.sectionHeaders['03']).toEqual({
      status: 'Gathering',
      approved: false,
      roles: 'SWE',
    });
    expect(collected.sectionHeaders['04'].roles).toBe('');
  });

  it('an unfrozen project omits the · frozen suffix', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const specStageId = 'stage-1';
    const db = createMockDb({
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
      ),
      'select:iam_member': [{ displayName: 'Owner' }],
      'select:stage': [{ id: specStageId }],
      'select:component': [],
      'select:audit_pass': [],
      'select:artifact': [{ id: 'art-1', bodyMd: SPEC_BODY, version: 1 }],
      'select:mma_batch': [],
    });
    const c = await collectArtifact(projectId, 'spec', { id: ownerId }, { db });
    expect(c.meta.version).toBe('v1');
  });
});

describe('collect-artifacts — pending throws + ready collection order', () => {
  it('collectArtifact on a pending kind throws ArtifactNotReadyError', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const db = createMockDb({
      'select:project': [{ ownerId, visibility: 'public', phase: 'design' }],
      'select:artifact': [],
      'select:mma_batch': [],
    });
    await expect(collectArtifact(projectId, 'plan', { id: ownerId }, { db })).rejects.toBeInstanceOf(
      ArtifactNotReadyError,
    );
  });

  it('collectReadyArtifacts returns ready ones in exploration→spec→plan→review order (F20)', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const specStageId = 'stage-1';
    const db = createMockDb({
      'select:project_member': [{ memberId: ownerId }],
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
      ),
      'select:iam_member': [{ displayName: 'Owner' }],
      'select:stage': [{ id: specStageId }],
      'select:component': [],
      'select:audit_pass': [],
      'select:artifact': seq(
        [{ id: 'exp-1', bodyMd: '## Exploration\ny', version: 1 }],
        [],
        [{ id: 'plan-1', bodyMd: '## Plan\nx', version: 1 }],
      ),
      'select:mma_batch': [],
    });
    const ready = await collectReadyArtifacts(projectId, { id: ownerId }, { db });
    expect(ready.map((a) => a.kind)).toEqual(['exploration', 'plan']);
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
    expect(buildMdExport('review', md1).body).toBe(md1);
  });

  it('review adapter prefers a ready-made markdown body', () => {
    const md = reviewResultToMarkdown({ report: '# Custom report\n\nbody' });
    expect(md.startsWith('# Custom report')).toBe(true);
  });

  it('collectArtifact(review) returns adapter markdown', async () => {
    const projectId = 'proj-1';
    const ownerId = 'member-1';
    const specStageId = 'stage-1';
    const db = createMockDb({
      'select:project_member': [{ memberId: ownerId }],
      'select:project': seq(
        [{ ownerId, visibility: 'public', phase: 'design' }],
        [{ ownerId, visibility: 'public', phase: 'design' }],
      ),
      'select:iam_member': [{ displayName: 'Owner' }],
      'select:stage': [{ id: specStageId }],
      'select:component': [],
      'select:audit_pass': [],
      'select:mma_batch': [{ result: { structuredReport: { findingsOutcome: 'clean', findings: [] } } }],
    });
    const c = await collectArtifact(projectId, 'review', { id: ownerId }, { db });
    expect(c.bodyMd).toContain('# Review report');
    expect(c.bodyMd).toContain('No findings reported.');
  });
});
