'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/forge/Sidebar';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * Mobile drawer nav (<768). The persistent rail is hidden below md (the
 * `Sidebar` carries `max-md:hidden`); this exposes the same nav via a drawer
 * toggle so the rail is reachable without a persistent column (Spec 1 <768
 * acceptance bar, F3/F6). Desktop renders nothing visible from here.
 */
export function MobileNav({ member }: { member: AuthedMember }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        data-testid="drawer-toggle"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid h-9 w-9 place-items-center rounded-[var(--r)] border border-line bg-surface text-ink"
      >
        <span aria-hidden="true">☰</span>
      </button>

      {open ? (
        <div
          data-testid="drawer"
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="relative z-10 flex">
            <Sidebar member={member} forceVisible />
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="flex-1 bg-ink/30"
          />
        </div>
      ) : null}
    </div>
  );
}
