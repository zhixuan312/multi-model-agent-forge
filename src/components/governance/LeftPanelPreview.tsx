'use client';

import { useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Activity, Check, ChevronRight, MoreHorizontal, RotateCcw, Search, Square, UserPlus } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DataTable,
  Field,
  FieldGrid,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import {
  ConversationPane,
  DocumentShell,
  FindingsGrid,
  FormSection,
  List,
  MessageList,
  ProseBlock,
  SelectableTile,
  StatCard,
  StatusCard,
  type ConversationMessage,
  type Finding,
} from '@/components/patterns';
import { FindingsApplyBar } from '@/components/patterns/findings';
import { LEFT_PANEL_VARIANTS, defaultEnabledAffordances } from '@/components/governance/variant-meta';

// ─── Demo content — kept separate from the reusable components it feeds ───────────────

const DOC_TABS = [
  { id: 'document', label: 'Document' },
  { id: 'audit', label: 'Audit' },
  { id: 'discussion', label: 'Discussion' },
] as const;

type TableRowShape = { name: string; detail: string; status: string };
const TABLE_ROWS: TableRowShape[] = [
  { name: 'First item', detail: 'Supporting value', status: 'Status' },
  { name: 'Second item', detail: 'Supporting value', status: 'Status' },
  { name: 'Third item', detail: 'Supporting value', status: 'Status' },
  { name: 'Fourth item', detail: 'Supporting value', status: 'Status' },
];

const DOC_MARKDOWN = `## Section heading

A paragraph of body prose that fills the document width, wrapping and setting
the reading measure the way every document panel does.

- First supporting point
- Second supporting point

### Sub-heading

A closing paragraph.`;

const DISCUSSION_MESSAGES: ConversationMessage[] = [
  { id: '1', sender: 'member', senderName: 'Member', bodyMd: 'A message from the member.' },
  { id: '2', sender: 'forge', senderName: 'Forge', bodyMd: 'A reply from Forge.' },
];

const DOC_FINDINGS: Finding[] = [
  { severity: 'critical', category: 'Requirement conflict', claim: 'A stated goal contradicts the rollout timeline.' },
  { severity: 'critical', category: 'Requirement conflict', claim: 'An unresolved contradiction has no halt mechanism.' },
  { severity: 'high', category: 'Scope explicitness', claim: 'A required artifact is named but never defined or located.' },
  { severity: 'high', category: 'Assumption exposure', claim: 'A requirement assumes runtime state the spec never surfaces.' },
];

const STAT_ROWS = [
  { label: 'Label A', value: '12' },
  { label: 'Label B', value: '34' },
  { label: 'Label C', value: '5' },
];

// Columns for the demo table, extended by the governed affordances (bulk-select prepends a
// checkbox column, row-actions appends an actions column). The container is the real DataTable.
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

