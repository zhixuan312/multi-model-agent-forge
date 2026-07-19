'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  EmptyState,
  Separator,
  Toolbar,
  Grid,
  SearchInput,
} from '@/components/ui';
import { ProjectCard } from '@/components/forge/ProjectCard';
import type { DashboardProject } from '@/dashboard/dashboard-core';

/**
 * ProjectFilterBar (Spec 3 flow 2) — the Controls + Primary client island over
 * the RSC-hydrated dashboard sets. Filters in-memory (bounded → instant, no
 * per-keystroke server query):
 *   - search       : substring over name + summary
 *   - view         : Active · Archived (visibility overlay, default Active)
 *   - needs-action : projects blocked on a human gate or an open audit finding
 *   - mine|all     : Mine = owner-or-collaborator; All team = the full visible set
 *
 * Phase filtering was removed — a project's lifecycle phase is shown on its card
 * and no longer a top-level filter axis. The pure predicate is exported as
 * `filterProjects` so it stays unit-testable.
 */
export interface ProjectFilterState {
  search: string;
  needsAction: boolean;
  mine: boolean;
}

/** The minimal shape `filterProjects` reads (a `DashboardProject` satisfies it). */
export interface FilterableProject {
  name: string;
  summary: string | null;
  isMember: boolean;
  awaitingHuman: number;
  openAuditIssues: number;
}

const needsAction = (p: FilterableProject) => p.awaitingHuman > 0 || p.openAuditIssues > 0;

/** Pure filter — exported for unit tests. */
export function filterProjects<T extends FilterableProject>(
  items: T[],
  state: ProjectFilterState,
): T[] {
  const q = state.search.trim().toLowerCase();
  return items.filter((p) => {
    if (state.mine && !p.isMember) return false;
    if (state.needsAction && !needsAction(p)) return false;
    if (q !== '') {
      const hay = `${p.name} ${p.summary ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function ProjectFilterBar({
  activeProjects,
  archivedProjects,
}: {
  activeProjects: DashboardProject[];
  archivedProjects: DashboardProject[];
}) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [needs, setNeeds] = useState(false);
  const [mine, setMine] = useState(false);

  const source = view === 'active' ? activeProjects : archivedProjects;

  const shown = useMemo(
    () => filterProjects(source, { search, needsAction: needs, mine }),
    [source, search, needs, mine],
  );

  const needsCount = source.filter(needsAction).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Toolbar
        actions={
          <div
            role="group"
            aria-label="Filter by ownership"
            className="flex overflow-hidden rounded-[var(--r)] border border-line-strong text-xs"
          >
            <button
              type="button"
              aria-pressed={mine}
              onClick={() => setMine(true)}
              className={cn('focus-ring px-3 py-1.5 font-medium transition-colors', mine ? 'bg-ink text-bg' : 'bg-surface text-ink-soft hover:text-ink')}
            >
              Mine
            </button>
            <button
              type="button"
              aria-pressed={!mine}
              onClick={() => setMine(false)}
              className={cn('focus-ring px-3 py-1.5 font-medium transition-colors', !mine ? 'bg-ink text-bg' : 'bg-surface text-ink-soft hover:text-ink')}
            >
              All team
            </button>
          </div>
        }
      >
        <SearchInput label="projects" value={search} onChange={setSearch} className="flex-none" />
        <Separator orientation="vertical" className="h-5" />
        <div
          role="group"
          aria-label="Filter by archive state"
          className="flex overflow-hidden rounded-[var(--r)] border border-line-strong text-xs"
        >
          <button
            type="button"
            aria-pressed={view === 'active'}
            onClick={() => setView('active')}
            className={cn('focus-ring px-3 py-1.5 font-medium transition-colors', view === 'active' ? 'bg-ink text-bg' : 'bg-surface text-ink-soft hover:text-ink')}
          >
            Active {activeProjects.length}
          </button>
          <button
            type="button"
            aria-pressed={view === 'archived'}
            onClick={() => setView('archived')}
            className={cn('focus-ring px-3 py-1.5 font-medium transition-colors', view === 'archived' ? 'bg-ink text-bg' : 'bg-surface text-ink-soft hover:text-ink')}
          >
            Archived {archivedProjects.length}
          </button>
        </div>
        {needsCount > 0 ? (
          <button
            type="button"
            aria-pressed={needs}
            onClick={() => setNeeds((v) => !v)}
            className={cn(
              'focus-ring inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              needs
                ? 'bg-[var(--amber)] text-white'
                : 'border border-line-strong bg-surface text-ink-soft hover:text-ink',
            )}
          >
            <span className={cn('size-1.5 rounded-full', needs ? 'bg-white' : 'bg-[var(--amber)]')} />
            Needs action {needsCount}
          </button>
        ) : null}
      </Toolbar>

      {/* Clearance for the project cards' hover bloom — this scroller clips on every side.
          Same sizing as the Content Shell columns: 12px pull-out (under the surrounding
          gap, so it cannot overlap) and 24px of bottom padding for the shadow's drop. */}
      <div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {shown.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title={view === 'archived' ? 'No archived projects match' : 'No projects match'}
            description="Try a different owner, archive state, or search term."
          />
        ) : (
          <Grid min="320px" data-testid="project-grid">
            {shown.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </Grid>
        )}
      </div>
    </div>
  );
}
