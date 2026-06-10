'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { Card, CardContent, Field, Input, Button, Mono, Micro } from '@/components/ui';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';

/** Generate a readable random password (≥ PASSWORD_MIN_LENGTH). */
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const len = Math.max(PASSWORD_MIN_LENGTH, 16);
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Add-member card (Spec 1 §Members CRUD / members.html): display name + username
 * + password (with a generate affordance). Submits to `POST /api/members`. The
 * password is shown client-side before submit and never echoed by the API.
 */
export function AddMemberForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (displayName.trim() === '' || username.trim() === '') {
      setError('Display name and username are required.');
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          username: username.trim(),
          password,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not add the member.');
        return;
      }
      setDisplayName('');
      setUsername('');
      setPassword('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-accent ring-[3px] ring-accent-tint">
      <form onSubmit={onSubmit} aria-label="Add member">
        <CardContent className="flex flex-col gap-4 py-5">
          <Mono className="!text-sm font-semibold text-ink">Add member</Mono>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Display name">
              {(p) => (
                <Input {...p} name="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              )}
            </Field>
            <Field label="Username">
              {(p) => (
                <Input {...p} name="username" value={username} onChange={(e) => setUsername(e.target.value)} className="font-mono" />
              )}
            </Field>
            <Field label="Password">
              {(p) => (
                <div className="flex items-center gap-2">
                  <Input
                    {...p}
                    name="password"
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="font-mono"
                  />
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPassword(generatePassword())} className="shrink-0">
                    generate
                  </Button>
                </div>
              )}
            </Field>
          </div>

          {error ? (
            <Micro role="alert" className="block text-rose">
              {error}
            </Micro>
          ) : null}

          <div className="flex items-center justify-between">
            <Micro>They can change their password later on their profile.</Micro>
            <Button type="submit" leftIcon={<UserPlus />} loading={submitting}>
              {submitting ? 'Adding…' : 'Add member'}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}
