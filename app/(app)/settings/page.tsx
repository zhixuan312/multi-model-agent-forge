import { redirect } from 'next/navigation';
import { requireAdminPage } from '@/auth/require-admin';

/**
 * Team Settings (Spec 1 §Team Settings) — admin-gated. Members is the only
 * active tab, so `/settings` lands on it. `requireAdminPage` redirects a
 * non-admin (to `/`) or an unauthenticated caller (to `/login`) before the
 * redirect to Members.
 */
export default async function SettingsPage() {
  await requireAdminPage();
  redirect('/settings/members');
}
