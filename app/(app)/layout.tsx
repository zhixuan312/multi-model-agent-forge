import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PhaseTheme } from '@/components/forge/PhaseTheme';
import { Sidebar } from '@/components/forge/Sidebar';
import { MobileNav } from '@/components/forge/MobileNav';
import { AppShell, ShellBody } from '@/components/ui/shell';

/**
 * Global shell (Spec 1 §Global shell). Auth-gated: `current-member.ts` performs
 * the authoritative DB-backed session validation (Node runtime); if no valid
 * session, redirect to `/login`.
 *
 * Dashboard frame (`AppShell`): the `Sidebar` rail and any page header are
 * permanently locked; ONLY the center scrolls. The scroll surface is
 * `overflow-x-hidden` + `min-w-0` so a wide child can't force a horizontal
 * scrollbar (the assertable proxy for the "no horizontal scroll" bar, F3).
 * Screens that need a locked header / second nav render `PageFrame` (Phase 2);
 * until migrated, content sits in a default padded `ShellBody`.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await currentMember();
  if (!member) redirect('/login');

  return (
    <PhaseTheme phase="design" className="text-ink">
      <AppShell
        sidebar={<Sidebar member={member} />}
        mobileBar={
          <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
            <MobileNav member={member} />
            <span className="font-serif text-base font-semibold">Forge</span>
          </div>
        }
      >
        <div data-testid="main-column" className="min-w-0 overflow-x-hidden">
          <ShellBody>{children}</ShellBody>
        </div>
      </AppShell>
    </PhaseTheme>
  );
}
