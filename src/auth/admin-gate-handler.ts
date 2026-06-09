import { NextResponse } from 'next/server';
import { requireAdminMember, NotAdminError, NotAuthenticatedError } from '@/auth/require-admin';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * Resolve the admin actor for an admin-gated API route, or the matching JSON
 * error response (`403`/`401`). Keeps the verb-handlers in `app/api/members/**`
 * free of repeated gate boilerplate. `require-admin.ts` is the authoritative
 * Node-runtime gate (the Edge middleware only checks cookie presence).
 */
export async function resolveAdminActor(): Promise<
  { ok: true; actor: AuthedMember } | { ok: false; response: NextResponse }
> {
  try {
    const actor = await requireAdminMember();
    return { ok: true, actor };
  } catch (e) {
    if (e instanceof NotAdminError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Admin privileges required.' }, { status: 403 }),
      };
    }
    if (e instanceof NotAuthenticatedError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      };
    }
    throw e;
  }
}
