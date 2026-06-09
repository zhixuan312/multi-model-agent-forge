'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
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
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <input
          type="search"
          aria-label="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="⌕ Search projects…"
          className="min-w-[200px] rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        <div role="group" aria-label="Filter by phase" className="flex items-center gap-1.5">
          {PHASE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={phase === chip.value}
              onClick={() => setPhase(chip.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium',
                phase === chip.value
                  ? 'bg-ink text-bg'
                  : 'border border-line-strong bg-surface text-ink-soft',
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
            className={cn('px-3 py-1.5 font-medium', mine ? 'bg-ink text-bg' : 'bg-surface text-ink-soft')}
          >
            Mine
          </button>
          <button
            type="button"
            aria-pressed={!mine}
            onClick={() => setMine(false)}
            className={cn('px-3 py-1.5 font-medium', !mine ? 'bg-ink text-bg' : 'bg-surface text-ink-soft')}
          >
            All team
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="grid place-items-center rounded-[var(--r-lg)] border border-dashed border-line bg-surface-2 px-6 py-16 text-center">
          <p className="font-serif text-base italic text-ink-faint">No projects match.</p>
        </div>
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
