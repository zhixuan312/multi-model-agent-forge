import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import {
  AnthropicClient,
  AnthropicConfigError,
  AnthropicParseError,
} from '@/anthropic/client';

/**
 * Shared guard for every Spec-4 write handler (F20/F31): CSRF → auth → membership
 * (public OR project_member; else 403) → phase guard (post-lock writes 409).
 * Returns either an error `NextResponse` or the resolved `{ memberId }`.
 */
export interface GuardedActor {
  memberId: string;
}

export async function guardSpecWrite(
  req: NextRequest,
  projectId: string,
  opts: { requireUnfrozen?: boolean } = {},
): Promise<NextResponse | GuardedActor> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Membership predicate (public OR project_member). 403 on a write (the actor
  // already knows the project exists if they reached here).
  try {
    await assertProjectReadable(projectId, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    throw e;
  }

  if (opts.requireUnfrozen) {
    const [row] = await getDb()
      .select({ phase: project.phase })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    if (row.phase !== 'design') {
      return NextResponse.json({ error: 'Spec is locked — read-only.' }, { status: 409 });
    }
  }

  return { memberId: me.id };
}

/** Map an orchestrator/Anthropic error to the documented neutral surface (never the key). */
export function anthropicErrorResponse(err: unknown): NextResponse {
  if (err instanceof AnthropicConfigError) {
    return NextResponse.json({ error: err.message, retryable: false }, { status: 503 });
  }
  if (err instanceof AnthropicParseError) {
    if (err.stopReason === 'refusal') {
      return NextResponse.json(
        { error: 'The assistant declined — rephrase the section context.', retryable: true },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Couldn't structure the response — try again or Force advance.", retryable: true },
      { status: 502 },
    );
  }
  // SDK AuthenticationError (401) → not retried (re-keying is a Team-Settings action, F31).
  if (err && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 401) {
    return NextResponse.json(
      { error: 'The main-tier credentials were rejected — check Team Settings.', retryable: false },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { error: 'The request could not be completed — try again or Force advance.', retryable: true },
    { status: 502 },
  );
}

/** Construct the orchestrator's AnthropicClient (resolves the main-tier key). */
export async function buildAnthropic(): Promise<AnthropicClient> {
  return AnthropicClient.fromMainTier();
}
