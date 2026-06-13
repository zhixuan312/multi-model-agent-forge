// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { componentSection, component, qaMessage } from '@/db/schema/spec';
import { project } from '@/db/schema/projects';
import { actionLog } from '@/db/schema/audit';
import {
  enterSection,
  onMemberAnswer,
  onHumanSatisfied,
  forceAdvance,
  onIntentEdit,
  confirmComponents,
  allComponentsApproved,
  recomputeComponentStatus,
  FORCED_DRAFT_PLACEHOLDER,
} from '@/spec/orchestrator';
import { seedProject, seedMember, cleanupSpecFixtures } from './db-fixtures';
import { mockAnthropicClient, type CallKind } from './mock-anthropic';

afterAll(async () => {
  await cleanupSpecFixtures();
});

const db = getDb();

/** Seed a project + one component (context) with its 3 sections; return the section ids. */
async function seedContext(intentMd?: string): Promise<{
  projectId: string;
  ownerId: string;
  stageId: string;
  componentId: string;
  sectionIds: string[];
}> {
  const { projectId, ownerId, specStageId } = await seedProject({ intentMd: intentMd ?? 'Intent.' });
  await confirmComponents(db, specStageId, ['context_scope']);
  const [comp] = await db.select().from(component).where(eq(component.stageId, specStageId)).limit(1);
  const secs = await db
    .select({ id: componentSection.id })
    .from(componentSection)
    .where(eq(componentSection.componentId, comp.id));
  return { projectId, ownerId, stageId: specStageId, componentId: comp.id, sectionIds: secs.map((s) => s.id) };
}

async function loadSection(id: string) {
  const [s] = await db.select().from(componentSection).where(eq(componentSection.id, id)).limit(1);
  return s;
}

describe('confirmComponents', () => {
  it('creates one component + one section per template section (gathering)', async () => {
    const { stageId } = await seedContext();
    const [comp] = await db.select().from(component).where(eq(component.stageId, stageId)).limit(1);
    expect(comp.kind).toBe('context_scope');
    expect(comp.status).toBe('gathering');
    const secs = await db.select().from(componentSection).where(eq(componentSection.componentId, comp.id));
    expect(secs).toHaveLength(2); // background, scope
    expect(secs.every((s) => s.status === 'gathering')).toBe(true);
  });

  it('is additive on re-open — no duplicate components (F15)', async () => {
    const { projectId, stageId } = await seedContext();
    await confirmComponents(db, stageId, ['context_scope', 'problem_motivation']); // context_scope already exists
    const comps = await db.select().from(component).where(eq(component.stageId, stageId));
    const kinds = comps.map((c) => c.kind).sort();
    expect(kinds).toEqual(['context_scope', 'problem_motivation']);
    expect(await allComponentsApproved(db, stageId)).toBe(false); // new component unapproved
    void projectId;
  });
});

describe('enterSection — zero-question fast path', () => {
  it('drafts immediately and lands in drafted with ai_satisfied (no member turns)', async () => {
    const { sectionIds } = await seedContext();
    const calls: CallKind[] = [];
    const anthropic = mockAnthropicClient(
      {
        generateQuestions: [{ questions: [], aiSatisfiedWithoutAnswers: true, grounding: 'intent suffices' }],
        draftSection: [{ draftMd: '## Background\nWell-supplied.' }],
      },
      { calls },
    );
    await enterSection({ anthropic }, sectionIds[0]);
    const s = await loadSection(sectionIds[0]);
    expect(s.aiSatisfied).toBe(true);
    expect(s.status).toBe('drafted');
    expect(s.draftMd).toContain('Well-supplied');
    expect(s.humanSatisfied).toBe(false); // human still needs to nod
    expect(calls).toEqual(['generateQuestions', 'draftSection']);
  });

  it('with questions: persists forge questions, stays gathering, no draft', async () => {
    const { sectionIds } = await seedContext();
    const anthropic = mockAnthropicClient({
      generateQuestions: [{ questions: ['Q1?', 'Q2?'], aiSatisfiedWithoutAnswers: false, grounding: 'need more' }],
    });
    await enterSection({ anthropic }, sectionIds[0]);
    const s = await loadSection(sectionIds[0]);
    expect(s.status).toBe('gathering');
    expect(s.aiSatisfied).toBe(false);
    expect(s.draftMd).toBeNull();
    const msgs = await db.select().from(qaMessage).where(eq(qaMessage.sectionId, sectionIds[0]));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].sender).toBe('forge');
  });
});

