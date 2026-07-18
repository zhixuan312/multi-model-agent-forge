'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { Search, Pencil, Trash2, UserPlus } from 'lucide-react';
import {
  Card,
  Avatar,
  Badge,
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Field,
  FieldGrid,
  Label,
  Title,
  TextStrong,
  Mono,
  Micro,
  EmptyState,
  DataTable,
  Toolbar,
  SearchInput,
  toolbarControlWidth,
} from '@/components/ui';
import { formatDate } from '@/lib/format-relative';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';

export interface MemberRowData {
  id: string;
  username: string;
  displayName: string;
  avatarTint: string;
  isAdmin: boolean;
  createdAt: string; // ISO
}

type RoleFilter = 'all' | 'admin' | 'member';

/** Generate a readable random password (≥ PASSWORD_MIN_LENGTH). */
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const len = Math.max(PASSWORD_MIN_LENGTH, 16);
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** A password field with a Generate affordance (shown as plain text before submit). */
function PasswordField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-3">
          {value ? (
            <button
              type="button"
              onClick={copy}
              className="focus-ring rounded-sm text-xs font-semibold text-accent hover:underline"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onChange(generatePassword())}
            className="focus-ring rounded-sm text-xs font-semibold text-accent hover:underline"
          >
            Generate
          </button>
        </div>
      </div>
      <Input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter a password"
        className="font-mono"
      />
      {hint ? <Micro>{hint}</Micro> : null}
    </div>
  );
}

/**
 * MemberTable — the Primary section of Team Settings → Members. A single
 * homogeneous table of members with inline CRUD that MIRRORS the Providers tab:
 * "Add member" reveals an inline add form at the top; each row's Edit expands an
 * inline form (Delete on the left, Cancel · Save on the right). Only the fields
 * differ from Providers.
 */
