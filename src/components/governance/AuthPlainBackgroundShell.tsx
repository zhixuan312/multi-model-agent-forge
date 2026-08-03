import type { ReactNode } from 'react';
import { Display, Micro } from '@/components/ui';
import { ForgeMark } from '@/components/forge/ForgeMark';

export function AuthPlainBackgroundShell({ children }: { children: ReactNode }) {
  return (
    <main className="app-bg flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-4 py-10 text-ink">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

/**
 * The masthead above an auth card — mark, product name, one line of purpose.
 *
 * Login and Setup are the entire auth surface and each spelled this out, differing only
 * in the two strings.
 */
export function AuthMasthead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <ForgeMark className="mb-3 scale-125" />
      <Display className="!text-4xl">{title}</Display>
      <Micro className="mt-1.5 block">{subtitle}</Micro>
    </div>
  );
}
