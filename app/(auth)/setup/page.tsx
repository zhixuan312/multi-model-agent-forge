import { redirect } from 'next/navigation';
import { isFirstRun } from '@/auth/setup-core';
import { SetupForm } from './SetupForm';

// isFirstRun() hits the database at render, so this page must never be statically
// prerendered — the `next build` inside the Docker image has no DB and would fail on it.
export const dynamic = 'force-dynamic';

/**
 * One-time first-run setup screen. Reachable while logged out, but only usable
 * when the team has zero members — once an admin exists the gate is closed and
 * any visit redirects to `/login`.
 */
export default async function SetupPage() {
  if (!(await isFirstRun())) redirect('/login');
  return <SetupForm />;
}
