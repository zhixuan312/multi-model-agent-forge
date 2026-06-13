import { redirect } from 'next/navigation';
import { isFirstRun } from '@/auth/setup-core';
import { LoginForm } from './LoginForm';

/**
 * Login screen. Before any admin exists there is nothing to log into, so a
 * fresh install bounces to the one-time `/setup` registration page; once a
 * member exists, the login form renders.
 */
export default async function LoginPage() {
  if (await isFirstRun()) redirect('/setup');
  return <LoginForm />;
}
