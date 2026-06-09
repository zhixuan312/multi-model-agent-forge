// @vitest-environment node
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { stage, project } from '@/db/schema/projects';
import { componentSection, qaMessage, component } from '@/db/schema/spec';
import {
  ensureSpecStage,
  captureIntent,
  loadOutline,
  loadSectionMessages,
  buildSectionRepaint,
} from '@/spec/spec-core';
import { confirmComponents, onMemberAnswer, enterSection } from '@/spec/orchestrator';
import { seedProject, cleanupSpecFixtures } from './db-fixtures';
import { mockAnthropicClient } from './mock-anthropic';

afterAll(async () => {
  await cleanupSpecFixtures();
});

const db = getDb();

describe('ensureSpecStage — lazy stage lifecycle (F10)', () => {
  it('returns the active spec stage; a second call does not duplicate it', async () => {
    const { projectId } = await seedProject();
    const first = await ensureSpecStage(db, projectId);
    expect(first.status).toBe('active');
    const second = await ensureSpecStage(db, projectId);
    expect(second.id).toBe(first.id);
    const rows = await db
      .select()
      .from(stage)
      .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')));
    expect(rows).toHaveLength(1);
  });

  it('flips a pending spec stage to active', async () => {
    const { projectId } = await seedProject();
    await db
      .update(stage)
      .set({ status: 'pending', startedAt: null })
      .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')));
    const res = await ensureSpecStage(db, projectId);
    expect(res.status).toBe('active');
  });
});

describe('captureIntent', () => {
  it('writes intent_md + derives summary (pure)', async () => {
    const { projectId, ownerId } = await seedProject();
    await captureIntent(db, projectId, '  We   need a faster checkout flow.  ', ownerId);
    const [p] = await db
      .select({ intentMd: project.intentMd, summary: project.summary })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    expect(p.intentMd).toBe('  We   need a faster checkout flow.  ');
    expect(p.summary).toBe('We need a faster checkout flow.');
  });
});

describe('section + qa_message persistence (DB integration)', () => {
  it('an answer persists a member qa_message, and loadSectionMessages returns them in seq order', async () => {
    const { projectId, ownerId, specStageId } = await seedProject();
    await confirmComponents(db, specStageId, ['context']);
    const [comp] = await db.select().from(component).where(eq(component.stageId, specStageId)).limit(1);
    const [sec] = await db.select().from(componentSection).where(eq(componentSection.componentId, comp.id)).limit(1);

    const anthropic = mockAnthropicClient({
      generateQuestions: [{ questions: ['What is the goal?'], aiSatisfiedWithoutAnswers: false, grounding: 'g' }],
      assessAnswers: [{ aiSatisfied: false, missingInfo: ['x'], followUpQuestions: ['And the constraint?'] }],
    });
    await enterSection({ anthropic }, sec.id);
    await onMemberAnswer({ anthropic }, sec.id, 'Speed up checkout.', ownerId);

    const msgs = await loadSectionMessages(db, sec.id);
    expect(msgs.map((m) => m.sender)).toEqual(['forge', 'member', 'forge']);
    const memberMsg = msgs.find((m) => m.sender === 'member')!;
    expect(memberMsg.bodyMd).toBe('Speed up checkout.');

    // The persisted member row carries the author_id.
    const rows = await db.select().from(qaMessage).where(eq(qaMessage.sectionId, sec.id));
    const memberRow = rows.find((r) => r.sender === 'member')!;
    expect(memberRow.authorId).toBe(ownerId);

    // buildSectionRepaint reflects state + messages.
    const repaint = await buildSectionRepaint(db, sec.id);
    expect(repaint.qaMessages).toHaveLength(3);
    expect(repaint.section.status).toBe('gathering');
    void projectId;
  });
});

describe('loadOutline', () => {
  it('returns components with template labels + their ordered sections', async () => {
    const { specStageId } = await seedProject();
    await confirmComponents(db, specStageId, ['context', 'problem']);
    const outline = await loadOutline(db, specStageId);
    expect(outline.map((c) => c.kind)).toEqual(['context', 'problem']);
    expect(outline[0].label).toBe('Context');
    expect(outline[0].sections.map((s) => s.key)).toEqual(['background', 'current_state', 'why_now']);
  });
});
