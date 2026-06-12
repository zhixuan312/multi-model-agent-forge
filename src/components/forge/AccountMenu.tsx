'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserRound, Settings, LogOut, ChevronsUpDown } from 'lucide-react';
import {
  Avatar,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  TextSm,
  Mono,
} from '@/components/ui';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * AccountMenu — the member's account control, as a popover (Profile · Team
 * settings · Sign out) rather than a bare link. Two triggers share one menu:
 *
 *   variant="rail"  full-width footer card in the sidebar (opens upward)
 *   variant="bar"   compact avatar button for the mobile top bar
 *
 * Sign-out posts to `/api/auth/logout` then routes to `/login` — the same flow
 * the profile page uses. Team settings only appears for admins (UX parity with
 * the nav; the page itself is the security boundary).
 */
export function AccountMenu({
  member,
  variant = 'rail',
}: {
  member: AuthedMember;
  variant?: 'rail' | 'bar';
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const items = (
    <>
      <DropdownMenuItem onSelect={() => router.push('/profile')}>
        <UserRound />
        Profile
      </DropdownMenuItem>
      {member.isAdmin ? (
        <DropdownMenuItem onSelect={() => router.push('/settings')}>
          <Settings />
          Team settings
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void signOut()} disabled={signingOut}>
        <LogOut />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </DropdownMenuItem>
    </>
  );

  if (variant === 'bar') {
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="user-card"
        aria-label="Account menu"
        className="focus-ring flex w-full items-center gap-2.5 rounded-[var(--r-lg)] border border-line bg-surface p-2 text-left transition-colors duration-150 ease-[var(--ease-out)] hover:border-line-strong"
      >
        <Avatar name={member.displayName} tint={member.avatarTint} size="sm" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TextSm className="truncate font-semibold text-ink">{member.displayName}</TextSm>
            {member.isAdmin ? (
              <Badge data-testid="admin-chip" variant="accent" size="sm">
                Admin
              </Badge>
            ) : null}
          </div>
          <Mono className="block truncate !text-xs text-ink-faint">@{member.username}</Mono>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-ink-faint" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
