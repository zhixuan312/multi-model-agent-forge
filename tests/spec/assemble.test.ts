// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { component, componentSection } from '@/db/schema/spec';
import { artifact } from '@/db/schema/artifacts';
import { actionLog } from '@/db/schema/audit';
import { assembleSpec, getLatestSpec, buildSpecMarkdown } from '@/spec/assemble';
import { confirmComponents } from '@/spec/orchestrator';
import { seedProject, cleanupSpecFixtures } from './db-fixtures';

afterAll(async () => {
  await cleanupSpecFixtures();
});

const db = getDb();

describe('buildSpecMarkdown (pure)', () => {
  it('emits ## label / ### draftHeading and preserves a ```mermaid fence verbatim', () => {
    const fence = '```mermaid\ngraph TD; A-->B;\n```';
    const md = buildSpecMarkdown(
      { name: 'Proj', visibility: 'public', version: 1 },
      [
        {
          kind: 'proposed_design',
          label: 'Proposed design',
          sections: [{ key: 'system_context', label: 'System-context diagram', draftMd: fence }],
        },
      ],
    );
    expect(md).toContain('## Proposed design');
    expect(md).toContain('### System-context diagram');
    expect(md).toContain(fence); // fence preserved verbatim
  });
});

describe('assembleSpec', () => {
  it('produces one versioned spec artifact from approved sections + an assemble action_log row', async () => {
    const { projectId, ownerId, specStageId } = await seedProject();
    await confirmComponents(db, specStageId, ['context_scope']);
    const [comp] = await db.select().from(component).where(eq(component.stageId, specStageId)).limit(1);
    const secs = await db.select().from(componentSection).where(eq(componentSection.componentId, comp.id));
    for (const s of secs) {
      await db
        .update(componentSection)
        .set({ status: 'approved', aiSatisfied: true, humanSatisfied: true, draftMd: `body-${s.key}` })
        .where(eq(componentSection.id, s.id));
    }

    const res = await assembleSpec(db, projectId, specStageId, ownerId);
    expect(res.version).toBe(1);
    expect(res.bodyMd).toContain('## Context');
    expect(res.bodyMd).toContain('### Background');
    expect(res.bodyMd).toContain('body-background');

    const arts = await db
      .select()
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'spec')));
    expect(arts).toHaveLength(1);
    expect(arts[0].createdBy).toBeNull(); // agent-generated

    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'assemble')));
    expect(logs).toHaveLength(1);
  });

  it('re-assemble bumps version (prevMax+1)', async () => {
    const { projectId, ownerId, specStageId } = await seedProject();
    await assembleSpec(db, projectId, specStageId, ownerId);
    const second = await assembleSpec(db, projectId, specStageId, ownerId);
    expect(second.version).toBe(2);
    const latest = await getLatestSpec(db, projectId);
    expect(latest?.version).toBe(2);
  });
});
