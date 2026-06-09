'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
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

  const label = 'mb-1.5 block text-[11.5px] font-semibold text-ink-soft';
  const input =
    'w-full rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Add member"
      className="mt-4 rounded-[var(--r-lg)] border-[1.5px] border-accent bg-surface p-5 shadow-[0_0_0_3px_var(--accent-tint)]"
    >
      <div className="mb-3.5 text-sm font-semibold text-ink">Add member</div>
      <div className="grid grid-cols-3 gap-3.5">
        <div>
          <label htmlFor="add-displayName" className={label}>
            Display name
          </label>
          <input
            id="add-displayName"
            name="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={input}
          />
        </div>
        <div>
          <label htmlFor="add-username" className={label}>
            Username
          </label>
          <input
            id="add-username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={cn(input, 'font-mono')}
          />
        </div>
        <div>
          <label htmlFor="add-password" className={label}>
            Password
          </label>
          <div className="flex items-center gap-2">
            <input
              id="add-password"
              name="password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(input, 'font-mono')}
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="shrink-0 text-xs font-medium text-ink-faint hover:text-accent"
            >
              generate
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose">
          {error}
        </p>
      ) : null}

      <div className="mt-3.5 flex items-center justify-between">
        <span className="text-xs text-ink-faint">
          They can change their password later on their profile.
        </span>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? 'Adding…' : 'Add member'}
        </button>
      </div>
    </form>
  );
}
