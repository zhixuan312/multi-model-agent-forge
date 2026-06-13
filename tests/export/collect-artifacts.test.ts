// @vitest-environment node
import { afterAll, beforeAll } from 'vitest';
import {
  collectMenu,
  collectArtifact,
  collectReadyArtifacts,
  ArtifactNotReadyError,
} from '@/export/collect-artifacts';
import { buildMdExport } from '@/export/md-export';
import { reviewResultToMarkdown } from '@/export/review-adapter';
import { ProjectAccessError } from '@/projects/projects-core';
import {
  seedProject,
  seedArtifact,
  seedComponent,
  seedAuditPass,
  seedReviewBatch,
  seedMember,
  cleanupExportFixtures,
} from './db-fixtures';

const SPEC_BODY = '## 01. Context\nbody one\n\n## 03. Technical design\nbody three';

afterAll(async () => {
  await cleanupExportFixtures();
});

describe('collect-artifacts — ready/pending (Key flow A)', () => {
  it('spec present, review absent ⇒ spec ready, review pending', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedArtifact(projectId, 'spec', SPEC_BODY);
    const menu = await collectMenu(projectId, { id: ownerId });
    const byKind = Object.fromEntries(menu.map((m) => [m.kind, m]));
    expect(byKind.spec.ready).toBe(true);
    expect(byKind.spec.version).toBe(1);
    expect(byKind.review.ready).toBe(false);
    expect(byKind.exploration.ready).toBe(false);
    expect(byKind.plan.ready).toBe(false);
  });

  it('a DONE review batch ⇒ review ready', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedReviewBatch(projectId, { structuredReport: { findingsOutcome: 'clean', findings: [] } });
    const menu = await collectMenu(projectId, { id: ownerId });
    expect(menu.find((m) => m.kind === 'review')!.ready).toBe(true);
  });
});

describe('collect-artifacts — frozen·audited flag (F4)', () => {
  it('frozen phase + ≥1 clean spec audit ⇒ frozenAudited true', async () => {
    const { projectId, ownerId } = await seedProject({ phase: 'frozen' });
    await seedArtifact(projectId, 'spec', SPEC_BODY);
    await seedAuditPass(projectId, 'spec', 'clean', 1);
    const spec = (await collectMenu(projectId, { id: ownerId })).find((m) => m.kind === 'spec')!;
    expect(spec.frozenAudited).toBe(true);
  });

  it('unfrozen project ⇒ frozenAudited false even with a clean audit', async () => {
    const { projectId, ownerId } = await seedProject({ phase: 'design' });
    await seedArtifact(projectId, 'spec', SPEC_BODY);
    await seedAuditPass(projectId, 'spec', 'clean', 1);
    const spec = (await collectMenu(projectId, { id: ownerId })).find((m) => m.kind === 'spec')!;
    expect(spec.frozenAudited).toBe(false);
  });
});

describe('collect-artifacts — visibility (F-visibility)', () => {
  it('non-collaborator on a private project ⇒ ProjectAccessError', async () => {
    const { projectId } = await seedProject({ visibility: 'private' });
    const stranger = await seedMember('stranger');
    await expect(collectMenu(projectId, { id: stranger.id })).rejects.toBeInstanceOf(ProjectAccessError);
    await expect(collectArtifact(projectId, 'spec', { id: stranger.id })).rejects.toBeInstanceOf(
      ProjectAccessError,
    );
  });
});

describe('collect-artifacts — cover meta + section headers (F1/F3)', () => {
  it('derives all five meta fields + the NN→{status,roles} map', async () => {
    const { projectId, ownerId, specStageId } = await seedProject({
      phase: 'frozen',
      ownerDisplayName: 'Maya Adeyemi',
    });
    await seedArtifact(projectId, 'spec', SPEC_BODY, 2);
    // 3 approved + 1 gathering
    await seedComponent(specStageId, 'context_scope', 'approved', ['business', 'PM'], 0);
    await seedComponent(specStageId, 'problem_motivation', 'approved', ['PM'], 1);
    await seedComponent(specStageId, 'proposed_design', 'gathering', ['SWE'], 2);
    await seedComponent(specStageId, 'test_validation', 'approved', [], 3);
    // 2 clean + 1 revised
    await seedAuditPass(projectId, 'spec', 'clean', 1);
    await seedAuditPass(projectId, 'spec', 'revised', 2);
    await seedAuditPass(projectId, 'spec', 'clean', 3);

    const collected = await collectArtifact(projectId, 'spec', { id: ownerId });
    expect(collected.meta.owner).toBe('Maya Adeyemi');
    expect(collected.meta.visibility).toBe('Public');
    expect(collected.meta.componentsApproved).toBe(3);
    expect(collected.meta.auditClean).toBe(2);
    expect(collected.meta.version).toBe('v2 · frozen');

    // NN map: 01=context approved, 03=tech_design gathering (true status, not approved)
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
    // empty roles ⇒ empty string (no chip)
    expect(collected.sectionHeaders['04'].roles).toBe('');
  });

  it('an unfrozen project omits the · frozen suffix', async () => {
    const { projectId, ownerId } = await seedProject({ phase: 'design' });
    await seedArtifact(projectId, 'spec', SPEC_BODY, 1);
    const c = await collectArtifact(projectId, 'spec', { id: ownerId });
    expect(c.meta.version).toBe('v1');
  });
});

describe('collect-artifacts — pending throws + ready collection order', () => {
  it('collectArtifact on a pending kind throws ArtifactNotReadyError', async () => {
    const { projectId, ownerId } = await seedProject();
    await expect(collectArtifact(projectId, 'plan', { id: ownerId })).rejects.toBeInstanceOf(
      ArtifactNotReadyError,
    );
  });

  it('collectReadyArtifacts returns ready ones in exploration→spec→plan→review order (F20)', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedArtifact(projectId, 'plan', '## Plan\nx');
    await seedArtifact(projectId, 'exploration', '## Exploration\ny');
    const ready = await collectReadyArtifacts(projectId, { id: ownerId });
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
    expect(md1).toBe(md2); // deterministic
    expect(md1).toContain('# Review report');
    expect(md1).toContain('Null deref');
    expect(md1).toContain('high');
    // md-export over the adapter output round-trips byte-for-byte
    expect(buildMdExport('review', md1).body).toBe(md1);
  });

  it('review adapter prefers a ready-made markdown body', () => {
    const md = reviewResultToMarkdown({ report: '# Custom report\n\nbody' });
    expect(md.startsWith('# Custom report')).toBe(true);
  });

  it('collectArtifact(review) returns adapter markdown', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedReviewBatch(projectId, { structuredReport: { findingsOutcome: 'clean', findings: [] } });
    const c = await collectArtifact(projectId, 'review', { id: ownerId });
    expect(c.bodyMd).toContain('# Review report');
    expect(c.bodyMd).toContain('No findings reported.');
  });
});
