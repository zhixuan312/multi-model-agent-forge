'use client';

import { useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Activity, Check, MoreHorizontal, Plus, RotateCcw, Square } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  DataTableHeader,
  Field,
  FieldGrid,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toolbar,
  SearchInput,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  toolbarControlWidth,
  AvatarPicker,
  AVATAR_TINTS,
} from '@/components/ui';
import { SelectableTile, StatCard, StatCardGrid } from '@/components/patterns/cards';
import { ConversationComposer } from '@/components/patterns/conversation';
import { DocumentShell } from '@/components/patterns/document-shell';
import { FindingsGrid, type Finding } from '@/components/patterns/findings';
import { FormPanel } from '@/components/patterns/form-panel';
import { List } from '@/components/patterns/list';
import { ProseBlock } from '@/components/patterns/prose-block';
import { FindingsApplyBar, appliedState } from '@/components/patterns/findings';
import { DiscussionThread } from '@/components/forge/collab/DiscussionThread';
import { ParticipantStrip } from '@/components/forge/collab/Participants';
import type { DiscussionMsg, MemberRef, Participant } from '@/collab/types';
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

// Discussion demo — the real DiscussionThread model: members + a `memberById` resolver, and
// messages keyed by authorId ('forge' = the AI turn, matching currentMemberId = your turn).
const DEMO_MEMBERS: MemberRef[] = [
  { id: 'forge', displayName: 'Forge', avatarTint: '#c2703d' },
  { id: 'me', displayName: 'You', avatarTint: '#4f7a9a' },
  { id: 'oa', displayName: 'Oscar A', avatarTint: '#9a6b4f' },
];
const demoMemberById = (id: string) => DEMO_MEMBERS.find((m) => m.id === id);
const DEMO_DISCUSSION: DiscussionMsg[] = [
  { id: '1', authorId: 'oa', body: 'A message from a teammate.' },
  { id: '2', authorId: 'forge', body: 'A reply from Forge.' },
  { id: '3', authorId: 'me', body: 'My reply.' },
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
      // The affordance declares `DropdownMenu` as its canonical component, so the preview
      // must BE one — this was a bare button, i.e. the picture contradicting the entry
      // beside it. Mirrors ProjectActionsMenu, the real row-actions trigger.
      cell: () => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm" aria-label="Row actions" className="w-8 px-0">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label="Row actions" className="w-44">
            <DropdownMenuItem onSelect={() => {}}>
              <Activity />
              View
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => {}}>
              <RotateCcw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    });
  }
  return cols;
}

/**
 * Demo-interactive: a FindingsGrid (optionally with the multi-select checkbox column) +
 * FindingsApplyBar.
 *
 * Applying a SUBSET is the behaviour this pattern exists for, and the demo could not show it:
 * `applied` was a boolean, so the first Apply marked whatever was selected and locked the
 * whole grid. All three stage clients do the opposite, each with a comment saying so —
 * "applying a SUBSET must not lock the whole grid; only applied rows go green, the rest stay
 * actionable" — and `appliedState` was extracted into `patterns/findings.tsx` so they could
 * not disagree about it. The catalogue was the one surface still demonstrating the locking
 * version, which is what somebody would have built the next audit panel from.
 *
 * It now tracks applied INDICES and drives the bar from the shared helper, exactly as Review
 * and Plan do: select-all and Apply act on what remains, and the pass locks only when every
 * finding has been applied.
 */