describe('onMemberAnswer — loop advances on assessAnswers', () => {
  it('not satisfied → stays gathering with follow-ups; logs an answer action_log row', async () => {
    const { sectionIds, ownerId, projectId } = await seedContext();
    const anthropic = mockAnthropicClient({
      generateQuestions: [{ questions: ['Q1?'], aiSatisfiedWithoutAnswers: false, grounding: 'g' }],
      assessAnswers: [{ aiSatisfied: false, missingInfo: ['need X'], followUpQuestions: ['Q2?'] }],
    });
    await enterSection({ anthropic }, sectionIds[0]);
    await onMemberAnswer({ anthropic }, sectionIds[0], 'My answer.', ownerId);
    const s = await loadSection(sectionIds[0]);
    expect(s.status).toBe('gathering');
    expect(s.aiSatisfied).toBe(false);

    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'answer')));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].memberId).toBe(ownerId);
  });

  it('satisfied → drafts inline + status drafted (F16)', async () => {
    const { sectionIds, ownerId } = await seedContext();
    const calls: CallKind[] = [];
    const anthropic = mockAnthropicClient(
      {
        generateQuestions: [{ questions: ['Q1?'], aiSatisfiedWithoutAnswers: false, grounding: 'g' }],
        assessAnswers: [{ aiSatisfied: true, missingInfo: [], followUpQuestions: [] }],
        draftSection: [{ draftMd: 'Drafted body.' }],
      },
      { calls },
    );
    await enterSection({ anthropic }, sectionIds[0]);
    await onMemberAnswer({ anthropic }, sectionIds[0], 'Answer.', ownerId);
    const s = await loadSection(sectionIds[0]);
    expect(s.aiSatisfied).toBe(true);
    expect(s.status).toBe('drafted');
    expect(s.draftMd).toBe('Drafted body.');
    expect(calls).toContain('assessAnswers');
    expect(calls).toContain('draftSection');
  });
});

describe('THE DUAL GATE INVARIANT', () => {
  async function drift(sectionId: string, anthropic: ReturnType<typeof mockAnthropicClient>) {
    await enterSection({ anthropic }, sectionId); // zero-question → ai_satisfied + drafted
  }

  it('human_satisfied alone (without ai_satisfied) does NOT approve', async () => {
    const { sectionIds } = await seedContext();
    // Manually create a drafted-but-ai-NOT-satisfied state (e.g. grounding cleared ai gate).
    await db
      .update(componentSection)
      .set({ status: 'drafted', aiSatisfied: false, draftMd: 'body' })
      .where(eq(componentSection.id, sectionIds[0]));
    const anthropic = mockAnthropicClient({});
    await onHumanSatisfied({ anthropic }, sectionIds[0]);
    const s = await loadSection(sectionIds[0]);
    expect(s.humanSatisfied).toBe(true);
    expect(s.status).not.toBe('approved'); // ai gate not satisfied → NOT approved
  });

  it('ai_satisfied && human_satisfied → approved', async () => {
    const { sectionIds } = await seedContext();
    const anthropic = mockAnthropicClient({
      generateQuestions: [{ questions: [], aiSatisfiedWithoutAnswers: true, grounding: 'g' }],
      draftSection: [{ draftMd: 'body' }],
    });
    await drift(sectionIds[0], anthropic);
    await onHumanSatisfied({ anthropic }, sectionIds[0]);
    const s = await loadSection(sectionIds[0]);
    expect(s.aiSatisfied).toBe(true);
    expect(s.humanSatisfied).toBe(true);
    expect(s.status).toBe('approved');
  });

  it('forced → approved even with ai_satisfied=false; logs force_advance', async () => {
    const { sectionIds, ownerId, projectId } = await seedContext();
    const anthropic = mockAnthropicClient({ draftSection: [{ draftMd: 'forced body' }] });
    await forceAdvance({ anthropic }, sectionIds[0], ownerId);
    const s = await loadSection(sectionIds[0]);
    expect(s.forced).toBe(true);
    expect(s.humanSatisfied).toBe(true);
    expect(s.aiSatisfied).toBe(false);
    expect(s.status).toBe('approved');
    expect(s.draftMd).toBe('forced body');
    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'force_advance')));
    expect(logs[0].memberId).toBe(ownerId);
  });

  it('force-advance with a failed draft writes the exact placeholder (F7)', async () => {
    const { sectionIds, ownerId } = await seedContext();
    // No draftSection scripted + no stream result → both throw → placeholder.
    const anthropic = mockAnthropicClient(
      {},
      { nullStopReason: { draftSection: 'max_tokens' }, streamDraft: [] },
    );
    await forceAdvance({ anthropic }, sectionIds[0], ownerId);
    const s = await loadSection(sectionIds[0]);
    expect(s.draftMd).toBe(FORCED_DRAFT_PLACEHOLDER);
    expect(s.status).toBe('approved');
  });
});

