'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserRound, LogOut } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * AccountMenu — the member's account control, as a popover (Profile · Sign out)
 * rather than a bare link: a compact avatar button in the app top bar.
 *
 * There used to be a second `rail` variant — a full-width card in the sidebar footer,
 * with the username and an admin chip — and it was the DEFAULT. Nothing rendered it: the
 * only call site passes `variant="bar"`, and the sidebar it belonged to had already
 * dropped its footer (keeping only a vestigial flex spacer where the card had been).
 *
 * Sign-out posts to `/api/auth/logout` then routes to `/login` — the same flow
 * the profile page uses.
 */
export function AccountMenu({ member }: { member: AuthedMember }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // A rejected logout POST (network drop) used to throw before router.push, leaving the menu
      // stuck on "Signing out…" forever. Route to /login regardless — a failed logout still lands
      // the user on the login screen, and the finally resets the flag.
    } finally {
      setSigningOut(false);
    }
    router.push('/login');
    router.refresh();
  }

  // Team settings lives in the sidebar nav (under ADMIN) — the account menu stays
  // personal: Profile + Sign out.
  const items = (
    <>
      <DropdownMenuItem onSelect={() => router.push('/profile')}>
        <UserRound />
        Profile
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void signOut()} disabled={signingOut}>
        <LogOut />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </DropdownMenuItem>
    </>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="focus-ring grid size-9 place-items-center rounded-full hover:bg-surface-2"
      >
        <Avatar name={member.displayName} tint={member.avatarTint} size="sm" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]">
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
