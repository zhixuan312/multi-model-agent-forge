'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Activity, Check, ChevronRight, MoreHorizontal, Search, Square, UserPlus } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  Eyebrow,
  Field,
  FieldGrid,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { ConversationPane, FindingsGrid, MessageList, ProseBlock, type ConversationMessage, type Finding } from '@/components/patterns';
import { LEFT_PANEL_VARIANTS, defaultEnabledAffordances } from '@/components/governance/variant-meta';

const DOC_TABS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'document', label: 'Document' },
  { id: 'audit', label: 'Audit' },
  { id: 'discussion', label: 'Discussion' },
];

// Generic rows for the Table skeleton — the shape every table (Loops, Workspace,
// Members, Usage…) extends. The content is placeholder on purpose.
type TableRowShape = { name: string; detail: string; status: string };
const TABLE_ROWS: TableRowShape[] = [
  { name: 'First item', detail: 'Supporting value', status: 'Status' },
  { name: 'Second item', detail: 'Supporting value', status: 'Status' },
  { name: 'Third item', detail: 'Supporting value', status: 'Status' },
  { name: 'Fourth item', detail: 'Supporting value', status: 'Status' },
];

// Columns for the Table skeleton, extended by the governed affordances: bulk-select
// prepends a checkbox column, row-actions appends an actions column.
function tableColumns(on: ReadonlySet<string>): ColumnDef<TableRowShape>[] {
  const cols: ColumnDef<TableRowShape>[] = [];
  if (on.has('bulkSelect')) {
    cols.push({ id: 'select', size: 40, header: () => <Checkbox aria-label="Select all" />, cell: () => <Checkbox aria-label="Select row" /> });
  }
  cols.push(
    { accessorKey: 'name', header: 'Column A' },
    { accessorKey: 'detail', header: 'Column B' },
    { accessorKey: 'status', header: 'Column C', size: 140 },
  );
  if (on.has('rowActions')) {
    cols.push({
      id: 'actions',
      size: 56,
      header: '',
      cell: () => (
        <button type="button" aria-label="Row actions" className="grid size-7 place-items-center rounded-[var(--r-sm)] text-ink-soft hover:bg-surface-2">
          <MoreHorizontal className="size-4" />
        </button>
      ),
    });
  }
  return cols;
}

// Generic markdown for the Document skeleton (rendered by the real ProseBlock).
const DOC_MARKDOWN = `## Section heading

A paragraph of body prose that fills the document width, wrapping and setting
the reading measure the way every document panel does.

- First supporting point
- Second supporting point

### Sub-heading

A closing paragraph.`;

// Generic thread for the Discussion skeleton (rendered by the real ConversationPane).
const DISCUSSION_MESSAGES: ConversationMessage[] = [
  { id: '1', sender: 'member', senderName: 'Member', bodyMd: 'A message from the member.' },
  { id: '2', sender: 'forge', senderName: 'Forge', bodyMd: 'A reply from Forge.' },
];

// Generic findings for the Document shell's Audit view (rendered by the real FindingsGrid).
const DOC_FINDINGS: Finding[] = [
  { severity: 'critical', category: 'Requirement conflict', claim: 'A stated goal contradicts the rollout timeline.' },
  { severity: 'critical', category: 'Requirement conflict', claim: 'An unresolved contradiction has no halt mechanism.' },
  { severity: 'high', category: 'Scope explicitness', claim: 'A required artifact is named but never defined or located.' },
  { severity: 'high', category: 'Assumption exposure', claim: 'A requirement assumes runtime state the spec never surfaces.' },
];

/**
 * Per-pattern renders — the COMMON left-panel container SKELETONS, keyed by the id in
 * variant-meta.ts. Each render takes `on`, the set of governed affordances switched on,
 * and composes ONLY from that fixed menu — the child cannot add a piece that isn't here.
 */
