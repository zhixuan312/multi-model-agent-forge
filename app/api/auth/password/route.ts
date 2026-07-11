import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentSession } from '@/auth/current-member';
import { changeOwnPassword } from '@/auth/change-password-core';
import { sessionCookieOptions, SESSION_COOKIE_NAME } from '@/auth/cookie';
import { passwordSchema } from '@/auth/password';

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

/**
 * Change own password (Spec 1 §Change-password / F11). Verify current → set new
 * + bump password_changed_at (DB clock) → drop other sessions → re-issue the
 * caller's session and replace its cookie (stays logged in here).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const resolved = await currentSession();
  if (!resolved) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await changeOwnPassword({
    memberId: resolved.member.id,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
    currentSessionId: resolved.session.id,
  });

  switch (result.kind) {
    case 'invalid_new_password':
      return NextResponse.json({ error: 'New password is too short.' }, { status: 400 });
    case 'wrong_current_password':
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    case 'no_identity':
      return NextResponse.json({ error: 'No local identity for this member.' }, { status: 400 });
    case 'success': {
      const res = NextResponse.json({ ok: true });
      // re-issue: replace this device's cookie with the fresh session token
      res.cookies.set(SESSION_COOKIE_NAME, result.token, sessionCookieOptions());
      return res;
    }
  }
}
