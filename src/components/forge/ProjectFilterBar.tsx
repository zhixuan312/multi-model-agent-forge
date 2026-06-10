'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input, EmptyState, Separator } from '@/components/ui';
import { ProjectCard } from '@/components/forge/ProjectCard';
import type { ProjectListItem } from '@/projects/projects-core';
import type { ProjectPhase } from '@/db/enums';

/**
 * ProjectFilterBar (Spec 3 flow 2) — the client island over the RSC-hydrated
 * visible set. Filters in-memory (bounded ≤ ~200 projects → instant, no
 * per-keystroke server query):
 *   - search : case-insensitive trimmed substring over name + summary
 *   - phase  : All · Design (design|frozen) · Build (build) · Done (done)
 *   - mine|all : Mine = owner-or-collaborator; All team = the full visible set
 *
 * The pure predicate is exported as `filterProjects` so it is unit-testable.
 */

export type PhaseFilter = 'all' | 'design' | 'build' | 'done';

export interface ProjectFilterState {
  search: string;
  phase: PhaseFilter;
  mine: boolean;
}

const PHASE_BUCKET: Record<ProjectPhase, Exclude<PhaseFilter, 'all'>> = {
  design: 'design',
  frozen: 'design',
  build: 'build',
  done: 'done',
};

/** Pure filter — exported for unit tests. */
export function filterProjects(
  items: ProjectListItem[],
  { search, phase, mine }: ProjectFilterState,
): ProjectListItem[] {
  const q = search.trim().toLowerCase();
  return items.filter((p) => {
    if (mine && !p.isMember) return false;
    if (phase !== 'all' && PHASE_BUCKET[p.phase] !== phase) return false;
    if (q !== '') {
      const hay = `${p.name} ${p.summary ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function bucketCount(items: ProjectListItem[], bucket: Exclude<PhaseFilter, 'all'>): number {
  return items.filter((p) => PHASE_BUCKET[p.phase] === bucket).length;
}

const PHASE_CHIPS: { value: PhaseFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'design', label: 'Design' },
  { value: 'build', label: 'Build' },
  { value: 'done', label: 'Done' },
];

export function ProjectFilterBar({ projects }: { projects: ProjectListItem[] }) {
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<PhaseFilter>('all');
  const [mine, setMine] = useState(false);

  const shown = useMemo(
    () => filterProjects(projects, { search, phase, mine }),
    [projects, search, phase, mine],
  );

  const counts: Record<PhaseFilter, number> = {
    all: projects.length,
    design: bucketCount(projects, 'design'),
    build: bucketCount(projects, 'build'),
    done: bucketCount(projects, 'done'),
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2.5">
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
        <span className="flex-1" />
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
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<Search />} title="No projects match" description="Try a different phase, owner, or search term." />
      ) : (
        <div
          data-testid="project-grid"
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}
        >
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