function AuditView({ showApplyBar, selectable }: { showApplyBar: boolean; selectable: boolean }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [applied, setApplied] = useState<number[]>([]);
  const state = appliedState(DOC_FINDINGS.length, applied);
  const toggle = (i: number) => setSelected((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  const toggleAll = () =>
    setSelected((prev) => (prev.length === state.remainingIndices.length ? [] : state.remainingIndices));
  return (
    <>
      {/* No wrapper inset: the grid is edge-to-edge and the shell is `flush` for this tab,
          so the rows span the full card width like they do on Review. */}
      <FindingsGrid
        findings={DOC_FINDINGS}
        selectable={selectable}
        selectedIndices={selected}
        onToggle={toggle}
        appliedIndices={applied}
        readOnly={state.allApplied}
      />
      {showApplyBar ? (
        <FindingsApplyBar
          selectedCount={selected.length}
          total={state.remainingIndices.length}
          onToggleAll={toggleAll}
          onApply={() => {
            setApplied((prev) => [...new Set([...prev, ...selected])]);
            setSelected([]);
          }}
          readOnly={state.allApplied}
        />
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

/** The read-only prompt that produced the document — same row as the approvers strip, an
 *  eyebrow label over the prompt prose. Used where a document is an answer to a question
 *  (Explore's task detail) rather than something a team co-approves. */
function PromptRow() {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-5 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Prompt</span>
      <p className="text-sm leading-relaxed text-ink">
        How is the self-service demo backend configured and bootstrapped (config files, env vars, dependency
        injection, startup sequence)? Identify where a demo/offline mode toggle could be introduced to select a
        JSON-file data source instead of the database, and how config is currently validated.
      </p>
    </div>
  );
}

/**
 * The approvers row — the REAL `ParticipantStrip`, which is what this affordance declares as
 * its canonical component (`variant-meta.ts` → approvers → Participants.tsx).
 *
 * It used to hand-roll the whole thing: its own label, its own avatar loop with an inline
 * check overlay and opacity dimming, and its own ghost "Invite" button. So the page whose job
 * is to show the canonical component showed a copy of it — the same contradiction the
 * row-actions affordance above carries a comment about ("this was a bare button, i.e. the
 * picture contradicting the entry beside it"). The copy had already drifted: no tooltips, no
 * "Just you" empty state, and an Invite button that is a real picker in the component.
 */
const DEMO_APPROVERS: Participant[] = [
  { member: { id: 'xu', displayName: 'Xu Zheng', avatarTint: '#6A6F8C' }, approved: true },
  { member: { id: 'oa', displayName: 'Oscar A', avatarTint: '#9a6b4f' }, approved: true },
  { member: { id: 'bn', displayName: 'Ben N', avatarTint: '#5E7C6B' }, approved: false },
];

function ApproversRow() {
  return (
    <div className="border-b border-line px-5 py-3">
      <ParticipantStrip
        participants={DEMO_APPROVERS}
        pool={[{ id: 'new', displayName: 'Priya Nair', avatarTint: '#9A6A8C' }]}
        onAdd={() => {}}
      />
    </div>
  );
}

// ─── Per-pattern renders — thin wrappers that reuse the shared components with demo content ─

/** The canonical `AvatarPicker`, wired to throwaway state so the swatches are clickable. */
function AvatarPickerPreview() {
  const [tint, setTint] = useState(AVATAR_TINTS[0] as string);
  return <AvatarPicker initials="XU" value={tint} onChange={setTint} />;
}

/** The canonical `SearchInput`, wired to throwaway local state so the preview is typeable. */
function PreviewSearch({ label }: { label: string }) {
  const [q, setQ] = useState('');
  return <SearchInput label={label} value={q} onChange={setQ} />;
}

/** The real `FormPanel`, driven live by the affordance toggles. Holds throwaway state so the
 *  read→edit disclosure and the Validate round-trip are actually clickable in the preview. */
function FormPanelPreview({ on }: { on: ReadonlySet<string> }) {
  // Opens in its READ view, the way a settings card does on a real page: heading + status +
  // the saved value, with Edit to expand. `disclosure` is a prop rather than an affordance
  // (see variant-meta), so the preview simply demonstrates it instead of toggling it.
  const [open, setOpen] = useState(false);
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const fields = (
    <>
      <Field label="Display name">{(p) => <Input {...p} placeholder="Ada Lovelace" />}</Field>
      <Field label="Username" hint="your login — lowercase, no spaces">{(p) => <Input {...p} placeholder="ada" />}</Field>
    </>
  );

  const panel = (
    <FormPanel
      ariaLabel="Example form"
      onSubmit={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      disclosure={{
        open,
        // A concrete saved value — a vague placeholder makes the read view look empty
        // rather than informative, which is the whole point of the collapsed state.
        summary: 'http://127.0.0.1:7337',
        onEdit: () => setOpen(true),
      }}
      heading={on.has('heading') ? 'Section heading' : undefined}
      indicator={on.has('indicator') ? <Badge variant="sage" dot size="sm">connected</Badge> : undefined}
      leading={on.has('avatar') ? <Avatar initials="XU" tint={AVATAR_TINTS[0]} aria-hidden /> : undefined}
      validate={
        on.has('validate')
          ? {
              validating,
              result,
              onValidate: () => {
                setValidating(true);
                setResult(null);
                setTimeout(() => {
                  setValidating(false);
                  setResult({ ok: true, detail: 'Reached the service and authenticated.' });
                }, 600);
              },
            }
          : undefined
      }
    >
      {on.has('avatar') ? <AvatarPickerPreview /> : null}
      {on.has('twoColumn') ? <FieldGrid cols={2}>{fields}</FieldGrid> : <div className="flex flex-col gap-4">{fields}</div>}
    </FormPanel>
  );

  return panel;
}

const RENDERS: Record<string, (on: ReadonlySet<string>, activeTab?: string) => ReactNode> = {
  // The real DataTable. Affordances: search · filters (toolbar), bulk-select · row-actions (columns).
  table: (on) => (
    <Card>
      <CardContent className="flex flex-col p-0">
        {/* Header + toolbar share one bordered block above the grid: the title sits opposite
            the primary action, the search + filter strip sits under both. The toolbar is the
            shared `Toolbar` (ui/toolbar.tsx) with a `SearchInput` AND a filter `Select` — a
            search-only strip is a deviation. One table density, footer always shown. */}
        {on.has('header') || on.has('primaryAction') || on.has('toolbar') ? (
          <DataTableHeader
            title={on.has('header') ? 'Section title' : undefined}
            action={
              on.has('primaryAction') ? (
                <Button size="sm" leftIcon={<Plus />}>
                  New item
                </Button>
              ) : null
            }
          >
            {on.has('toolbar') ? (
              <Toolbar>
                <PreviewSearch label="rows" />
                <Select defaultValue="all">
                  <SelectTrigger aria-label="Filter" className={toolbarControlWidth}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                  </SelectContent>
                </Select>
              </Toolbar>
            ) : null}
          </DataTableHeader>
        ) : null}
        <DataTable columns={tableColumns(on)} data={TABLE_ROWS} />
      </CardContent>
    </Card>
  ),

  // Form as a PAGE — the settings/profile shell. Row-level forms live under Table.
  // The real FormPanel — one shell for every form. Toggles show the two switches that used
  // to look like separate components: `inline` (Card-less + tinted, for a DataTable row) and
  // `disclosure` (read view + Edit). Everything else is an additive slot.
  form: (on) => <FormPanelPreview on={on} />,

  // Shared List. Affordances: section header, expand arrow (row reveals its body), row leading
  // icon, trailing meta. When `expand` is on, each row carries a `body` and List draws the
  // left-side chevron + owns the open/close — the governed expandable-list behaviour.
  list: (on) => (
    <List
      sections={[
        {
          header: on.has('header') ? 'Section header' : undefined,
          rows: ['First item', 'Second item', 'Third item', 'Fourth item'].map((label, i) => ({
            id: String(i),
            leading: on.has('leadingIcon') ? <span className="size-8 shrink-0 rounded-md bg-surface-2" /> : undefined,
            primary: label,
            secondary: 'Supporting metadata',
            trailing: on.has('trailingMeta') ? <Badge variant="neutral" size="sm">meta</Badge> : undefined,
            body: on.has('expand') ? (
              <div className="rounded-[var(--r-md)] border border-line bg-surface-2/40 px-4 py-3 text-sm leading-relaxed text-ink-soft">
                The expanded content for {label} — the actual detail (e.g. a recall answer with its citations)
                shown in its own box inside the opened row.
              </div>
            ) : undefined,
            defaultOpen: on.has('expand') && i === 0,
          })),
        },
      ]}
    />
  ),

  // Shared DocumentShell — the active tab picks the body; each tab's own affordances apply.
  document: (on, activeTab) => {
    const tab = activeTab ?? 'document';
    // The row under the header: present when `approvers` is on, rendering either the
    // participant strip or — when `prompt` is on — the composer in its place.
    const approvers = on.has('approvers')
      ? on.has('prompt')
        ? <PromptRow />
        : <ApproversRow />
      : undefined;

    let body: ReactNode;
    let footer: ReactNode;
    if (tab === 'audit') {
      body = <AuditView showApplyBar={on.has('applyBar')} selectable={on.has('multiSelect')} />;
    } else if (tab === 'discussion') {
      body = (
        <div className="px-5 py-5">
          {on.has('thread') ? (
            <DiscussionThread messages={DEMO_DISCUSSION} memberById={demoMemberById} currentMemberId="me" mentionPool={DEMO_MEMBERS} />
          ) : null}
        </div>
      );
      footer = on.has('composer') ? (
        <ConversationComposer onSend={() => {}} voice mentionPool={DEMO_MEMBERS} rows={1} />
      ) : undefined;
    } else {
      body = <div className="px-5 py-5"><ProseBlock>{DOC_MARKDOWN}</ProseBlock></div>;
    }
    // The approve action belongs to the document tab whichever body it is showing — gating it
    // inside one branch made the toggle inert as soon as `prompt` was on.
    if (tab === 'document' && on.has('action')) {
      footer = (
        <div className="flex justify-end border-t border-line px-5 py-3">
          <ApproveButton />
        </div>
      );
    }

    return (
      <DocumentShell
        title="Document title"
        version={5}
        tabs={on.has('tabs') ? DOC_TABS : undefined}
        activeTab={tab}
        flush={tab === 'audit'}
        approvers={approvers}
        body={body}
        footer={footer}
      />
    );
  },

  // Shared StatCard grid. Affordances: header icon, card footer.
  statCard: (on) => (
    <StatCardGrid>
      {['First metric', 'Second metric'].map((t, i) => (
        <StatCard
          key={t}
          icon={on.has('icon') ? <Activity /> : undefined}
          title={t}
          // Uneven row counts on purpose: this is what proves the cards keep their own
          // height instead of stretching to the tallest in the row.
          rows={i === 0 ? STAT_ROWS : STAT_ROWS.slice(0, 2)}
          footer={on.has('footer') ? { label: 'Total', value: '128' } : undefined}
        />
      ))}
    </StatCardGrid>
  ),

  // Shared SelectableTile grid. Affordances: tile icon (flips to check), meta row.
  selectableTile: (on) => (
    <div className="flex flex-col gap-4">
      {on.has('toolbar') ? (
        <Toolbar>
          <PreviewSearch label="tiles" />
          <Select defaultValue="all">
            <SelectTrigger aria-label="Filter" className={toolbarControlWidth}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
            </SelectContent>
          </Select>
        </Toolbar>
      ) : null}
      <SelectableTileGrid on={on} />
    </div>
  ),
};

/**
 * The tile grid, wired to throwaway state. It was static — `selected` hardcoded per tile and
 * no `onClick` — so `SelectableTile`'s `aria-pressed` button announced a toggle that did
 * nothing when clicked, and the affordance the pattern exists for (picking a subset) could
 * not be seen. Every other interactive preview in this file holds local state for exactly
 * this reason; this one was the exception.
 */
function SelectableTileGrid({ on }: { on: ReadonlySet<string> }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(['First option']));
  const toggle = (t: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {['First option', 'Second option', 'Third option'].map((t) => (
        <SelectableTile
          key={t}
          selected={picked.has(t)}
          onClick={() => toggle(t)}
          icon={on.has('icon') ? <Square className="size-4" /> : undefined}
          title={t}
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
  );
}

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
