import type { ReactNode } from 'react';

export function AuthPlainBackgroundShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto bg-bg px-4 py-10 text-ink">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
