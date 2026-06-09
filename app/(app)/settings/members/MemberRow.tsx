'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { initials } from '@/components/forge/avatar';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'reset' | 'delete'>('idle');
  const [newPassword, setNewPassword] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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
    setMenuOpen(false);
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
    <div
      ref={wrapRef}
      data-testid="member-row"
      className="relative rounded-[var(--r-lg)] border border-line bg-surface p-3.5"
    >
      <div className="flex items-center gap-3">
        <span
          style={{ background: member.avatarTint }}
          className="grid h-9 w-9 place-items-center rounded-full text-[13px] font-semibold text-white"
        >
          {initials(member.displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-ink">{member.displayName}</span>
            {member.isAdmin ? (
              <span
                data-testid="admin-badge"
                className="rounded-full bg-accent-tint px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-accent-deep"
              >
                Admin
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-xs text-ink-faint">@{member.username}</div>
          <div className="mt-0.5 text-[10px] text-ink-faint">
            Joined {new Date(member.createdAt).toLocaleDateString()}
          </div>
        </div>

        <button
          type="button"
          aria-label={`Actions for ${member.displayName}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="grid h-7 w-7 place-items-center rounded-[var(--r-sm)] text-ink-faint hover:bg-bg-sunk"
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>

      {menuOpen ? (
        <div
          role="menu"
          aria-label={`Actions for ${member.displayName}`}
          className="absolute right-3 top-12 z-20 w-44 overflow-hidden rounded-[var(--r)] border border-line bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={toggleAdmin}
            className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-bg-sunk"
          >
            {member.isAdmin ? 'Revoke admin' : 'Make admin'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setMode('reset');
              setError(null);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-bg-sunk"
          >
            Reset password
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setMode('delete');
              setError(null);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-rose hover:bg-rose-tint"
          >
            Delete
          </button>
        </div>
      ) : null}

      {mode === 'reset' ? (
        <form onSubmit={submitReset} aria-label="Reset password" className="mt-3 border-t border-line pt-3">
          <label htmlFor={`reset-${member.id}`} className="mb-1.5 block text-[11.5px] font-semibold text-ink-soft">
            New password for @{member.username}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`reset-${member.id}`}
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-[var(--r)] border border-line-strong bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-[var(--r)] bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('idle');
                setNewPassword('');
                setError(null);
              }}
              className="shrink-0 text-sm text-ink-faint"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {mode === 'delete' ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-sm text-ink-soft">
            Delete <strong>{member.displayName}</strong>? This cannot be undone.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={confirmDelete}
              className={cn(
                'rounded-[var(--r)] bg-rose px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60',
              )}
            >
              Delete member
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('idle');
                setError(null);
              }}
              className="text-sm text-ink-faint"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-rose">
          {error}
        </p>
      ) : null}
    </div>
  );
}
