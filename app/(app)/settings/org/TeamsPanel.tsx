'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users, ShieldCheck, Pencil, Bot } from 'lucide-react';
import {
  Card,
  CardContent,
  Title,
  Field,
  Input,
  Button,
  Badge,
  EmptyState,
  Mono,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';

export interface TeamRow {
  id: string;
  name: string;
  slug: string;
  workspaceRootPath: string;
  gitTokenSet: boolean;
  memberCount: number;
  adminUsername: string | null;
}

interface TeamMemberRow {
  id: string;
  displayName: string;
  username: string;
  isAdmin: boolean;
  isSystem?: boolean;
}

/**
 * Org-admin team management (Spec 2 §Teams FR-9). Lists every team in the
 * deployment and creates new ones via `POST /api/teams`. Because the org admin
 * can never join a team and a team has no members until its admin exists, each
 * new team is created together with its first team admin (username + initial
 * password). Promoting an additional admin later happens from the team roster.
 */
export function TeamsPanel({ initialTeams }: { initialTeams: TeamRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [workspaceRootPath, setWorkspaceRootPath] = useState('');
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSlug('');
    setWorkspaceRootPath('');
    setAdminDisplayName('');
    setAdminUsername('');
    setAdminPassword('');
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          workspaceRootPath,
          admin: { displayName: adminDisplayName, username: adminUsername, password: adminPassword },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not create the team.');
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError('Network error — please retry.');
    } finally {
      setBusy(false);
    }
  };

  // Per-team roster expansion + team-admin appointment (Spec 2 §Teams).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [roster, setRoster] = useState<TeamMemberRow[]>([]);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const loadRoster = async (teamId: string) => {
    setRosterBusy(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/members`);
      setRoster(res.ok ? ((await res.json()) as TeamMemberRow[]) : []);
    } catch {
      setRoster([]);
    } finally {
      setRosterBusy(false);
    }
  };

  const toggleMembers = async (teamId: string) => {
    setEditingId(null);
    if (expandedId === teamId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(teamId);
    setRoster([]);
    await loadRoster(teamId);
  };

  const makeAdmin = async (teamId: string, memberId: string) => {
    setAssigningId(memberId);
    try {
      const res = await fetch(`/api/teams/${teamId}/assign-admin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      if (res.ok) {
        await loadRoster(teamId);
        router.refresh();
      }
    } finally {
      setAssigningId(null);
    }
  };

  // Per-team inline edit (slug / workspace) — org-admin only.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSlug, setEditSlug] = useState('');
  const [editWorkspace, setEditWorkspace] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = (t: TeamRow) => {
    setExpandedId(null);
    setEditingId((cur) => (cur === t.id ? null : t.id));
    setEditSlug(t.slug);
    setEditWorkspace(t.workspaceRootPath);
    setEditError(null);
  };

  const saveEdit = async (teamId: string) => {
    setEditBusy(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: editSlug, workspaceRootPath: editWorkspace }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setEditError(body.error ?? 'Could not update the team.');
        return;
      }
      setEditingId(null);
      router.refresh();
    } catch {
      setEditError('Network error — please retry.');
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex items-center justify-between gap-3">
          <Title>Teams</Title>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              reset();
              setOpen((v) => !v);
            }}
          >
            <Plus className="size-4" />
            New team
          </Button>
        </div>

        {open ? (
          <div className="mb-4 flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-4">
            <Field label="Slug" hint="Unique identifier, e.g. platform-team — the team name is derived from it.">
              {(p) => <Input {...p} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="platform-team" />}
            </Field>
            <Field label="Workspace root path" hint="Local filesystem root for this team's repos and journal.">
              {(p) => (
                <Input
                  {...p}
                  value={workspaceRootPath}
                  onChange={(e) => setWorkspaceRootPath(e.target.value)}
                  placeholder=".forge-workspace/platform"
                />
              )}
            </Field>

            <div className="mt-1 border-t border-line pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Team admin</p>
              <div className="flex flex-col gap-3">
                <Field label="Display name">
                  {(p) => (
                    <Input {...p} value={adminDisplayName} onChange={(e) => setAdminDisplayName(e.target.value)} placeholder="Alex Rivera" />
                  )}
                </Field>
                <Field label="Username" hint="They sign in with this.">
                  {(p) => (
                    <Input {...p} value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} placeholder="alex" />
                  )}
                </Field>
                <Field label="Initial password" hint="Hand this to the admin; they can change it after signing in.">
                  {(p) => (
                    <Input {...p} type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className="font-mono" />
                  )}
                </Field>
              </div>
            </div>

            {error ? <p className="text-sm text-rose">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={
                  busy ||
                  !slug.trim() ||
                  !workspaceRootPath.trim() ||
                  !adminDisplayName.trim() ||
                  !adminUsername.trim() ||
                  !adminPassword
                }
              >
                {busy ? 'Creating…' : 'Create team + admin'}
              </Button>
            </div>
          </div>
        ) : null}

        {initialTeams.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="No teams yet"
            description="Create the first team and its admin. The admin then adds members and configures the team's git token and workspace."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead>Git token</TableHead>
                  <TableHead className="text-right">Roster</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialTeams.map((t) => (
                  <Fragment key={t.id}>
                    <TableRow>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>
                        {t.adminUsername ? <Mono className="text-ink-soft">@{t.adminUsername}</Mono> : <span className="text-ink-faint">—</span>}
                      </TableCell>
                      <TableCell className="text-ink-soft">{t.workspaceRootPath}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.memberCount}</TableCell>
                      <TableCell>
                        {t.gitTokenSet ? (
                          <Badge variant="sage" dot size="sm">
                            set
                          </Badge>
                        ) : (
                          <Badge size="sm">not set</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => startEdit(t)}>
                            <Pencil className="size-4" />
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleMembers(t.id)}>
                            <Users className="size-4" />
                            Members
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {editingId === t.id ? (
                      <TableRow key={`${t.id}-edit`}>
                        <TableCell colSpan={6} className="bg-surface-2">
                          <div className="flex max-w-xl flex-col gap-3">
                            <Field label="Slug" hint="Unique identifier — the team name is derived from it.">
                              {(p) => <Input {...p} value={editSlug} onChange={(e) => setEditSlug(e.target.value)} />}
                            </Field>
                            <Field label="Workspace root path" hint="Must be a direct child of the operator workspace base.">
                              {(p) => <Input {...p} value={editWorkspace} onChange={(e) => setEditWorkspace(e.target.value)} />}
                            </Field>
                            {editError ? <p className="text-sm text-rose">{editError}</p> : null}
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={editBusy}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => saveEdit(t.id)}
                                disabled={editBusy || !editSlug.trim() || !editWorkspace.trim()}
                              >
                                {editBusy ? 'Saving…' : 'Save changes'}
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {expandedId === t.id ? (
                      <TableRow key={`${t.id}-roster`}>
                        <TableCell colSpan={6} className="bg-surface-2">
                          {rosterBusy ? (
                            <p className="text-sm text-ink-soft">Loading roster…</p>
                          ) : roster.length === 0 ? (
                            <p className="text-sm text-ink-soft">No members on this team yet.</p>
                          ) : (
                            <ul className="flex flex-col gap-1.5">
                              {roster.map((m) => (
                                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                                  <span className="flex items-center gap-2">
                                    <span className="font-medium text-ink">{m.displayName}</span>
                                    <Mono className="text-ink-soft">@{m.username}</Mono>
                                    {m.isSystem ? (
                                      <Badge variant="neutral" size="sm">
                                        <Bot className="size-3" />
                                        system agent
                                      </Badge>
                                    ) : m.isAdmin ? (
                                      <Badge variant="accent" size="sm">
                                        <ShieldCheck className="size-3" />
                                        team admin
                                      </Badge>
                                    ) : null}
                                  </span>
                                  {m.isSystem || m.isAdmin ? null : (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => makeAdmin(t.id, m.id)}
                                      disabled={assigningId === m.id}
                                    >
                                      {assigningId === m.id ? 'Assigning…' : 'Make admin'}
                                    </Button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
