import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, Badge } from '@/components/ui';
import { StatusDashboard } from '@/components/patterns/status-dashboard';

/**
 * StageShell — the master-detail layout for project stages.
 * Right rail (1/3): note + selectable item list + footer.
 * Left main (2/3): detail content for the selected item.
 *
 * The 2/3 ∣ 1/3 split itself is the canonical `StatusDashboard` (Content Shell) —
 * StageShell composes it and adds the rail's selectable item list. The list is the
 * Left-panel governed pattern; it lives here until that layer is standardized.
 *
 * Every stage follows the same pattern:
 * - Spec Craft: components list → Q&A conversation
 * - Plan Refine: tasks list → task conversation
 * - Explore Discover: agent tasks → task output/findings
 * - Review: passes → findings grid
 * - Journal: learnings → conversation + draft
 */

export interface StageShellItem {
  id: string;
  label: string;
  description?: string;
  status?: string;
  statusVariant?: 'neutral' | 'amber' | 'sage' | 'rose';
}

export interface StageShellProps {
  /** The guidance note at the top of the rail. */
  note?: ReactNode;
  /** The selectable items in the rail. */
  items: StageShellItem[];
  /** The currently selected item id. */
  activeId: string | null;
  /** Called when an item is selected. */
  onSelect: (id: string) => void;
  /** Rail list title (e.g. "Tasks", "Components", "Learnings"). */
  listTitle: string;
  /** Progress indicator next to the list title (e.g. "3/5"). */
  listProgress?: string;
  /** Progress bar percentage (0-100). Shows a bar above the list when set. */
  progressPct?: number;
  /** The main content area — renders detail for the selected item. */
  children: ReactNode;
  /** Footer content in the rail (e.g. StageAdvance button). */
  footer?: ReactNode;
  /** Additional content below the item list (e.g. action buttons). */
  listActions?: ReactNode;
  /** Extra className for the outer grid. */
  className?: string;
}

export function StageShell({
  note,
  items,
  activeId,
  onSelect,
  listTitle,
  listProgress,
  progressPct,
  children,
  footer,
  listActions,
  className,
}: StageShellProps) {
  return (
    <StatusDashboard
      className={className}
      // LEFT — main detail content (2/3)
      primary={<Card className="flex min-h-0 flex-1 flex-col">{children}</Card>}
      // RIGHT — note + item list + footer (1/3)
      aside={
        <>
          {note}
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>{listTitle}</CardTitle>
                {listProgress && progressPct === undefined ? (
                  <span className="text-sm font-medium text-ink-faint">{listProgress}</span>
                ) : null}
              </div>
            </CardHeader>
            {progressPct !== undefined ? (
              <div className="flex items-center gap-2 border-b border-line px-5 py-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-[var(--sage)] transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                {listProgress ? <span className="shrink-0 text-xs font-medium text-ink-faint">{listProgress}</span> : null}
              </div>
            ) : null}
            <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
              {items.map((item) => {
                const isActive = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors',
                      isActive
                        ? 'border-accent bg-surface shadow-sm'
                        : 'border-transparent hover:bg-surface-2/50',
                    )}
                  >
                    {item.status ? (
                      <Badge
                        variant={item.statusVariant ?? 'neutral'}
                        size="sm"
                        className="mt-0.5 shrink-0"
                      >
                        {item.status}
                      </Badge>
                    ) : (
                      <span className={cn(
                        'mt-1.5 size-2.5 shrink-0 rounded-full',
                        isActive ? 'bg-accent' : 'bg-line-strong',
                      )} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{item.label}</p>
                      {item.description ? (
                        <p className="mt-0.5 truncate text-xs text-ink-soft">{item.description}</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
              {items.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-faint">No items yet.</p>
              ) : null}
            </CardContent>
            {(footer || listActions) ? (
              <CardFooter className="flex-col !items-stretch gap-2">
                {listActions}
                {footer}
              </CardFooter>
            ) : null}
          </Card>
        </>
      }
    />
  );
}
