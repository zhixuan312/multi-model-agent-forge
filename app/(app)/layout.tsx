import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PhaseTheme } from '@/components/forge/PhaseTheme';
import { Sidebar } from '@/components/forge/Sidebar';
import { MobileNav } from '@/components/forge/MobileNav';

/**
 * Global shell (Spec 1 §Global shell). Auth-gated: `current-member.ts` performs
 * the authoritative DB-backed session validation (Node runtime); if no valid
 * session, redirect to `/login`. Wrapped in `PhaseTheme` — Spec 1 is the design
 * (warm) world only; later specs drive the phase from project state.
 *
 * Layout: persistent `Sidebar` rail (hidden <768, reachable via `MobileNav`
 * drawer) + a main column. The main column carries `overflow-x-hidden` and the
 * content grid track is `min-w-0` so a wide child cannot force a horizontal
 * scroll — the assertable proxy for the <768 "no horizontal scroll" bar (F3).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await currentMember();
  if (!member) redirect('/login');

  return (
    <PhaseTheme phase="design" className="min-h-screen bg-bg text-ink">
      <div className="flex min-h-screen">
        <Sidebar member={member} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2 md:hidden">
            <MobileNav member={member} />
            <span className="font-serif text-base font-semibold">Forge</span>
          </div>

          <main
            data-testid="main-column"
            className="flex-1 overflow-x-hidden px-6 py-6 md:px-8"
          >
            {children}
          </main>
        </div>
      </div>
    </PhaseTheme>
  );
}
