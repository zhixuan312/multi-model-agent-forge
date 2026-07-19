'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, Micro } from '@/components/ui';

/**
 * The stage-rail Navigator — the one card that lists a stage's units of work (Plan
 * tasks, Spec components, Journal learnings, Execute repos, Review passes) with a
 * bulk header action, a progress bar, grouped + checkable item tiles, and an advance
 * footer. Extracted verbatim from the Plan `Tasks` rail so every stage's right-panel
 * navigator renders from ONE component instead of five hand-rolled copies.
 *
 * Every governed part is an optional prop, so a consumer opts into exactly the parts
 * it needs (Review's pass list has no progress/checks; Journal has no section groups):
 *   - `action`   → header bulk button (Approve all / Revoke all — caller owns it)
 *   - `progress` → the count bar
 *   - group.label → section headers above each cluster (omit for a flat list)
 *   - `showChecks` → leading check tile (number → ✓ when done)
 *   - item.meta  → secondary meta line under the title
 *   - `footer`   → advance button (a primary full-width Button, never black)
 */
export interface NavItem {
  id: string;
  title: string;
  /** Secondary line under the title (repo · N files · deps). Omit to hide. */
  meta?: ReactNode;
  /** Currently selected (accent border). Independent of `done` — an item can be both. */
  active?: boolean;
  /** Approved / complete (sage tile with ✓). */
  done?: boolean;
  /** Number shown in the check tile before it's done. */
  index?: number;
  onClick?: () => void;
}

export interface NavGroup {
  id: string;
  /** Section header above the cluster. Omit for a flat, ungrouped list. */
  label?: string;
  items: NavItem[];
}

export interface StageNavigatorProps {
  title: string;
  action?: ReactNode;
  progress?: { value: number; total: number };
  groups: NavGroup[];
  /** Render the leading check tile. */
  showChecks?: boolean;
  footer?: ReactNode;
  className?: string;
}

export function StageNavigator({ title, action, progress, groups, showChecks, footer, className }: StageNavigatorProps) {
  return (
    <Card className={cn('flex min-h-0 flex-col', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      {progress ? (
        <div className="flex items-center gap-2 border-b border-line px-5 py-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-[var(--sage)] transition-all"
              style={{ width: `${progress.total ? (progress.value / progress.total) * 100 : 0}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium text-ink-faint">{progress.value}/{progress.total}</span>
        </div>
      ) : null}
      <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-3">
        {groups.every((g) => g.items.length === 0) ? (
          <p className="py-8 text-center text-sm text-ink-faint">No items yet.</p>
        ) : null}
        {groups.map((g) => (
          <div key={g.id} className="space-y-2">
            {g.label ? (
              <Micro className="block !font-semibold !uppercase !tracking-wide !text-ink-faint">{g.label}</Micro>
            ) : null}
            {g.items.map((it) => {
              const isActive = !!it.active;
              const isDone = !!it.done;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={it.onClick}
                  className={cn(
                    // Read the row as a two-column table: the tile is one cell, the title +
                    // meta stack is the other. `items-center` centres the tile against that
                    // whole stack instead of pinning it to the first line.
                    'flex w-full items-center gap-2.5 rounded-[var(--r-md)] border p-2.5 text-left transition-colors',
                    isActive
                      ? 'border-accent bg-accent-tint/25 shadow-sm'
                      : isDone
                        ? 'border-[var(--sage-deep)]/30 bg-sage-tint/20 hover:bg-sage-tint/40'
                        : 'border-line bg-surface hover:border-line-strong',
                  )}
                >
                  {showChecks ? (
                    <span
                      className={cn(
                        'grid size-6 shrink-0 place-items-center rounded-[6px] text-[10px] font-semibold transition-colors',
                        isDone
                          ? 'bg-[var(--sage-deep)] text-white'
                          : isActive
                            ? 'bg-accent text-white'
                            : 'bg-surface-2 text-ink-faint',
                      )}
                    >
                      {isDone ? <Check className="size-3.5" /> : (it.index ?? '')}
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    {/* Clamped so rows stay a uniform height whatever the title's length —
                        a navigator carrying real content (a prompt, a question) rather than a
                        short label would otherwise stretch its row arbitrarily. */}
                    <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{it.title}</p>
                    {it.meta ? (
                      <div className="mt-0.5 flex min-w-0 items-center gap-2 truncate text-[10px] text-ink-faint">
                        {it.meta}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}
