'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input, EmptyState, Separator, Toolbar, Grid } from '@/components/ui';
import { ProjectCard } from '@/components/forge/ProjectCard';
import type { DashboardProject } from '@/dashboard/dashboard-core';
import type { ProjectPhase } from '@/db/enums';

/**
 * ProjectFilterBar (Spec 3 flow 2) — the Controls + Primary client island over
 * the RSC-hydrated dashboard set. Filters in-memory (bounded → instant, no
 * per-keystroke server query):
 *   - search       : substring over name + summary
 *   - phase        : All · Design · Build · Done
 *   - needs-action : projects blocked on a human gate or an open audit finding
 *   - mine|all     : Mine = owner-or-collaborator; All team = the full visible set
 *
 * The pure predicate is exported as `filterProjects` so it is unit-testable.
 */
export type PhaseFilter = 'all' | 'design' | 'build' | 'learn' | 'completed';

export interface ProjectFilterState {
  search: string;
  phase: PhaseFilter;
  needsAction: boolean;
  mine: boolean;
}

/** The minimal shape `filterProjects` reads (a `DashboardProject` satisfies it). */
export interface FilterableProject {
  name: string;
  summary: string | null;
  phase: ProjectPhase;
  isMember: boolean;
  awaitingHuman: number;
  openAuditIssues: number;
}

const PHASE_BUCKET: Record<ProjectPhase, Exclude<PhaseFilter, 'all'>> = {
  design: 'design',
  build: 'build',
  learn: 'learn',
  completed: 'completed',
};

const needsAction = (p: FilterableProject) => p.awaitingHuman > 0 || p.openAuditIssues > 0;

/** Pure filter — exported for unit tests. */
export function filterProjects<T extends FilterableProject>(
  items: T[],
  state: ProjectFilterState,
): T[] {
  const q = state.search.trim().toLowerCase();
  return items.filter((p) => {
    if (state.mine && !p.isMember) return false;
    if (state.phase !== 'all' && PHASE_BUCKET[p.phase] !== state.phase) return false;
    if (state.needsAction && !needsAction(p)) return false;
    if (q !== '') {
      const hay = `${p.name} ${p.summary ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function bucketCount(items: FilterableProject[], bucket: Exclude<PhaseFilter, 'all'>): number {
  return items.filter((p) => PHASE_BUCKET[p.phase] === bucket).length;
}

const PHASE_CHIPS: { value: PhaseFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'design', label: 'Design' },
  { value: 'build', label: 'Build' },
  { value: 'learn', label: 'Learn' },
  { value: 'completed', label: 'Completed' },
];

export function ProjectFilterBar({ projects }: { projects: DashboardProject[] }) {
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<PhaseFilter>('all');
  const [needs, setNeeds] = useState(false);
  const [mine, setMine] = useState(false);

  const shown = useMemo(
    () => filterProjects(projects, { search, phase, needsAction: needs, mine }),
    [projects, search, phase, needs, mine],
  );

  const counts: Record<PhaseFilter, number> = {
    all: projects.length,
    design: bucketCount(projects, 'design'),
    build: bucketCount(projects, 'build'),
    learn: bucketCount(projects, 'learn'),
    completed: bucketCount(projects, 'completed'),
  };
  const needsCount = projects.filter(needsAction).length;

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
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input
            type="search"
            aria-label="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="pl-9"
          />
        </div>
        <Separator orientation="vertical" className="h-5" />
        <div role="group" aria-label="Filter by phase" className="flex items-center gap-1.5">
          {PHASE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={phase === chip.value}
              onClick={() => setPhase(chip.value)}
              className={cn(
                'focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors',
                phase === chip.value
                  ? 'bg-ink text-bg'
                  : 'border border-line-strong bg-surface text-ink-soft hover:text-ink',
              )}
            >
              {chip.label} {counts[chip.value]}
            </button>
          ))}
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

      <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
        {shown.length === 0 ? (
          <EmptyState icon={<Search />} title="No projects match" description="Try a different phase, owner, or search term." />
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