const RENDERS: Record<string, (on: ReadonlySet<string>, activeTab?: string) => ReactNode> = {
  // Skeleton: the real DataTable. Affordances: search · filters (toolbar), bulk-select ·
  // row-actions (columns).
  table: (on) => (
    <Card>
      <CardContent className="flex flex-col gap-3 p-0">
        {on.has('search') || on.has('filters') ? (
          <div className="flex items-center gap-2 px-5 pt-4">
            {on.has('search') ? (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                <Input placeholder="Search…" className="pl-9" />
              </div>
            ) : null}
            {on.has('filters') ? (
              <Select defaultValue="all">
                <SelectTrigger aria-label="Filter" className="w-[140px] shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}
        <DataTable columns={tableColumns(on)} data={TABLE_ROWS} />
      </CardContent>
    </Card>
  ),

  // Skeleton: a section Card wrapping labelled Field rows. Affordances: description,
  // two-column layout (FieldGrid vs stacked), footer actions.
  form: (on) => (
    <Card>
      <CardContent className="flex flex-col gap-5 py-5">
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">Section heading</p>
          {on.has('description') ? (
            <p className="text-sm text-ink-soft">A short description of what this section configures.</p>
          ) : null}
        </div>
        {on.has('twoColumn') ? (
          <FieldGrid cols={2}>
            <Field label="Display name">{(p) => <Input {...p} placeholder="Ada Lovelace" />}</Field>
            <Field label="Username" hint="your login — lowercase, no spaces">{(p) => <Input {...p} placeholder="ada" />}</Field>
          </FieldGrid>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Display name">{(p) => <Input {...p} placeholder="Ada Lovelace" />}</Field>
            <Field label="Username" hint="your login — lowercase, no spaces">{(p) => <Input {...p} placeholder="ada" />}</Field>
          </div>
        )}
        {on.has('footerActions') ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost">Cancel</Button>
            <Button size="sm">Save</Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  ),

  // Skeleton: divide-y rows. Affordances: section header, row leading icon, row trailing
  // meta (Badge). Journal Recall is this pattern repeated as grouped sections.
  list: (on) => (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        {on.has('header') ? <Eyebrow className="text-ink-faint">Section header</Eyebrow> : null}
        <ul className="flex flex-col divide-y divide-line">
          {['First item', 'Second item', 'Third item', 'Fourth item'].map((label) => (
            <li key={label} className="flex items-center gap-3 py-3 text-sm">
              {on.has('expand') ? <ChevronRight className="size-4 shrink-0 text-ink-faint" /> : null}
              {on.has('leadingIcon') ? <span className="size-8 shrink-0 rounded-md bg-surface-2" /> : null}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{label}</p>
                <p className="text-xs text-ink-faint">Supporting metadata</p>
              </div>
              {on.has('trailingMeta') ? <Badge variant="neutral" size="sm">meta</Badge> : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  ),

  // Skeleton: the stage-document SHELL — a constant header (title + version) and Approvers
  // row, with a body that SWAPS by the view toggle. Affordances: Spec⇄Audit⇄Discussion
  // toggle (Tabs), approvers row (AvatarGroup + Invite), approve action (Button footer).
  // Spec view → ProseBlock (+ Approve); Audit view → FindingsGrid; Discussion view → chat.
  // The document SHELL — title + version + tab bar are always present. The active tab
  // (Document / Audit / Discussion) selects the body; each tab's own affordances apply
  // only within that tab (Document: approvers + approve/revoke action).
  document: (on, activeTab) => {
    const tab = activeTab ?? 'document';
    const header = (
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <p className="text-base font-semibold text-ink">Document title</p>
          <Badge variant="sage" size="sm">v5</Badge>
        </div>
        {/* the real bespoke segmented control (not Radix Tabs), reflecting the active tab */}
        <div className="flex items-center rounded-[var(--r)] border border-line bg-surface-2 p-0.5">
          {DOC_TABS.map((t) => (
            <span
              key={t.id}
              className={cn(
                'rounded-[6px] px-3 py-1 text-xs font-medium',
                tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint',
              )}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
    );
    const approvers = on.has('approvers') ? (
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Approvers</span>
          {/* a mix of approved (sage check overlay) and pending (dimmed) approvers */}
          <div className="flex items-center gap-1.5">
            {[
              { name: 'Xu Zheng', approved: true },
              { name: 'Oscar A', approved: true },
              { name: 'Ben N', approved: false },
            ].map((m) => (
              <div key={m.name} className={cn('relative', !m.approved && 'opacity-50')}>
                <Avatar name={m.name} size="sm" />
                {m.approved ? (
                  <span className="absolute -bottom-0.5 -right-0.5 grid size-3 place-items-center rounded-full bg-[var(--sage)] ring-2 ring-surface">
                    <Check className="size-2 text-white" strokeWidth={3.5} />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <Button size="sm" variant="ghost" leftIcon={<UserPlus />}>Invite</Button>
      </div>
    ) : null;

    let body: ReactNode;
    if (tab === 'audit') {
      body = (
        <>
          <div className="px-5 py-4"><FindingsGrid findings={DOC_FINDINGS} readOnly /></div>
          {on.has('applyBar') ? (
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button size="sm">Apply selected</Button>
            </div>
          ) : null}
        </>
      );
    } else if (tab === 'discussion') {
      const renderMeta = on.has('messageMeta') ? () => <span className="text-[10px] text-ink-faint">just now</span> : undefined;
      body = (
        <div className="px-5 py-5">
          {on.has('composer') ? (
            <ConversationPane messages={DISCUSSION_MESSAGES} onSend={() => {}} renderMeta={renderMeta} />
          ) : (
            <MessageList messages={DISCUSSION_MESSAGES} renderMeta={renderMeta} />
          )}
        </div>
      );
    } else {
      body = (
        <>
          <div className="px-5 py-5"><ProseBlock>{DOC_MARKDOWN}</ProseBlock></div>
          {on.has('action') ? (
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <Button size="sm" variant="ghost">Revoke</Button>
              <Button size="sm" leftIcon={<Check />}>Approve</Button>
            </div>
          ) : null}
        </>
      );
    }

    return (
      <Card>
        <CardContent className="flex flex-col p-0">
          {header}
          {approvers}
          {body}
        </CardContent>
      </Card>
    );
  },

  // Card shape 1 — STAT card: Card + CardHeader(icon + title) + CardContent label/value rows.
  statCard: (on) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {['First metric', 'Second metric'].map((t) => (
        <Card key={t}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 !text-base">
              {on.has('icon') ? <Activity className="size-4 text-accent" /> : null}
              {t}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[['Label A', '12'], ['Label B', '34'], ['Label C', '5']].map(([l, v]) => (
              <div key={l} className="flex justify-between text-sm">
                <span className="text-ink-soft">{l}</span>
                <span className="font-medium text-ink">{v}</span>
              </div>
            ))}
          </CardContent>
          {on.has('footer') ? <CardFooter className="text-xs text-ink-faint">Footer</CardFooter> : null}
        </Card>
      ))}
    </div>
  ),

  // Card shape 2 — SELECTABLE tile: button[aria-pressed], selected = accent border + check.
  selectableTile: (on) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[{ t: 'First option', sel: true }, { t: 'Second option', sel: false }, { t: 'Third option', sel: false }].map((o) => (
        <button
          key={o.t}
          type="button"
          aria-pressed={o.sel}
          className={cn(
            'focus-ring flex flex-col gap-2 rounded-[var(--r-md)] border p-3.5 text-left transition-colors',
            o.sel ? 'border-accent bg-accent-tint/25 shadow-sm' : 'border-line hover:border-line-strong',
          )}
        >
          {on.has('icon') ? (
            o.sel ? <Check className="size-4 text-accent" /> : <Square className="size-4 text-ink-faint" />
          ) : null}
          <p className="font-semibold text-ink">{o.t}</p>
          {on.has('meta') ? (
            <div className="flex gap-1">
              <Badge variant="neutral" size="sm">tag</Badge>
              <Badge variant="neutral" size="sm">tag</Badge>
            </div>
          ) : null}
        </button>
      ))}
    </div>
  ),

  // Card shape 3 — STATUS card: bespoke bordered div, state-driven border, header band + progress.
  statusCard: (on) => (
    <div className="flex flex-col gap-3">
      {[{ t: 'First item', tone: 'sage' as const, status: 'Done', pct: 100 }, { t: 'Second item', tone: 'accent' as const, status: 'Running', pct: 60 }].map((r) => (
        <div key={r.t} className={cn('overflow-hidden rounded-[var(--r-lg)] border', r.tone === 'sage' ? 'border-sage' : 'border-accent')}>
          <div className="flex items-center justify-between gap-2 bg-surface-2 px-4 py-3">
            <span className="font-medium text-ink">{r.t}</span>
            {on.has('statusBadge') ? <Badge variant={r.tone} size="sm" dot>{r.status}</Badge> : null}
          </div>
          {on.has('progress') ? (
            <div className="px-4 py-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${r.pct}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  ),
};

/** Renders one Left-panel pattern (a 3rd-layer sub-page), by id. `enabled` overrides the
 *  governed default composition when the editor is toggling affordances live. */
export function LeftPanelVariant({ id, enabled, activeTab }: { id: string; enabled?: ReadonlySet<string>; activeTab?: string }) {
  const render = RENDERS[id];
  const meta = LEFT_PANEL_VARIANTS.find((v) => v.id === id);
  // Default enabled = all affordances across the variant's tabs (or its flat affordances).
  const allIds = meta?.tabs
    ? new Set(meta.tabs.flatMap((t) => (t.affordances ?? []).map((a) => a.id)))
    : defaultEnabledAffordances(meta ?? {});
  const on = enabled ?? allIds;
  return <>{render ? render(on, activeTab) : null}</>;
}

/** Overview (the slot's default page) — every Left-panel pattern stacked, in meta order,
 *  each at its governed default composition. */
export function LeftPanelPreview() {
  return (
    <div className="flex flex-col gap-8">
      {LEFT_PANEL_VARIANTS.map((v) => (
        <div key={v.id} className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{v.label}</p>
          {RENDERS[v.id]?.(defaultEnabledAffordances(v))}
        </div>
      ))}
    </div>
  );
}
