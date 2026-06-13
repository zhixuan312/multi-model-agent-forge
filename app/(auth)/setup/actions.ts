'use server';

import { redirect } from 'next/navigation';
import { parseSetupForm, registerFirstAdmin } from '@/auth/setup-core';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';

export interface SetupActionState {
  error?: string;
}

const INVALID_MESSAGE = `Check your entries — password must be at least ${PASSWORD_MIN_LENGTH} characters.`;

/**
 * First-run setup server action: validate the submission → create the first
 * admin → redirect to `/login` to sign in. Gated by `registerFirstAdmin`
 * (zero-member count); if an admin already exists the gate is closed and we
 * bounce to `/login` rather than create a second admin. No auto-login.
 */
export async function setupAction(
  _prev: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const parsed = parseSetupForm({
    displayName: formData.get('displayName'),
    username: formData.get('username'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.ok) {
    return { error: parsed.error === 'passwords_mismatch' ? 'Passwords do not match.' : INVALID_MESSAGE };
  }

  const result = await registerFirstAdmin(parsed.data);
  if (result.kind === 'invalid') {
    return { error: INVALID_MESSAGE };
  }

  // 'created' or 'already_setup' → setup is done; sign in on /login.
  redirect('/login');
}
