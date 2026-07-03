import { NextResponse, type NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { guardSpecWrite } from '@/spec/handler-guard';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { qaMessage } from '@/db/schema/spec';
import { validateDetails } from '@/details/schema';
import { projectEventBus } from '@/sse/event-bus';
import { buildRefinePrompt, getMessagesSinceLastForge } from '@/spec/refine-prompt';
import { getLatestSpec } from '@/spec/assemble';
import { readComponentSections } from '@/spec/spec-file-ops';
import { teamSpecTemplate } from '@/db/schema/team';
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

  // Load component from details
  const [projRow] = await db
    .select({ details: project.details })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!projRow?.details) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const d = validateDetails(projRow.details);
  const detailsComp = d.stages.spec.phases.craft.components.find((c) => c.id === componentId);
  if (!detailsComp) return NextResponse.json({ error: 'Component not found' }, { status: 404 });

  const [tpl] = await db.select().from(teamSpecTemplate).where(eq(teamSpecTemplate.id, detailsComp.templateId)).limit(1);
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  const sections = Array.isArray(tpl.sections) ? tpl.sections as Array<{ key: string; label: string }> : [];
  const sectionLabels = sections.map((s) => s.label);

  // Read all sections for this component from spec.md
  const fileSections = await readComponentSections(id, sectionLabels);
  const componentDraftMd = fileSections
    .map((s) => `${s.heading}\n\n${s.body}`)
    .join('\n\n');

  const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
  const rawMessages = await db
    .select({ authorId: qaMessage.authorId, bodyMd: qaMessage.bodyMd })
    .from(qaMessage)
    .where(eq(qaMessage.targetId, componentId))
    .orderBy(asc(qaMessage.seq));
  const allMessages = rawMessages.map((m) => ({
    sender: (m.authorId === FORGE_MEMBER_ID ? 'forge' : 'member') as 'forge' | 'member',
    bodyMd: m.bodyMd,
  }));

  // First call = forge has never responded for this component
  const isFirstCall = !allMessages.some((m) => m.sender === 'forge');
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

  projectEventBus.publish(id, { type: 'chat.typing', componentId, typing: true });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
