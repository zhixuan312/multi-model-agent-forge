import { NextResponse, type NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { guardSpecWrite } from '@/spec/handler-guard';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { getDb } from '@/db/client';
import { projectEventBus } from '@/sse/event-bus';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { buildRefinePrompt, getMessagesSinceLastForge } from '@/spec/refine-prompt';
import { getLatestSpec } from '@/spec/assemble';
import { readSpecSection } from '@/spec/spec-file-ops';
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

  const sections = await db
    .select({ label: componentSection.label, draftMd: componentSection.draftMd })
    .from(componentSection)
    .where(eq(componentSection.componentId, componentId))
    .orderBy(asc(componentSection.orderIndex));
  const sectionLabel = sections[0]?.label ?? comp.kind;

  // Read section content from spec.md (source of truth), fall back to DB
  const fileSection = await readSpecSection(id, sectionLabel);
  const sectionDraftMd = fileSection?.body ?? sections.map((s) => s.draftMd ?? '').join('\n\n');

  const allMessages = await db
    .select({ sender: qaMessage.sender, bodyMd: qaMessage.bodyMd })
    .from(qaMessage)
    .where(eq(qaMessage.componentId, componentId))
    .orderBy(asc(qaMessage.seq));

  const isFirstCall = comp.mmaSessionId === null;
  const delta = getMessagesSinceLastForge(allMessages);

  // Build prompt
  let fullSpecMd: string | undefined;
  if (isFirstCall) {
    const spec = await getLatestSpec(db, id);
    fullSpecMd = spec?.bodyMd;
  }

  const { system, user } = buildRefinePrompt({
    sectionLabel,
    sectionDraftMd,
    messagesSinceLastForge: delta,
    isFirstCall,
    fullSpecMd,
  });

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
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
