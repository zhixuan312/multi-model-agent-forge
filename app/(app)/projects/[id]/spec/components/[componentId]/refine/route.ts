import { NextResponse, type NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { guardSpecWrite } from '@/spec/handler-guard';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { getDb } from '@/db/client';
import { projectEventBus } from '@/sse/event-bus';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { buildRefinePrompt, getMessagesSinceLastForge } from '@/spec/refine-prompt';
import { getLatestSpec } from '@/spec/assemble';
import { readComponentSections } from '@/spec/spec-file-ops';
import { templateForKind } from '@/spec/components';
import type { ComponentKind } from '@/db/enums';
import '@/dispatch/handler-registry';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  const existing = await findInflight(db, id, 'spec-refine');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  // Load component + section draft + messages
  const [comp] = await db
    .select({ mmaSessionId: component.mmaSessionId, kind: component.kind })
    .from(component)
    .where(eq(component.id, componentId))
    .limit(1);
  if (!comp) return NextResponse.json({ error: 'Component not found' }, { status: 404 });

  const tpl = templateForKind(comp.kind as ComponentKind);
  const sections = await db
    .select({ label: componentSection.label })
    .from(componentSection)
    .where(eq(componentSection.componentId, componentId))
    .orderBy(asc(componentSection.orderIndex));
  const sectionLabels = sections.map((s) => s.label);

  // Read all sections for this component from spec.md
  const fileSections = await readComponentSections(id, sectionLabels);
  const componentDraftMd = fileSections
    .map((s) => `${s.heading}\n\n${s.body}`)
    .join('\n\n');

  const allMessages = await db
    .select({ sender: qaMessage.sender, bodyMd: qaMessage.bodyMd })
    .from(qaMessage)
    .where(eq(qaMessage.componentId, componentId))
    .orderBy(asc(qaMessage.seq));

  const isFirstCall = comp.mmaSessionId === null;
  const delta = getMessagesSinceLastForge(allMessages);

  let fullSpecMd: string | undefined;
  if (isFirstCall) {
    const spec = await getLatestSpec(db, id);
    fullSpecMd = spec?.bodyMd;
  }

  const { system, user } = buildRefinePrompt({
    componentLabel: tpl.label,
    sectionHeadings: sectionLabels,
    componentDraftMd,
    messagesSinceLastForge: delta,
    isFirstCall,
    fullSpecMd,
  });

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'spec-refine',
    cwd: resolveWorkspaceRoot(),
    body: {
      prompt: `${system}\n\n${user}`,
      reviewPolicy: 'none',
    },
    actorId: guard.memberId,
    meta: { componentId },
  });

  if (isFirstCall) {
    await db
      .update(component)
      .set({ mmaSessionId: batchRowId })
      .where(eq(component.id, componentId));
  }

  projectEventBus.publish(id, { type: 'chat.typing', componentId, typing: true });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
