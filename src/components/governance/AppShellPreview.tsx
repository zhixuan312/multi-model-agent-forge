'use client';

import { Fragment, type ReactNode } from 'react';
import { Bell } from 'lucide-react';
import { Button, Breadcrumb } from '@/components/ui';
import { Sidebar } from '@/components/forge/Sidebar';
import type { AuthedMember } from '@/auth/auth-provider';
import { APP_SHELL_VARIANTS } from '@/components/governance/variant-meta';

const MEMBER: AuthedMember = {
  id: 'member-1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  avatarTint: '#9a6b4f',
  role: 'org_admin',
  teamId: null,
};

/** The global top-right cluster (notification bell + account), pinned by AppShell. */
function Utilities() {
  return (
    <div className="flex items-center gap-2" title="Global cluster (bell + account) — pinned far-right by AppShell">
      <Bell className="size-4 text-ink-faint" aria-hidden />
      <span className="flex size-6 items-center justify-center rounded-full bg-accent/20 text-[0.625rem] font-semibold text-accent-deep">
        OA
      </span>
    </div>
  );
}

/** A header row following the canonical grammar: LEFT = breadcrumb + title; RIGHT =
 *  actions (ml-auto, gap-2) then the global cluster. Matches ShellHeader + PageFrame. */
function HeaderRow({ breadcrumb, actions }: { breadcrumb?: boolean; actions?: ReactNode }) {
  return (
    <div className="flex h-16 items-center gap-4 border-b border-line bg-surface px-5">
      <div className="flex min-w-0 flex-col gap-0.5">
        {breadcrumb ? <Breadcrumb items={[{ label: 'Projects', href: '#' }, { label: 'Detail' }]} /> : null}
        <span className="truncate text-xl font-semibold leading-tight text-ink">Page title</span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {actions}
        {actions ? <span aria-hidden className="mx-1 h-5 w-px bg-line" /> : null}
        <Utilities />
      </div>
    </div>
  );
}

function Framed({ note, children }: { note: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-faint">{note}</p>
      <div className="overflow-hidden rounded-md border border-line">{children}</div>
    </div>
  );
}

/** Per-variant renders, keyed by the id declared in variant-meta.ts (APP_SHELL_VARIANTS). */
const RENDERS: Record<string, () => ReactNode> = {
  anatomy: () => (
    <Framed note="Where the header sits in the shell — sidebar rail, header bar, sub-nav (tabs), body.">
      <div className="flex bg-bg">
        <div className="hidden shrink-0 lg:block">
          <Sidebar member={MEMBER} forceVisible />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <HeaderRow actions={<Button variant="primary" size="sm">Action</Button>} />
          <div className="flex h-12 items-center gap-1 border-b border-line bg-surface-2 px-5">
            {['Overview', 'Activity', 'Settings'].map((t, i) => (
              <span
                key={t}
                className={
                  i === 0
                    ? 'border-b-2 border-accent px-3 py-2 text-sm font-medium text-ink'
                    : 'px-3 py-2 text-sm text-ink-soft'
                }
              >
                {t}
              </span>
            ))}
          </div>
          <div className="flex-1 bg-bg p-4 text-sm text-ink-faint">Page body — the only region that scrolls; the header stays put.</div>
        </div>
      </div>
    </Framed>
  ),
  header: () => (
    <div className="flex flex-col gap-6">
      <Framed note="No page actions — identity on the left, global cluster on the right.">
        <HeaderRow />
      </Framed>
      <Framed note="A single primary button, right-aligned, before the global cluster.">
        <HeaderRow actions={<Button variant="primary" size="sm">Action</Button>} />
      </Framed>
      <Framed note="Left → right: secondary, then primary. Primary is always last (nearest the cluster); spacing is gap-2.">
        <HeaderRow
          actions={
            <>
              <Button variant="secondary" size="sm">Secondary</Button>
              <Button variant="primary" size="sm">Primary</Button>
            </>
          }
        />
      </Framed>
      <Framed note="A wayfinding trail sits ABOVE the title in the left zone — never on the right.">
        <HeaderRow breadcrumb actions={<Button variant="primary" size="sm">Action</Button>} />
      </Framed>
      <Framed note="A second row (ShellSubNav) sits directly under the header for tabs / stage nav — actions stay in the header row above.">
        <>
          <HeaderRow actions={<Button variant="primary" size="sm">Action</Button>} />
          <div className="flex h-12 items-center gap-1 border-t border-line bg-surface-2 px-5">
            {['Overview', 'Activity', 'Settings'].map((t, i) => (
              <span
                key={t}
                className={
                  i === 0
                    ? 'border-b-2 border-accent px-3 py-2 text-sm font-medium text-ink'
                    : 'px-3 py-2 text-sm text-ink-soft'
                }
              >
                {t}
              </span>
            ))}
          </div>
        </>
      </Framed>
    </div>
  ),
};

/** Renders one App-shell variant (a 3rd-layer sub-page), by id. */
export function AppShellVariant({ id }: { id: string }) {
  const render = RENDERS[id];
  return <>{render ? render() : null}</>;
}

/** Overview (the slot's default page) — every App-shell variant stacked, in meta order. */
export function AppShellPreview() {
  return (
    <div className="flex flex-col gap-6">
      {APP_SHELL_VARIANTS.map((v) => (
        <Fragment key={v.id}>{RENDERS[v.id]?.()}</Fragment>
      ))}
    </div>
  );
}
