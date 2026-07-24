import { redirect } from 'next/navigation';
import { isFirstRun } from '@/auth/setup-core';
import { LoginForm } from './LoginForm';

// isFirstRun() hits the database at render, so this page must never be statically
// prerendered — the `next build` inside the Docker image has no DB and would fail on it.
export const dynamic = 'force-dynamic';

/**
 * Login screen. Before any admin exists there is nothing to log into, so a
 * fresh install bounces to the one-time `/setup` registration page; once a
 * member exists, the login form renders.
 */
export default async function LoginPage() {
  if (await isFirstRun()) redirect('/setup');
  return <LoginForm />;
}