export function MemberTable({ members }: { members: MemberRowData[] }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const adminCount = useMemo(() => members.filter((m) => m.isAdmin).length, [members]);

  const openEdit = useCallback((id: string) => {
    setAdding(false);
    setEditingId(id);
  }, []);
  const openAdd = useCallback(() => {
    setEditingId(null);
    setAdding(true);
  }, []);
  const close = useCallback(() => {
    setEditingId(null);
    setAdding(false);
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (role === 'admin' && !m.isAdmin) return false;
      if (role === 'member' && m.isAdmin) return false;
      if (q && !`${m.displayName} ${m.username}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members, search, role]);

  const columns = useMemo<ColumnDef<MemberRowData>[]>(
    () => [
      {
        id: 'member',
        header: 'Member',
        cell: ({ row }) => {
          const m = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar name={m.displayName} tint={m.avatarTint} aria-hidden />
              <div className="min-w-0 flex-1">
                <TextStrong className="block truncate !text-sm !text-ink" title={m.displayName}>
                  {m.displayName}
                </TextStrong>
                <Micro className="block">{m.isAdmin ? 'Admin' : 'Member'}</Micro>
              </div>
            </div>
          );
        },
      },
      {
        id: 'username',
        header: 'Username',
        size: 190,
        cell: ({ row }) => (
          <Mono className="block truncate !text-xs text-ink-soft" title={`@${row.original.username}`}>
            @{row.original.username}
          </Mono>
        ),
      },
      {
        id: 'capability',
        header: 'Role',
        size: 120,
        cell: ({ row }) => (
          <Badge
            data-testid={row.original.isAdmin ? 'admin-badge' : undefined}
            variant={row.original.isAdmin ? 'accent' : 'neutral'}
            size="sm"
          >
            {row.original.isAdmin ? 'Admin' : 'Member'}
          </Badge>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Joined',
        size: 118,
        cell: ({ row }) => (
          <Micro className="whitespace-nowrap">{formatDate(new Date(row.original.createdAt))}</Micro>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 84,
        cell: ({ row }) => (
          <div className="text-right">
            <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => openEdit(row.original.id)}>
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [openEdit],
  );

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <div className="flex items-center justify-between gap-3">
          <Title className="!text-lg">Team members</Title>
          <Button size="sm" leftIcon={<UserPlus />} onClick={openAdd}>
            Add member
          </Button>
        </div>
        <Toolbar>
          <SearchInput label="members" value={search} onChange={setSearch} />
          <Select value={role} onValueChange={(v) => setRole(v as RoleFilter)}>
            <SelectTrigger aria-label="Filter by role" className={toolbarControlWidth}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
              <SelectItem value="member">Members</SelectItem>
            </SelectContent>
          </Select>
        </Toolbar>
      </div>

      <DataTable
        fill
        columns={columns}
        data={shown}
        data-testid="members-list"
        getRowId={(m) => m.id}
        expandedId={editingId}
        leadingRow={adding ? <MemberForm mode="add" onDone={close} /> : null}
        renderExpanded={(m) => (
          <MemberForm key={m.id} mode="edit" existing={m} isLastAdmin={m.isAdmin && adminCount === 1} onDone={close} />
        )}
        emptyState={
          <EmptyState icon={<Search />} title="No members match" description="Try a different search or role filter." />
        }
      />
    </Card>
  );
}

/**
 * Inline add / edit form (mirrors ProviderForm). Add: display name + username +
 * password. Edit: role + a password reset (blank keeps the current one). Both
 * carry Save AND Cancel; edit also carries Delete.
 */
export function MemberForm({
  mode,
  existing,
  isLastAdmin = false,
  onDone,
}: {
  mode: 'add' | 'edit';
  existing?: MemberRowData;
  /** True when editing the team's only admin — deletion + demotion are locked. */
  isLastAdmin?: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [isAdmin, setIsAdmin] = useState(existing?.isAdmin ?? false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'add') {
      if (displayName.trim() === '' || username.trim() === '') {
        setError('Display name and username are required.');
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
        return;
      }
      setBusy(true);
      try {
        const res = await fetch('/api/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName: displayName.trim(), username: username.trim(), password, isAdmin }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(b?.error ?? 'Could not add the member.');
          return;
        }
        onDone();
        router.refresh();
      } finally {
        setBusy(false);
      }
      return;
    }

    // edit
    if (password !== '' && password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      if (isAdmin !== existing!.isAdmin) {
        const res = await fetch(`/api/members/${existing!.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isAdmin }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(b?.error ?? 'Could not update the member.');
          return;
        }
      }
      if (password !== '') {
        const res = await fetch(`/api/members/${existing!.id}/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ newPassword: password }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(b?.error ?? 'Could not reset the password.');
          return;
        }
      }
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/members/${existing.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not delete the member.');
        return;
      }
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label={mode === 'add' ? 'Add member' : 'Edit member'} className="flex flex-col gap-4 bg-surface-2/50 p-4">
      <FieldGrid cols={2}>
        {mode === 'add' ? (
          <>
            <Field label="Display name">
              {(p) => (
                <Input {...p} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Jane Wong" autoFocus />
              )}
            </Field>
            <Field label="Username">
              {(p) => (
                <Input {...p} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. j.wong" className="font-mono" />
              )}
            </Field>
            <Field label="Role">
              {(p) => (
                <Select value={isAdmin ? 'admin' : 'member'} onValueChange={(v) => setIsAdmin(v === 'admin')}>
                  <SelectTrigger {...p}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <PasswordField id="add-password" label="Password" value={password} onChange={setPassword} />
          </>
        ) : (
          <>
            <Field label="Role">
              {(p) => (
                <Select value={isAdmin ? 'admin' : 'member'} onValueChange={(v) => setIsAdmin(v === 'admin')} disabled={isLastAdmin}>
                  <SelectTrigger {...p}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <PasswordField id={`reset-${existing!.id}`} label="New password" hint="blank keeps it" value={password} onChange={setPassword} />
          </>
        )}
      </FieldGrid>

      {mode === 'edit' && isLastAdmin ? (
        <Micro className="block text-ink-soft">
          This is the team’s only admin — promote another member before changing their role or removing them.
        </Micro>
      ) : null}

      {error ? (
        <Micro role="alert" className="block text-rose">
          {error}
        </Micro>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div>
          {mode === 'edit' ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <Micro className="text-rose">Delete permanently?</Micro>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onDelete}
                  loading={busy}
                  className="text-rose hover:text-rose"
                >
                  Confirm delete
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                leftIcon={<Trash2 />}
                onClick={() => setConfirmDelete(true)}
                disabled={busy || isLastAdmin}
                className="text-rose hover:text-rose"
              >
                Delete
              </Button>
            )
          ) : null}
        </div>
        <div className="flex items-center gap-2.5">
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? 'Saving…' : 'Save member'}
          </Button>
        </div>
      </div>
    </form>
  );
}