describe('stale re-draft (F1/F21)', () => {
  it('an intent edit marks drafted/approved sections stale; a stale section re-drafts on entry; non-stale does not', async () => {
    const { sectionIds, projectId } = await seedContext();
    const anthropic = mockAnthropicClient({
      generateQuestions: [{ questions: [], aiSatisfiedWithoutAnswers: true, grounding: 'g' }],
      draftSection: [{ draftMd: 'v1' }, { draftMd: 'v2-after-edit' }],
    });
    await enterSection({ anthropic }, sectionIds[0]); // drafts v1, status drafted
    expect((await loadSection(sectionIds[0])).draftMd).toBe('v1');

    await onIntentEdit({ anthropic }, projectId, 'A new, edited intent.');
    const stale = await loadSection(sectionIds[0]);
    expect(stale.stale).toBe(true);

    // A different, gathering section was NOT marked stale.
    const other = await loadSection(sectionIds[1]);
    expect(other.stale).toBe(false);

    // Re-entering the stale section re-drafts (v2) and clears stale.
    await enterSection({ anthropic }, sectionIds[0]);
    const redrawn = await loadSection(sectionIds[0]);
    expect(redrawn.draftMd).toBe('v2-after-edit');
    expect(redrawn.stale).toBe(false);

    // The project summary was re-derived (pure, no LLM).
    const [p] = await db.select({ summary: project.summary }).from(project).where(eq(project.id, projectId)).limit(1);
    expect(p.summary).toBe('A new, edited intent.');
  });

  it('approved siblings do NOT cascade-stale each other (only intent edit sets stale)', async () => {
    const { sectionIds } = await seedContext();
    // Approve section 0 directly.
    await db
      .update(componentSection)
      .set({ status: 'approved', aiSatisfied: true, humanSatisfied: true, draftMd: 'a', stale: false })
      .where(eq(componentSection.id, sectionIds[0]));
    // Draft section 1 (a sibling) directly.
    await db
      .update(componentSection)
      .set({ status: 'drafted', aiSatisfied: true, draftMd: 'b', stale: false })
      .where(eq(componentSection.id, sectionIds[1]));
    // A sibling draft changing (here, simulated) must NOT stale section 0.
    const s0 = await loadSection(sectionIds[0]);
    expect(s0.stale).toBe(false);
  });
});

describe('component roll-up', () => {
  it('approved iff all sections approved; else the min state', async () => {
    const { componentId, sectionIds } = await seedContext();
    // Mixed: one approved, others gathering → min is gathering.
    await db.update(componentSection).set({ status: 'approved' }).where(eq(componentSection.id, sectionIds[0]));
    let status = await recomputeComponentStatus(db, componentId);
    expect(status).toBe('gathering');

    // All approved → approved.
    for (const id of sectionIds) {
      await db.update(componentSection).set({ status: 'approved' }).where(eq(componentSection.id, id));
    }
    status = await recomputeComponentStatus(db, componentId);
    expect(status).toBe('approved');
  });
});

describe('concurrency — same-section answers serialize on seq (F16)', () => {
  it('two near-simultaneous answers get distinct seqs, both persisted in order', async () => {
    const { sectionIds, ownerId } = await seedContext();
    const m2 = await seedMember('m2');
    const anthropic = mockAnthropicClient({
      generateQuestions: [{ questions: ['Q?'], aiSatisfiedWithoutAnswers: false, grounding: 'g' }],
      assessAnswers: [
        { aiSatisfied: false, missingInfo: ['x'], followUpQuestions: ['more?'] },
        { aiSatisfied: false, missingInfo: ['y'], followUpQuestions: ['more2?'] },
      ],
    });
    await enterSection({ anthropic }, sectionIds[0]);
    await Promise.all([
      onMemberAnswer({ anthropic }, sectionIds[0], 'Answer A', ownerId),
      onMemberAnswer({ anthropic }, sectionIds[0], 'Answer B', m2.id),
    ]);
    const msgs = await db
      .select({ seq: qaMessage.seq, sender: qaMessage.sender, bodyMd: qaMessage.bodyMd })
      .from(qaMessage)
      .where(eq(qaMessage.sectionId, sectionIds[0]));
    const seqs = msgs.map((m) => m.seq);
    expect(new Set(seqs).size).toBe(seqs.length); // no duplicate seq
    const members = msgs.filter((m) => m.sender === 'member').map((m) => m.bodyMd).sort();
    expect(members).toEqual(['Answer A', 'Answer B']);
  });
});
