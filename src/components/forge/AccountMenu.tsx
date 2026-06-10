'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserRound, Settings, LogOut, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Avatar,
  Badge,
  Menu,
  MenuButton,
  MenuItems,
  MenuItem,
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
    <MenuItems
      align="start"
      // Rail trigger sits at the bottom of the viewport-tall sidebar, so the
      // panel opens UPWARD; the mobile bar trigger opens downward (default).
      className={cn(
        'min-w-[13rem]',
        variant === 'rail' && 'bottom-full top-auto mb-1.5 mt-0 w-full',
        variant === 'bar' && '!right-0 left-auto',
      )}
    >
      <MenuItem icon={<UserRound />} onSelect={() => router.push('/profile')}>
        Profile
      </MenuItem>
      {member.isAdmin ? (
        <MenuItem icon={<Settings />} onSelect={() => router.push('/settings')}>
          Team settings
        </MenuItem>
      ) : null}
      <div className="my-1 h-px bg-line" role="separator" />
      <MenuItem icon={<LogOut />} onSelect={signOut} disabled={signingOut}>
        {signingOut ? 'Signing out…' : 'Sign out'}
      </MenuItem>
    </MenuItems>
  );

  if (variant === 'bar') {
    return (
      <Menu>
        <MenuButton
          aria-label="Account menu"
          className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
        >
          <Avatar name={member.displayName} tint={member.avatarTint} size="sm" aria-hidden />
        </MenuButton>
        {items}
      </Menu>
    );
  }

  return (
    <Menu className="block">
      <MenuButton
        data-testid="user-card"
        aria-label="Account menu"
        className="w-full items-center gap-2.5 rounded-[var(--r-lg)] border border-line bg-surface p-2 text-left transition-colors duration-150 ease-[var(--ease-out)] hover:border-line-strong"
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
      </MenuButton>
      {items}
    </Menu>
  );
}
