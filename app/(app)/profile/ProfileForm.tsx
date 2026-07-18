'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, ShieldCheck } from 'lucide-react';
import {
  Card,
  CardContent,
  Field,
  FieldGrid,
  Input,
  Button,
  TextStrong,
  Text,
  AvatarPicker,
  Avatar,
} from '@/components/ui';
import { FormPanel } from '@/components/patterns';
import { showToast } from '@/components/ui/toast';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import type { MetricCardProps } from '@/components/ui/metric-card';
import { initials } from '@/components/forge/avatar';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';
import type { AuthedMember } from '@/auth/auth-provider';


const PROFILE_NOTE = `### Your account

- **Username** — your login key; it can't be changed
- **Display name & avatar** — yours to edit anytime

### Security

- **Password** — changing it signs out all other sessions
- **Sessions** — each browser/device gets its own; they expire after idle time`;

/**
 * Profile client surface (Spec 1 §Profile). The Team-Settings shell: a 2/3 stack
 * of isolated cards — **Account** (avatar tint + display name; username read-only)
 * and **Password** — each saving independently, then a 1/3 rail with the
 * equal-rights note and a **Sign out** card. Account/password submit to route
 * handlers; sign-out POSTs to logout.
 */
export function ProfileForm({ member, metrics }: { member: AuthedMember; metrics?: MetricCardProps[] }) {
  const router = useRouter();

  // ---- account ----
  const [displayName, setDisplayName] = useState(member.displayName);
  const [tint, setTint] = useState(member.avatarTint);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);

  async function saveAccount() {
    setAccountError(null);
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
      setAccountOpen(false);
      showToast({ type: 'success', message: 'Profile saved.' });
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
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function savePassword() {
    setPasswordError(null);
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
      setPasswordOpen(false);
      showToast({ type: 'success', message: 'Password updated — other devices have been signed out.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // Changing the password revokes every other session and re-issues this
      // one — refresh so the "Active sessions" metric reflects the drop.
      router.refresh();
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
    <StageShell
      metrics={metrics}
      align="start"
      note={<RailNote icon={<ShieldCheck />}>{PROFILE_NOTE}</RailNote>}
      navigator={
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 py-5">
              <TextStrong className="!text-sm !text-ink">Sign out</TextStrong>
              <Text className="!text-xs">End your session on this device.</Text>
              <Button
                variant="secondary"
                leftIcon={<LogOut />}
                onClick={signOut}
                loading={signingOut}
                className="w-full text-rose hover:text-rose"
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Button>
            </CardContent>
          </Card>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* ACCOUNT */}
        <FormPanel
          ariaLabel="Account"
          heading="Account"
          leading={<Avatar initials={initials(member.displayName)} tint={member.avatarTint} aria-hidden />}
          disclosure={{
            open: accountOpen,
            summary: `${member.displayName} · @${member.username}`,
            onEdit: () => {
              setAccountError(null);
              setDisplayName(member.displayName);
              setTint(member.avatarTint);
              setAccountOpen(true);
            },
          }}
          busy={savingAccount}
          error={accountError}
          onCancel={() => {
            setAccountOpen(false);
            setAccountError(null);
          }}
          onSubmit={saveAccount}
        >
          <AvatarPicker initials={initials(displayName || member.displayName)} value={tint} onChange={setTint} />

              <FieldGrid cols={2}>
                <Field label="Display name">
                  {(p) => (
                    <Input {...p} name="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
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
              </FieldGrid>

        </FormPanel>

        {/* PASSWORD */}
        <FormPanel
          ariaLabel="Password"
          heading="Password"
          disclosure={{
            // A password has no readable saved value, so the read view states the rule
            // instead — the one thing worth knowing before opening the form.
            open: passwordOpen,
            summary: `At least ${PASSWORD_MIN_LENGTH} characters — changing it signs out other devices`,
            onEdit: () => {
              setPasswordError(null);
              setPasswordOpen(true);
            },
          }}
          busy={savingPassword}
          saveLabel="Update password"
          savingLabel="Updating…"
          error={passwordError}
          onCancel={() => {
            setPasswordOpen(false);
            setPasswordError(null);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
          }}
          onSubmit={savePassword}
        >
              {/* Hidden username so password managers associate the change-password
                  credential with this account (the visible username lives in the
                  separate Account form above). */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={member.username}
                readOnly
                aria-hidden
                tabIndex={-1}
                className="sr-only"
              />
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
              <FieldGrid cols={2}>
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
              </FieldGrid>

        </FormPanel>
      </div>
    </StageShell>
  );
}
