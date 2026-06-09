'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { initials } from '@/components/forge/avatar';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';
import type { AuthedMember } from '@/auth/auth-provider';

/** Avatar tint palette (warm-world accents from forge.css / profile.html). */
const TINTS = ['#6A6F8C', '#5E7C6B', '#9A6A8C', '#C4521E', '#355A74', '#8A7A5E'];

/**
 * Profile client form (Spec 1 §Profile / profile.html). Three cards:
 *  - Account: avatar tint + display name (username read-only — the login key, F23)
 *  - Password: current + new + confirm (new ≥ PASSWORD_MIN_LENGTH)
 *  - Sign out
 * Account/password submit to route handlers; sign-out POSTs to logout.
 */
export function ProfileForm({ member }: { member: AuthedMember }) {
  const router = useRouter();

  // ---- account ----
  const [displayName, setDisplayName] = useState(member.displayName);
  const [tint, setTint] = useState(member.avatarTint);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountOk, setAccountOk] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    setAccountError(null);
    setAccountOk(false);
    if (displayName.trim().length === 0) {
      setAccountError('Display name is required.');
      return;
    }
    setSavingAccount(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim(), avatarTint: tint }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setAccountError(body?.error ?? 'Could not save your profile.');
        return;
      }
      setAccountOk(true);
      router.refresh();
    } finally {
      setSavingAccount(false);
    }
  }

  // ---- password ----
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordOk, setPasswordOk] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordOk(false);
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(`New password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setPasswordError(body?.error ?? 'Could not update your password.');
        return;
      }
      setPasswordOk(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setSavingPassword(false);
    }
  }

  // ---- sign out ----
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const card = 'rounded-[var(--r-lg)] border border-line bg-surface p-5';
  const label = 'mb-1.5 block text-[11.5px] font-semibold text-ink-soft';
  const input =
    'w-full rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  const primaryBtn =
    'rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60';

  return (
    <div className="max-w-[640px]">
      {/* ACCOUNT */}
      <form onSubmit={saveAccount} className={cn(card, 'mb-4')} aria-label="Account">
        <h2 className="mb-4 text-sm font-semibold text-ink">Account</h2>

        <div className="mb-4 flex items-center gap-4">
          <span
            style={{ background: tint }}
            className="grid h-16 w-16 place-items-center rounded-full text-2xl font-semibold text-white"
          >
            {initials(displayName || member.displayName)}
          </span>
          <div>
            <span className={label}>Avatar colour</span>
            <div role="radiogroup" aria-label="Avatar colour" className="flex gap-2">
              {TINTS.map((t) => (
                <button
                  type="button"
                  key={t}
                  role="radio"
                  aria-checked={t === tint}
                  aria-label={`Avatar colour ${t}`}
                  onClick={() => setTint(t)}
                  style={{ background: t }}
                  className={cn(
                    'h-6 w-6 rounded-full',
                    t === tint && 'ring-2 ring-offset-2 ring-offset-surface',
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="displayName" className={label}>
              Display name
            </label>
            <input
              id="displayName"
              name="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={input}
            />
          </div>
          <div>
            <label htmlFor="username" className={label}>
              Username <span className="font-normal text-ink-faint">· your login</span>
            </label>
            <input
              id="username"
              name="username"
              value={member.username}
              readOnly
              aria-readonly="true"
              className={cn(input, 'cursor-not-allowed bg-surface-2 font-mono text-ink-faint')}
            />
          </div>
        </div>

        {accountError ? (
          <p role="alert" className="mt-3 text-sm text-rose">
            {accountError}
          </p>
        ) : null}
        {accountOk ? (
          <p role="status" className="mt-3 text-sm text-sage">
            Profile saved.
          </p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={savingAccount} className={primaryBtn}>
            {savingAccount ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {/* PASSWORD */}
      <form onSubmit={savePassword} className={cn(card, 'mb-4')} aria-label="Password">
        <h2 className="mb-4 text-sm font-semibold text-ink">Password</h2>
        <div className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="currentPassword" className={label}>
              Current password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={input}
            />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="newPassword" className={label}>
                New password
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={input}
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className={label}>
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={input}
              />
            </div>
          </div>
        </div>

        {passwordError ? (
          <p role="alert" className="mt-3 text-sm text-rose">
            {passwordError}
          </p>
        ) : null}
        {passwordOk ? (
          <p role="status" className="mt-3 text-sm text-sage">
            Password updated.
          </p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={savingPassword} className={primaryBtn}>
            {savingPassword ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>

      {/* SIGN OUT */}
      <div className={cn(card, 'flex items-center justify-between')}>
        <div>
          <div className="text-sm font-semibold text-ink">Sign out</div>
          <div className="text-xs text-ink-faint">End your session on this device</div>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="rounded-[var(--r)] border border-rose/40 bg-surface px-3.5 py-2 text-sm font-semibold text-rose disabled:opacity-60"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
