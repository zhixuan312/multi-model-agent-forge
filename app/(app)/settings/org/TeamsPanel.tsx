'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users, ShieldCheck } from 'lucide-react';
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
}

interface TeamMemberRow {
  id: string;
  displayName: string;
  username: string;
  isAdmin: boolean;
}

/**
 * Org-admin team management (Spec 2 §Teams). Lists every team in the deployment
 * and creates new ones via `POST /api/teams`. The org admin owns the shared
 * infra; each team it creates gets its own workspace root and (later) its own
 * git token + team admin. Assigning a team admin happens from the team's member
 * roster (a member must already belong to the team), so it is not done here.
 */
export function TeamsPanel({ initialTeams }: { initialTeams: TeamRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [workspaceRootPath, setWorkspaceRootPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setSlug('');
    setWorkspaceRootPath('');
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, slug, workspaceRootPath }),
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
            <Field label="Name">
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Platform Team" />}
            </Field>
            <Field label="Slug" hint="Lowercase identifier, unique across the org.">
              {(p) => <Input {...p} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="platform" />}
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
            {error ? <p className="text-sm text-rose">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={busy || !name.trim() || !slug.trim() || !workspaceRootPath.trim()}>
                {busy ? 'Creating…' : 'Create team'}
              </Button>
            </div>
          </div>
        ) : null}

        {initialTeams.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="No teams yet"
            description="Create the first team, then add members and appoint a team admin from that team's roster."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Slug</TableHead>
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
                        <Mono>{t.slug}</Mono>
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
                        <Button size="sm" variant="ghost" onClick={() => toggleMembers(t.id)}>
                          <Users className="size-4" />
                          Members
                        </Button>
                      </TableCell>
                    </TableRow>
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
                                    {m.isAdmin ? (
                                      <Badge variant="accent" size="sm">
                                        <ShieldCheck className="size-3" />
                                        team admin
                                      </Badge>
                                    ) : null}
                                  </span>
                                  {m.isAdmin ? null : (
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
