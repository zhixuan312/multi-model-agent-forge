'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Field,
  Input,
  Button,
  Avatar,
  Label,
  TextSm,
  Micro,
} from '@/components/ui';
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

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      {/* ACCOUNT */}
      <Card>
        <form onSubmit={saveAccount} aria-label="Account">
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 py-5">
            <div className="flex items-center gap-4">
              <Avatar size="lg" initials={initials(displayName || member.displayName)} tint={tint} aria-hidden />
              <div className="flex flex-col gap-1.5">
                <Label as="span">Avatar colour</Label>
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
                        'focus-ring size-6 rounded-full transition-transform hover:scale-110',
                        t === tint && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Display name">
                {(p) => (
                  <Input
                    {...p}
                    name="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Username" hint="your login">
                {(p) => (
                  <Input
                    {...p}
                    name="username"
                    value={member.username}
                    readOnly
                    aria-readonly="true"
                    className="cursor-not-allowed bg-surface-2 font-mono text-ink-faint"
                  />
                )}
              </Field>
            </div>

            {accountError ? (
              <Micro role="alert" className="block text-rose">
                {accountError}
              </Micro>
            ) : null}
            {accountOk ? (
              <Micro role="status" className="block text-[var(--sage-deep)]">
                Profile saved.
              </Micro>
            ) : null}

            <div className="flex justify-end">
              <Button type="submit" loading={savingAccount}>
                {savingAccount ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      {/* PASSWORD */}
      <Card>
        <form onSubmit={savePassword} aria-label="Password">
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 py-5">
            <Field label="Current password">
              {(p) => (
                <Input
                  {...p}
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="New password">
                {(p) => (
                  <Input
                    {...p}
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Confirm new password">
                {(p) => (
                  <Input
                    {...p}
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                )}
              </Field>
            </div>

            {passwordError ? (
              <Micro role="alert" className="block text-rose">
                {passwordError}
              </Micro>
            ) : null}
            {passwordOk ? (
              <Micro role="status" className="block text-[var(--sage-deep)]">
                Password updated.
              </Micro>
            ) : null}

            <div className="flex justify-end">
              <Button type="submit" loading={savingPassword}>
                {savingPassword ? 'Updating…' : 'Update password'}
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      {/* SIGN OUT */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <TextSm className="font-semibold text-ink">Sign out</TextSm>
            <Micro>End your session on this device</Micro>
          </div>
          <Button variant="secondary" leftIcon={<LogOut />} onClick={signOut} loading={signingOut} className="text-rose hover:text-rose">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