/** Demo-interactive: a selectable FindingsGrid + FindingsApplyBar sharing selection state. */
function AuditView({ showApplyBar }: { showApplyBar: boolean }) {
  const [selected, setSelected] = useState<number[]>([]);
  const toggle = (i: number) => setSelected((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  const toggleAll = () => setSelected((prev) => (prev.length === DOC_FINDINGS.length ? [] : DOC_FINDINGS.map((_, i) => i)));
  return (
    <>
      <div className="px-5 py-4">
        <FindingsGrid findings={DOC_FINDINGS} selectable selectedIndices={selected} onToggle={toggle} />
      </div>
      {showApplyBar ? (
        <FindingsApplyBar selectedCount={selected.length} total={DOC_FINDINGS.length} onToggleAll={toggleAll} onApply={() => {}} />
      ) : null}
    </>
  );
}

/** Demo-interactive: the status-dependent approval action — Approve ⇄ Revoke. */
function ApproveButton() {
  const [approved, setApproved] = useState(false);
  return (
    <Button
      size="sm"
      variant={approved ? 'secondary' : 'primary'}
      leftIcon={approved ? <RotateCcw /> : <Check />}
      onClick={() => setApproved((a) => !a)}
    >
      {approved ? 'Revoke' : 'Approve'}
    </Button>
  );
}

/** Demo content: a mix of approved (sage check overlay) and pending (dimmed) approvers. */
function ApproversRow() {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Approvers</span>
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
  );
}

// ─── Per-pattern renders — thin wrappers that reuse the shared components with demo content ─

const RENDERS: Record<string, (on: ReadonlySet<string>, activeTab?: string) => ReactNode> = {
  // The real DataTable. Affordances: search · filters (toolbar), bulk-select · row-actions (columns).
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

  // Shared FormSection. Affordances drive the description, two-column layout, and footer actions.
  form: (on) => {
    const fields = (
      <>
        <Field label="Display name">{(p) => <Input {...p} placeholder="Ada Lovelace" />}</Field>
        <Field label="Username" hint="your login — lowercase, no spaces">{(p) => <Input {...p} placeholder="ada" />}</Field>
      </>
    );
    return (
      <FormSection
        heading="Section heading"
        description={on.has('description') ? 'A short description of what this section configures.' : undefined}
        footer={
          on.has('footerActions') ? (
            <>
              <Button size="sm" variant="ghost">Cancel</Button>
              <Button size="sm">Save</Button>
            </>
          ) : undefined
        }
      >
        {on.has('twoColumn') ? <FieldGrid cols={2}>{fields}</FieldGrid> : <div className="flex flex-col gap-4">{fields}</div>}
      </FormSection>
    );
  },

  // Shared List. Affordances: section header, row leading (expand arrow / icon), trailing meta.
  list: (on) => (
    <List
      sections={[
        {
          header: on.has('header') ? 'Section header' : undefined,
          rows: ['First item', 'Second item', 'Third item', 'Fourth item'].map((label, i) => ({
            id: String(i),
            leading:
              on.has('expand') || on.has('leadingIcon') ? (
                <>
                  {on.has('expand') ? <ChevronRight className="size-4 shrink-0 text-ink-faint" /> : null}
                  {on.has('leadingIcon') ? <span className="size-8 shrink-0 rounded-md bg-surface-2" /> : null}
                </>
              ) : undefined,
            primary: label,
            secondary: 'Supporting metadata',
            trailing: on.has('trailingMeta') ? <Badge variant="neutral" size="sm">meta</Badge> : undefined,
          })),
        },
      ]}
    />
  ),

  // Shared DocumentShell — the active tab picks the body; each tab's own affordances apply.
  document: (on, activeTab) => {
    const tab = activeTab ?? 'document';
    const approvers = on.has('approvers') ? <ApproversRow /> : undefined;

    let body: ReactNode;
    let footer: ReactNode;
    if (tab === 'audit') {
      body = <AuditView showApplyBar={on.has('applyBar')} />;
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
      body = <div className="px-5 py-5"><ProseBlock>{DOC_MARKDOWN}</ProseBlock></div>;
      footer = on.has('action') ? (
        <div className="flex justify-end border-t border-line px-5 py-3">
          <ApproveButton />
        </div>
      ) : undefined;
    }

    return <DocumentShell title="Document title" version={5} tabs={DOC_TABS} activeTab={tab} approvers={approvers} body={body} footer={footer} />;
  },

  // Shared StatCard grid. Affordances: header icon, card footer.
  statCard: (on) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {['First metric', 'Second metric'].map((t) => (
        <StatCard
          key={t}
          icon={on.has('icon') ? <Activity className="size-4 text-accent" /> : undefined}
          title={t}
          rows={STAT_ROWS}
          footer={on.has('footer') ? 'Footer' : undefined}
        />
      ))}
    </div>
  ),

  // Shared SelectableTile grid. Affordances: tile icon (flips to check), meta row.
  selectableTile: (on) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[{ t: 'First option', sel: true }, { t: 'Second option', sel: false }, { t: 'Third option', sel: false }].map((o) => (
        <SelectableTile
          key={o.t}
          selected={o.sel}
          icon={on.has('icon') ? (o.sel ? <Check className="size-4 text-accent" /> : <Square className="size-4 text-ink-faint" />) : undefined}
          title={o.t}
          meta={
            on.has('meta') ? (
              <div className="flex gap-1">
                <Badge variant="neutral" size="sm">tag</Badge>
                <Badge variant="neutral" size="sm">tag</Badge>
              </div>
            ) : undefined
          }
        />
      ))}
    </div>
  ),

  // Shared StatusCard stack. Affordances: status badge, progress bar.
  statusCard: (on) => (
    <div className="flex flex-col gap-3">
      {[
        { t: 'First item', tone: 'sage' as const, status: 'Done', pct: 100 },
        { t: 'Second item', tone: 'accent' as const, status: 'Running', pct: 60 },
      ].map((r) => (
        <StatusCard
          key={r.t}
          title={r.t}
          tone={r.tone}
          badge={on.has('statusBadge') ? <Badge variant={r.tone} size="sm" dot>{r.status}</Badge> : undefined}
        >
          {on.has('progress') ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${r.pct}%` }} />
            </div>
          ) : null}
        </StatusCard>
      ))}
    </div>
  ),
};

/** Renders one Left-panel pattern, by id — reusing the shared component with demo content. */
export function LeftPanelVariant({ id, enabled, activeTab }: { id: string; enabled?: ReadonlySet<string>; activeTab?: string }) {
  const render = RENDERS[id];
  const meta = LEFT_PANEL_VARIANTS.find((v) => v.id === id);
  const allIds = meta?.tabs
    ? new Set(meta.tabs.flatMap((t) => (t.affordances ?? []).map((a) => a.id)))
    : defaultEnabledAffordances(meta ?? {});
  const on = enabled ?? allIds;
  return <>{render ? render(on, activeTab) : null}</>;
}

/** Overview (the slot's default page) — every Left-panel pattern stacked, in meta order. */
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
