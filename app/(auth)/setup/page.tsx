import { redirect } from 'next/navigation';
import { isFirstRun } from '@/auth/setup-core';
import { SetupForm } from './SetupForm';

/**
 * One-time first-run setup screen. Reachable while logged out, but only usable
 * when the team has zero members — once an admin exists the gate is closed and
 * any visit redirects to `/login`.
 */
export default async function SetupPage() {
  if (!(await isFirstRun())) redirect('/login');
  return <SetupForm />;
}
