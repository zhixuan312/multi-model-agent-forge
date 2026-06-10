'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, ShieldCheck, KeyRound, Trash2 } from 'lucide-react';
import {
  Card,
  CardContent,
  Avatar,
  Badge,
  Button,
  Input,
  Label,
  Menu,
  MenuButton,
  MenuItems,
  MenuItem,
  Text,
  Micro,
  Mono,
} from '@/components/ui';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';

export interface MemberRowData {
  id: string;
  username: string;
  displayName: string;
  avatarTint: string;
  isAdmin: boolean;
  createdAt: string; // ISO
}

/**
 * One member card + its `⋯` action menu (Spec 1 §Members CRUD / members.html):
 * toggle admin · reset password · delete. Menu is keyboard-operable (Escape +
 * outside-click close, focusable items with `role="menuitem"`). Reset opens an
 * inline password prompt; delete confirms inline. All actions hit the admin API
 * and refresh the RSC list on success.
 */
export function MemberRow({ member }: { member: MemberRowData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'reset' | 'delete'>('idle');
  const [newPassword, setNewPassword] = useState('');

  async function call(input: RequestInfo, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(input, init);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Action failed.');
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin() {
    await call(`/api/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isAdmin: !member.isAdmin }),
    });
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    const ok = await call(`/api/members/${member.id}/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    if (ok) {
      setMode('idle');
      setNewPassword('');
    }
  }

  async function confirmDelete() {
    const ok = await call(`/api/members/${member.id}`, { method: 'DELETE' });
    if (ok) setMode('idle');
  }

  return (
    <Card data-testid="member-row" elevation="flat">
      <CardContent className="py-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={member.displayName} tint={member.avatarTint} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Text className="truncate !t-sm font-semibold text-ink">{member.displayName}</Text>
              {member.isAdmin ? (
                <Badge data-testid="admin-badge" variant="accent" size="sm">
                  Admin
                </Badge>
              ) : null}
            </div>
            <Mono className="truncate !text-xs text-ink-faint">@{member.username}</Mono>
            <Micro className="mt-0.5 block">Joined {new Date(member.createdAt).toLocaleDateString()}</Micro>
          </div>

          <Menu>
            <MenuButton
              aria-label={`Actions for ${member.displayName}`}
              className="size-8 items-center justify-center rounded-[var(--r-sm)] text-ink-faint hover:bg-surface-2 hover:text-ink [&_svg]:size-4"
            >
              <MoreHorizontal aria-hidden />
            </MenuButton>
            <MenuItems align="end">
              <MenuItem icon={<ShieldCheck />} onSelect={toggleAdmin}>
                {member.isAdmin ? 'Revoke admin' : 'Make admin'}
              </MenuItem>
              <MenuItem
                icon={<KeyRound />}
                onSelect={() => {
                  setMode('reset');
                  setError(null);
                }}
              >
                Reset password
              </MenuItem>
              <MenuItem
                icon={<Trash2 />}
                danger
                onSelect={() => {
                  setMode('delete');
                  setError(null);
                }}
              >
                Delete
              </MenuItem>
            </MenuItems>
          </Menu>
        </div>

        {mode === 'reset' ? (
          <form onSubmit={submitReset} aria-label="Reset password" className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            <Label htmlFor={`reset-${member.id}`}>New password for @{member.username}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`reset-${member.id}`}
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="font-mono"
              />
              <Button type="submit" size="sm" loading={busy} className="shrink-0">
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => {
                  setMode('idle');
                  setNewPassword('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {mode === 'delete' ? (
          <div className="mt-3 border-t border-line pt-3">
            <Text className="!t-sm">
              Delete <strong className="text-ink">{member.displayName}</strong>? This cannot be undone.
            </Text>
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" variant="danger" size="sm" loading={busy} onClick={confirmDelete}>
                Delete member
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMode('idle');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <Micro role="alert" className="mt-2 block text-rose">
            {error}
          </Micro>
        ) : null}
      </CardContent>
    </Card>
  );
}
