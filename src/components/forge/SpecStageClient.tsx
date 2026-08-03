'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useMmaDispatch, type MmaDispatchState } from '@/hooks/useMmaDispatch';
import { useServerState } from '@/hooks/useServerState';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useMutation } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  ArrowRight,
  Lightbulb,
  Pencil,
  Plus,
  BookOpen,
  Target,
  Flag,
  Blocks,
  GitBranch,
  AlertTriangle,
  FlaskConical,
  ListTodo,
  Loader2,
  Shield,
  RotateCcw,
  type LucideIcon } from 'lucide-react';
import { DocumentShell, type DocumentShellTab } from '@/components/patterns/document-shell';
import { StageShell } from '@/components/patterns/stage-shell';
import { SelectableTile } from '@/components/patterns/cards';
import { ProseBlock } from '@/components/patterns/prose-block';
import { RailNote } from '@/components/patterns/feature-rail';
import { RoleChip } from '@/components/forge/RoleChip';
import { useRouter } from 'next/navigation';
import { stagePhaseStore, useStagePhaseUrl } from '@/components/forge/stage-substeps';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { ConversationComposer } from '@/components/patterns/conversation';
import { showToast } from '@/components/ui/toast';
import { FindingsGrid, FindingsApplyBar, AuditRoundCard as PatternAuditRoundCard, type Finding } from '@/components/patterns/findings';
import { AutomationBar } from '@/components/forge/AutomationBar';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Banner,
  SearchInput,
  Text,
  TextSm } from '@/components/ui';
import { cn } from '@/lib/cn';
import { COMPONENT_TEMPLATES, DOC_TEMPLATES, type DocTemplate } from '@/spec/components';
import { ParticipantStrip, ApproverCluster } from '@/components/forge/collab/Participants';
import { DiscussionThread } from '@/components/forge/collab/DiscussionThread';
import {
  addParticipant,
  recordApproval,
  hasApproved,
  pending as pendingParticipants } from '@/collab/section-approval';
import type { ComponentView } from '@/spec/spec-core';
import type { MemberRef, UnitCollab, DiscussionMsg, Participant } from '@/collab/types';
import type { ComponentKind, ProjectPhase } from '@/db/enums';
import { isForgeMention } from '@/spec/forge-mention';
import { FORGE_DISPLAY_NAME, FORGE_AVATAR_TINT } from '@/automation/forge-member';
import { localId } from '@/lib/local-id';
import { responseError } from '@/lib/err';

/**
 * `SpecStageClient` — the spec stage client island. Three phases:
 * outline (pick components + intent), craft (auto-draft + collaborative Q&A
 * per component), finalize (assemble spec + audit + apply fixes + freeze).
 */

/**
 * One row in the audit-pass timeline ("pass 1: 2 findings → revised") — the CLIENT
 * narrowing of `spec/audit-loop`'s row.
 * Findings use the canonical `Finding` contract, so no field-by-field remap is needed.
 */
export interface AuditPassView {
  passNo: number;
  findingsCount: number;
  verdict: 'clean' | 'revised';
  findings?: Finding[];
  applied?: boolean;
  /** WHICH findings were applied. Marks only those rows, leaving the rest selectable so a
   *  partial apply can be finished — the whole-round `applied` boolean cannot express that. */
  appliedIndices?: number[];
}

interface SpecStageClientProps {
  projectId: string;
  projectName: string;
  intentMd: string | null;
  phase: ProjectPhase;
  mainTierReady: boolean;
  mmaReady: boolean;
  defaultKinds: ComponentKind[];
  initialComponents: ComponentView[];
  initialSpec: { version: number; bodyMd: string } | null;
  initialAuditHistory: AuditPassView[];
  /** The signed-in member — drives "you" attribution and approvals. */
  currentMember: MemberRef;
  /** Teammates who can be @-mentioned into a section for co-approval. */
  projectMembers?: MemberRef[];
  /** Persisted qa_messages per sectionId — loaded from DB on page render. */
  initialMessages?: Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId?: string | null }>>;
  /** Whether OpenAI transcription key is configured — enables voice input. */
  voiceEnabled?: boolean;
  /** In-flight auto-draft batch ID (from DB on page load). */
  pendingAutoDraft?: string | null;
  /** In-flight audit-apply batch ID (from DB on page load). */
  pendingApply?: string | null;
  specApprovers?: string[];
  /** URL-persisted initial phase (outline/craft/finalize). */
  initialPhase?: 'outline' | 'craft' | 'finalize';
  readOnly?: boolean;
  /** Why the stage is read-only — shown by AutomationBar. */
  lockedReason?: string;
}

type SpecPhase = 'outline' | 'craft' | 'finalize';

const KIND_ICON: Record<ComponentKind, LucideIcon> = {
  context: BookOpen,
  problem: Target,
  goals_requirements: Flag,
  alternatives: GitBranch,
  technical_design: Blocks,
  testing_plan: FlaskConical,
  risks: AlertTriangle,
  stories_tasks: ListTodo };

/** True when the picked set exactly equals a template's component set. */
function sameKinds(picked: Set<ComponentKind>, kinds: ComponentKind[]): boolean {
  return picked.size === kinds.length && kinds.every((k) => picked.has(k));
}

/** Resolve the active template id for the current selection ('custom' if none). */
function matchTemplate(picked: Set<ComponentKind>, templates: readonly DocTemplate[]): string {
  return templates.find((t) => sameKinds(picked, t.kinds))?.id ?? 'custom';
}

interface KindCard {
  kind: ComponentKind;
  label: string;
  roles: string[];
  sections: string[];
  default: boolean;
}

const KIND_CARDS: KindCard[] = COMPONENT_TEMPLATES.map((t) => ({
  kind: t.kind,
  label: t.label,
  roles: t.primaryRoles,
  sections: t.sections.map((s) => s.label),
  default: t.default }));

/** Distinct disciplines across the component library — the role filter chips. */
const ALL_ROLES: string[] = [...new Set(KIND_CARDS.flatMap((c) => c.roles))];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}) });
  if (!res.ok) {
    throw new Error(await responseError(res, `Request failed (${res.status}).`));
  }
  return res.json() as Promise<T>;
}

export function SpecStageClient(props: SpecStageClientProps) {
  const router = useRouter();
  const readOnly = props.readOnly ?? false;
  const lockedReason = props.lockedReason;
  // Components are client-owned (plain useState), NOT RSC-synced. A `router.refresh()`
  // (needed after an advance so the server-rendered layout stepper updates) must not reset
  // this list to a stale RSC snapshot — the "No components yet" blank-view bug. Every
  // component update instead flows through `refreshComponents()` (a direct fetch).
  const [components, setComponents] = useState<ComponentView[]>(props.initialComponents);
  const [spec, setSpec] = useServerState(props.initialSpec);
  const [messages] = useServerState(props.initialMessages ?? {});
  const [specApprovers, setSpecApprovers] = useServerState(props.specApprovers ?? []);
  const [error, setError] = useState<string | null>(null);
  // Intent carried forward from the Exploration brief (no longer hand-typed here). Plain
  // derivation, not `useState`: nothing sets it, and holding it in state only froze the
  // mount-time value so a refreshed intent would never reach the outline.
  const intent = props.intentMd ?? '';
  const [picked, setPicked] = useState<Set<ComponentKind>>(
    () => new Set(components.length > 0 ? components.map((c) => c.kind) : props.defaultKinds),
  );
  const derivedPhase: SpecPhase = components.length === 0 ? 'outline' : spec ? 'finalize' : 'craft';
  const canReach = (p: SpecPhase): boolean => {
    if (p === 'outline') return true;
    if (p === 'craft') return components.length > 0;
    if (p === 'finalize') return components.length > 0;
    return false;
  };
  const safeInitial = props.initialPhase && canReach(props.initialPhase) ? props.initialPhase : undefined;
  const [phase, setPhaseRaw] = useState<SpecPhase>(safeInitial ?? derivedPhase);

  const setPhase = (p: SpecPhase) => {
    setPhaseRaw(p);
    // Persist the phase in the URL WITHOUT a soft navigation. A `router.push`
    // here kicks off an RSC fetch that can be served from the client router cache
    // captured while the phase had 0 components — which then races with, and can
    // clobber, the explicit `router.refresh()` callers run after a transition,
    // leaving a blank "No components yet" view until a hard reload. Updating the
    // URL only (like the Explore stage does) makes `router.refresh()` the single,
    // deterministic source of fresh data.
    const url = new URL(window.location.href);
    url.searchParams.set('phase', p);
    window.history.replaceState(null, '', url.pathname + url.search);
  };
  /**
   * Spec phase status gates the resolver (finalize.status==='active' runs the audit loop),
   * so the advance goes through the unified engine as advance_phase.
   *
   * A REJECTED advance must not move the view. This caught the rejection, toasted, and then
   * switched the phase anyway — leaving the stepper and the URL on a phase the server had
   * not entered, showing UI the resolver would not service (no audit loop, no automation)
   * with only a toast, already scrolled away, to explain it. The Explore stage states this
   * rule outright at its own advance; Spec and Plan both broke it.
   */
  const advancePhase = async (p: SpecPhase): Promise<boolean> => {
    try {
      await mma.transition('advance_phase');
    } catch {
      showToast({ type: 'error', message: 'Couldn’t advance the phase — try again.' });
      return false;
    }
    setPhase(p);
    return true;
  };
  // Wrap refresh in a transition so callers can show a loading state while the
  // fresh RSC data (e.g. the freshly-created components after "Continue to
  // Craft") is being fetched — instead of flashing an empty view.
  const [isRefreshing, startRefreshTransition] = useTransition();
  const refresh = useCallback(() => { startRefreshTransition(() => router.refresh()); }, [router]);
  // Load spec components with a DIRECT client fetch (the Explore stage's pattern) rather
  // than router.refresh() — the RSC round-trip races the Outline→Craft phase switch and
  // can serve a stale 0-component snapshot ("No components yet" until a hard reload). All
  // component-data updates (confirm, auto-draft, refine, server push) route through here.
  const refreshComponents = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${props.projectId}/spec/components`);
      if (r.ok) setComponents((await r.json()) as ComponentView[]);
    } catch {
      /* a later event/refresh reconciles */
    }
  }, [props.projectId, setComponents]);
  const mma = useMmaDispatch(props.projectId, {
    onDone: {
      'spec-auto-draft': () => void refreshComponents(),
      'spec-refine': () => void refreshComponents(),
      'spec-audit': refresh },
    events: {
      'spec.updated': () => void refreshComponents(),
      'chat.message': (data) => {
        window.dispatchEvent(new CustomEvent('chat:message', { detail: data }));
      } } });

  const needsAutoDraft = components.length > 0 && components.some(
    (c) => c.status === 'gathering' && c.sections.some((s) => !s.draftMd),
  );
  const autoDrafting = !!props.pendingAutoDraft || mma.busyHandlers.has('spec-auto-draft');
  const autoDraftFired = useRef(false);

  // Auto-trigger drafting when landing on craft with undrafted sections.
  useEffect(() => {
    if (phase !== 'craft') return;
    if (!needsAutoDraft) return;
    if (autoDrafting) return;
    if (autoDraftFired.current) return;
    autoDraftFired.current = true;
    setError(null);
    // Correct hook signature is dispatch(url, handler, body?) — mirror the existing HEAD call.
    void mma.dispatch(`/api/projects/${props.projectId}/spec/auto-draft`, 'spec-auto-draft')
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Auto-draft failed.'));
  }, [phase, needsAutoDraft, autoDrafting, mma, props.projectId]);

  // Publish the live sub-phase to the stepper (Outline · Craft · Finalize).
  useStagePhaseUrl(phase);
  // Let the stepper's sub-phase chips jump back to a phase (Craft/Finalize need a confirmed outline).
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'outline' || key === 'craft' || key === 'finalize') {
          setPhase(key as SpecPhase);
        }
      }),
    [],
  );

  const allApproved = components.length > 0 && components.every((c) => c.status === 'approved' || (c.approvedBy as string[]).length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="spec-stage">
      {!props.mmaReady ? (
        <Banner
          variant="warning"
          title="The MMA token is not configured."
          description={
            <>
              <a href="/settings/connections" className="font-medium underline">
                Configure the MMA token
              </a>{' '}
              to start the Q&amp;A.
            </>
          }
        />
      ) : null}
      {!props.mainTierReady ? (
        <Banner
          variant="warning"
          title="The main tier is not configured."
          description={
            <>
              <a href="/settings/models" className="font-medium underline">
                Configure the main tier in Team Settings
              </a>{' '}
              to start the Q&amp;A.
            </>
          }
        />
      ) : null}
      {error ? <TextSm role="alert" className="shrink-0 !text-[var(--rose)]">{error}</TextSm> : null}

      <AutomationBar
        disabled={readOnly || phase !== 'finalize'}
        idleHint={
          phase === 'finalize'
            ? 'Spec is ready — let Forge finalize it and run Plan → Build → Journal to the end.'
            : 'Automation unlocks at the Finalize phase — Outline & Craft are hand-authored.'
        }
        projectId={props.projectId}
        lockedReason={lockedReason}
      />

      {/* BODY — every phase carries its own rails; no top status row. */}
      {phase === 'outline' ? (
        <OutlineStage
          intent={intent}
          picked={picked}
          onPick={setPicked}
          templates={DOC_TEMPLATES}
          existing={components}
          readOnly={readOnly}
          mma={mma}
          onConfirmed={async () => {
            // select_components created the components server-side. Advance the phase, then
            // load the fresh components with a DIRECT client fetch, and only THEN switch the
            // view — so Craft renders already populated. This deliberately does NOT use
            // router.refresh(): that RSC round-trip raced the phase switch + replaceState and
            // served a stale 0-component snapshot, leaving a blank "No components yet" view.
            let advanced = true;
            try {
              await mma.transition('advance_phase');
            } catch {
              showToast({ type: 'error', message: 'Couldn’t advance the phase — try again.' });
              advanced = false;
            }
            // The components exist either way (`select_components` already created them), so
            // load them regardless — but only MOVE if the server actually advanced. Outline
            // then shows the confirmed set, and its own "Continue" is the way forward.
            await refreshComponents();
            if (advanced) setPhase('craft');
            // Re-render the server layout so its stepper reflects the advance (Outline → done,
            // Craft → active). Safe now that components are client-owned: this refresh updates
            // the layout + other RSC props WITHOUT resetting the freshly-fetched component list.
            refresh();
          }}
          // Outline already confirmed & locked server-side (components exist) — the
          // Continue button just moves the VIEW to Craft; re-dispatching
          // select_components would be rejected ("not allowed now") since outline is done.
          onGoToCraft={() => setPhase('craft')}
          onError={setError}
        />
      ) : phase === 'craft' ? (
        <CraftStage
          projectId={props.projectId}
          components={components}
          loading={isRefreshing}
          readOnly={readOnly}
          autoDrafting={autoDrafting}
          allApproved={allApproved}
          currentMember={props.currentMember}
          projectMembers={props.projectMembers ?? []}
          initialMessages={messages}
          voiceEnabled={props.voiceEnabled ?? false}
          mma={mma}
          onPatch={(id, patch) =>
            setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
          }
          onEditOutline={() => setPhase('outline')}
          onConsolidate={() => advancePhase('finalize')}
        />
      ) : (
        <DocumentScreen
          projectId={props.projectId}
          projectName={props.projectName}
          spec={spec}
          allApproved={allApproved}
          readOnly={readOnly}
          mmaReady={props.mmaReady}
          initialAuditHistory={props.initialAuditHistory}
          pendingApply={props.pendingApply}
          mma={mma}
          currentMember={props.currentMember}
          projectMembers={props.projectMembers ?? []}
          components={components}
          specApprovers={specApprovers}
          setSpecApprovers={setSpecApprovers}
          onAssembled={(v) => setSpec(v)}
          onError={setError}
        />
      )}
    </div>
  );
}

/** Flow navigation for the sections/document phases (not tabs — natural forward/back). */
const SPEC_PHASE_NOTES: Record<string, string> = {
  outline: `### Outline — pick your components

- **Select** which sections to include (context, goals, technical design, etc.)
- **Templates** — presets for common project types
- **Confirm** — locks the skeleton and starts AI-guided drafting

### What happens next

- Forge auto-drafts every section from the exploration brief
- You refine each section through Q&A conversation`,

  craft: `### Craft — shape each section

- **Spec/Discussion** toggle to view the draft or discuss with the team
- **@Forge** in the discussion to refine the section with AI
- **Approve** each section when the draft matches your intent
- **Invite** teammates to review and co-approve

### Approval flow

- All sections approved → Finalize phase unlocks`,

  finalize: `### Finalize — assemble & audit

- **Construct** — all approved sections assemble into one spec document
- **Audit** — MMA checks for gaps, contradictions, and missing detail
- **Apply fixes** — audit findings auto-revise the spec section by section

### When to advance

- Audit must pass clean (no critical or high findings)
- All approvers confirmed → Continue to Plan unlocks` };

function SpecNote({ phase }: { phase: string }) {
  return <RailNote icon={<Lightbulb />}>{SPEC_PHASE_NOTES[phase] ?? SPEC_PHASE_NOTES.outline}</RailNote>;
}

/* ── Outline screen ─────────────────────────────────────────────────────── */

function OutlineStage({
  intent,
  picked,
  onPick,
  templates,
  existing,
  readOnly,
  mma,
  onConfirmed,
  onGoToCraft,
  onError }: {
  intent: string;
  picked: Set<ComponentKind>;
  onPick: (s: Set<ComponentKind>) => void;
  templates: readonly DocTemplate[];
  existing: ComponentView[];
  readOnly: boolean;
  mma: MmaDispatchState;
  onConfirmed: () => void;
  onGoToCraft: () => void;
  onError: (m: string | null) => void;
}) {
  const active = matchTemplate(picked, templates);
  // The outline is locked once confirmed (server marks outline done + craft active).
  // In that state select_components is rejected, so Continue just navigates forward.
  const alreadyConfirmed = existing.length > 0;

  const confirm = useMutation({
    mutationFn: () => mma.transition('select_components', { kinds: [...picked], intentMd: intent }),
    onSuccess: () => {
      onError(null);
      onConfirmed();
    },
    onError: (e: Error) => onError(e.message) });

  function toggle(kind: ComponentKind): void {
    if (readOnly) return;
    const next = new Set(picked);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onPick(next);
  }

  const valid = intent.trim() !== '' && picked.size > 0;
  /**
   * WHY Continue is disabled. Both gates are invisible from this screen: the intent is
   * carried from the Exploration brief and is not editable here, and an empty selection is
   * only obvious if you notice the count on the Custom row. `projects-core` already names
   * the missing-intent case as one that leaves the outline "permanently stuck with no UI to
   * unblock them" — it seeds intent for subset projects for exactly that reason. A disabled
   * button that does not say why is the same dead end with fewer clues.
   */
  const blockedReason = readOnly || valid
    ? null
    : intent.trim() === ''
      ? 'This spec needs the exploration brief — it carries the intent the outline is built from.'
      : 'Pick at least one component to include.';

  const [compQuery, setCompQuery] = useState('');
  const [tplQuery, setTplQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const cq = compQuery.trim().toLowerCase();
  const shownKinds = KIND_CARDS.filter((c) => {
    const textOk = !cq || `${c.label} ${c.roles.join(' ')} ${c.sections.join(' ')}`.toLowerCase().includes(cq);
    const roleOk = roleFilter.size === 0 || c.roles.some((r) => roleFilter.has(r));
    return textOk && roleOk;
  });
  function toggleRole(role: string): void {
    setRoleFilter((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }
  const tq = tplQuery.trim().toLowerCase();
  const shownTemplates = tq
    ? templates.filter((t) => `${t.label} ${t.description}`.toLowerCase().includes(tq))
    : templates;

  return (
    <StageShell
      note={<SpecNote phase="outline" />}
      navigator={
        // Rail keeps its own box: its rows are bespoke components, not NavItems.
        <>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Template</CardTitle>
          </CardHeader>
          <div className="shrink-0 border-b border-line px-5 py-3">
            <SearchInput label="templates" value={tplQuery} onChange={setTplQuery} className="min-w-0" />
          </div>
          {/* A radiogroup, not a row of toggles: exactly one template is active at a time.
              `aria-pressed` announced each row as an independent on/off button, so a screen
              reader never conveyed "1 of N". Matches how `Segmented` and `AvatarPicker`
              already model a single choice. */}
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
            {/* Scoped to the options only. The "Custom" row below is a STATUS indicator —
                it has no onClick; you reach custom by toggling components — so it is not one
                of the group's choices. */}
            <div role="radiogroup" aria-label="Spec template" className="space-y-2">
              {shownTemplates.map((t) => (
                <TemplateRow
                  key={t.id}
                  label={t.label}
                  description={t.description}
                  count={t.kinds.length}
                  selected={active === t.id}
                  disabled={readOnly}
                  onClick={() => onPick(new Set(t.kinds))}
                />
              ))}
            </div>

            {/* Custom — active when the selection matches no template */}
            <div
              className={cn(
                'rounded-[var(--r-md)] border px-3 py-2.5 transition-colors',
                active === 'custom' ? 'border-accent bg-accent-tint/25' : 'border-line bg-surface',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded-full border',
                    active === 'custom' ? 'border-accent bg-accent' : 'border-line-strong',
                  )}
                >
                  {active === 'custom' ? <span className="size-1.5 rounded-full bg-white" /> : null}
                </span>
                <Pencil className="size-3.5 text-ink-faint" />
                <span className="font-medium text-ink">Custom</span>
                <span className="flex-1" />
                <Badge variant="neutral" size="sm">
                  {picked.size} comp
                </Badge>
              </div>
              {active === 'custom' ? null : (
                <p className="mt-1 pl-6 text-xs text-ink-faint">Toggle components to make your own.</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            {blockedReason && !alreadyConfirmed ? (
              <TextSm role="status" className="!text-xs !text-ink-soft">{blockedReason}</TextSm>
            ) : null}
            {/* Outline→Craft is a PHASE advance inside Spec, so it's the accent Button its
                peers use ("Continue to Finalize" / "Validate" / "Implement") — not the ink
                StageAdvance, which is reserved for crossing a stage boundary. */}
            <Button
              className="w-full"
              onClick={() => (alreadyConfirmed ? onGoToCraft() : confirm.mutate())}
              disabled={readOnly || (!alreadyConfirmed && !valid)}
              loading={confirm.isPending}
              rightIcon={<ArrowRight />}
              data-testid="outline-continue"
            >
              {confirm.isPending ? 'Drafting…' : 'Continue to Craft'}
            </Button>
          </CardFooter>
        </Card>
        </>
      }
    >
      {/* CENTRE — the component-card picker (the spec skeleton) */}
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>Spec outline</CardTitle>
          </div>
        </CardHeader>
        <div className="shrink-0 space-y-2.5 border-b border-line px-5 py-3">
          <SearchInput label="components" value={compQuery} onChange={setCompQuery} className="min-w-0" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Role</span>
            {ALL_ROLES.map((r) => {
              const on = roleFilter.has(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleRole(r)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                    on
                      ? 'border-accent bg-accent text-white'
                      : 'border-line bg-surface text-ink-soft hover:border-line-strong',
                  )}
                >
                  {r}
                </button>
              );
            })}
            {roleFilter.size > 0 ? (
              <button
                type="button"
                onClick={() => setRoleFilter(new Set())}
                className="text-[11px] font-medium text-accent transition-opacity hover:opacity-70"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <CardContent className="min-h-0 flex-1 overflow-y-auto !py-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shownKinds.map((c) => {
              const Icon = KIND_ICON[c.kind];
              return (
                <SelectableTile
                  key={c.kind}
                  selected={picked.has(c.kind)}
                  disabled={readOnly}
                  onClick={() => toggle(c.kind)}
                  icon={<Icon className="size-4" />}
                  title={c.label}
                  meta={
                    <>
                      {c.roles.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {c.roles.map((r) => (
                            <RoleChip key={r} role={r} />
                          ))}
                        </span>
                      ) : null}
                      <p className="text-xs leading-relaxed text-ink-soft">
                        <span className="font-medium text-ink">{c.sections.length} sections</span>
                        <span className="text-ink-faint">
                          {' · '}
                          {c.sections.slice(0, 3).join(' · ')}
                          {c.sections.length > 3 ? ' …' : ''}
                        </span>
                      </p>
                    </>
                  }
                />
              );
            })}
          </div>
          {shownKinds.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-faint">No components match your filter.</p>
          ) : null}
        </CardContent>
      </Card>

    </StageShell>
  );
}

/** One selectable template row in the picker. */
function TemplateRow({
  label,
  description,
  count,
  selected,
  disabled,
  onClick }: {
  label: string;
  description: string;
  count: number;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      disabled={disabled}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'focus-ring flex w-full flex-col gap-1 rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-accent bg-accent-tint/25' : 'border-line bg-surface hover:border-line-strong',
        disabled && 'cursor-default',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'grid size-4 shrink-0 place-items-center rounded-full border',
            selected ? 'border-accent bg-accent' : 'border-line-strong',
          )}
        >
          {selected ? <span className="size-1.5 rounded-full bg-white" /> : null}
        </span>
        <span className="font-medium text-ink">{label}</span>
        <span className="flex-1" />
        <Badge variant="neutral" size="sm">
          {count} comp
        </Badge>
      </div>
      <p className="pl-6 text-xs text-ink-faint">{description}</p>
    </button>
  );
}

/* ── Craft stage — the per-component Q&A conversation (the soul) ───────────── */

interface DisplayState { label: string; cls: string }

/**
 * A spec component's discussion is "refining" when the local set knows it, OR a `spec-refine`
 * batch is in flight per the server-reconstructed busy handlers — the latter keeps the "Forge
 * is thinking" bubble + composer-lock alive across navigation. Mirrors PlanStageClient.isTaskRefining.
 */
export function isComponentRefining(
  id: string,
  refining: ReadonlySet<string>,
  busyHandlers: ReadonlySet<string>,
): boolean {
  return refining.has(id) || busyHandlers.has('spec-refine');
}

function componentDisplayState(c: ComponentView): DisplayState {
  if (c.status === 'approved' || (c.approvedBy as string[]).length > 0)
    return { label: 'Approved', cls: 'bg-sage-tint text-[var(--sage-deep)]' };
  if (c.status === 'drafted') {
    // Drafted components arrive Ready. They flip to "Needs input" only when Forge
    // raises a clarifying question during the Q&A (aiSatisfied=false).
    return c.aiSatisfied
      ? { label: 'Ready', cls: 'bg-sage-tint text-[var(--sage-deep)]' }
      : { label: 'Needs input', cls: 'bg-amber-tint text-[var(--amber)]' };
  }
  return { label: 'Drafting...', cls: 'bg-surface-2 text-ink-soft' };
}

function CraftStage({
  projectId,
  components,
  loading,
  readOnly,
  allApproved,
  autoDrafting,
  currentMember,
  projectMembers,
  initialMessages,
  voiceEnabled,
  mma,
  onPatch,
  onEditOutline,
  onConsolidate }: {
  projectId: string;
  components: ComponentView[];
  loading?: boolean;
  readOnly: boolean;
  allApproved: boolean;
  autoDrafting?: boolean;
  currentMember: MemberRef;
  projectMembers: MemberRef[];
  initialMessages: Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId?: string | null }>>;
  voiceEnabled: boolean;
  mma: MmaDispatchState;
  onPatch: (id: string, patch: Partial<ComponentView>) => void;
  onEditOutline: () => void;
  onConsolidate: () => void;
}) {
  const optimistic = useOptimisticAction();
  const firstOpen = components.find((c) => c.status !== 'approved') ?? components[0];
  const [activeId, setActiveId] = useState<string | null>(firstOpen?.id ?? null);
  const activeIdRef = useRef(activeId);
  // eslint-disable-next-line react-hooks/refs -- intentional: mirror latest activeId into a ref so long-lived handlers read it without re-subscribing
  activeIdRef.current = activeId;
  const [input, setInput] = useState('');
  // Per-component: null = dialogue, string = showing fetched draft markdown
  const [constructedDrafts, setConstructedDrafts] = useState<Record<string, string>>({});
  const [refiningComponents, setRefiningComponents] = useState<Set<string>>(new Set());
  // A component is "refining" when the local set knows it, OR a spec-refine batch is in flight
  // per the server-reconstructed busy handlers — the latter is what makes the "Forge is thinking"
  // bubble + composer-lock SURVIVE navigation (the local set is lost on unmount; busyHandlers
  // rehydrates from /pending-handlers). Mirrors PlanStageClient's isTaskRefining.
  const componentRefining = (id: string): boolean =>
    isComponentRefining(id, refiningComponents, mma.busyHandlers);

  // Rebuild drafts from components whenever they change (server re-render after MMA completes)
  useEffect(() => {
    if (autoDrafting) return;
    const drafts: Record<string, string> = {};
    for (const c of components) {
      if (c.status !== 'drafted' && c.status !== 'approved') continue;
      const md = c.sections.filter((s) => s.draftMd).map((s) => s.draftMd!).join('\n\n');
      if (md) drafts[c.id] = md;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rebuild drafts from server components after each MMA re-render
    setConstructedDrafts(drafts);
  }, [components, autoDrafting]);
  // Collaborative state per component (participants + group chat), seeded by kind.
  const [collab, setCollab] = useState<Record<string, UnitCollab>>(() => {
    const out: Record<string, UnitCollab> = {};
    const allPool = [currentMember, ...projectMembers];
    for (const c of components) {
      const dbMessages = initialMessages[c.id] ?? [];
      const dbDiscussion: DiscussionMsg[] = dbMessages.map((m) => ({
        id: m.id,
        authorId: m.sender === 'forge' ? 'forge' : (m.authorId ?? 'unknown'),
        body: m.bodyMd }));
      const approvers = c.approvedBy as string[];
      const meApproved = approvers.includes(currentMember.id);
      const participants: Participant[] = [
        { member: currentMember, approved: meApproved },
      ];
      for (const pid of (c.participantIds ?? []) as string[]) {
        if (pid === currentMember.id) continue;
        const m = allPool.find((p) => p.id === pid);
        if (m) participants.push({ member: m, approved: approvers.includes(pid) });
      }
      for (const aid of approvers) {
        if (!participants.some((p) => p.member.id === aid)) {
          const approver = allPool.find((m) => m.id === aid);
          if (approver) participants.push({ member: approver, approved: true });
        }
      }
      out[c.id] = { participants, discussion: dbDiscussion };
    }
    return out;
  });
  // Re-seed participants when server data changes (approval, invite via SSE refresh)
  // Keep discussion intact — only update participants from DB.
  const prevComponentsRef = useRef(components);
  useEffect(() => {
    if (prevComponentsRef.current === components) return;
    prevComponentsRef.current = components;
    const allPool = [currentMember, ...projectMembers];
    setCollab((prev) => {
      const next = { ...prev };
      for (const c of components) {
        const approverList = c.approvedBy as string[];
        const meApproved = approverList.includes(currentMember.id);
        const participants: Participant[] = [
          { member: currentMember, approved: meApproved },
        ];
        for (const pid of (c.participantIds ?? []) as string[]) {
          if (pid === currentMember.id) continue;
          const m = allPool.find((p) => p.id === pid);
          if (m) participants.push({ member: m, approved: approverList.includes(pid) });
        }
        for (const aid of approverList) {
          if (!participants.some((p) => p.member.id === aid)) {
            const approver = allPool.find((m) => m.id === aid);
            if (approver) participants.push({ member: approver, approved: true });
          }
        }
        const old = prev[c.id];
        const keepDiscussion = c.status !== 'gathering';
        next[c.id] = { participants, discussion: keepDiscussion ? (old?.discussion ?? []) : [] };
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys off `components` only; the previous map is read via the functional updater, so it is not a dependency
  }, [components]);

  // Real-time chat: listen for chat.message SSE events and append to discussion
  // Seed from initial messages AND from current collab state (covers re-renders)
  const seenMsgIds = useRef(new Set<string>());
  useEffect(() => {
    // Seed the dedup set on (re)mount from the initial payload + seeded collab,
    // INSIDE the effect — never mutate a ref during render (that both races with
    // SSE events arriving before mount and, on remount, carries a stale set that
    // would silently drop re-delivered messages). Clearing first gives every
    // mount a correct baseline.
    seenMsgIds.current.clear();
    for (const msgs of Object.values(initialMessages)) {
      for (const m of msgs) seenMsgIds.current.add(m.id);
    }
    for (const u of Object.values(collab)) {
      for (const d of u.discussion) seenMsgIds.current.add(d.id);
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        scope?: 'spec_component' | 'spec_project' | 'plan_task';
        targetId?: string;
        message?: { id: string; sender: string; authorId: string; authorName: string; bodyMd: string };
      } | undefined;
      if (detail?.scope !== 'spec_component' || !detail.targetId || !detail.message) return;
      const cid = detail.targetId;
      const msg = detail.message;
      // Skip own messages — sender already has them from optimistic append.
      // This eliminates the race between SSE echo and POST response.
      if (msg.authorId === currentMember.id) return;
      if (seenMsgIds.current.has(msg.id)) return;
      seenMsgIds.current.add(msg.id);
      setCollab((prev) => {
        const u = prev[cid] ?? { participants: [], discussion: [] };
        if (u.discussion.some((d) => d.id === msg.id)) return prev;
        return {
          ...prev,
          [cid]: {
            ...u,
            discussion: [...u.discussion, { id: msg.id, authorId: msg.authorId, body: msg.bodyMd }] } };
      });
      if (msg.authorId === 'forge') {
        setRefiningComponents((prev) => { const next = new Set(prev); next.delete(cid); return next; });
      }
    };
    // There was a `chat:typing` listener here that toggled `refiningComponents` and
    // switched the craft view to the conversation. NOTHING ever published `chat.typing`,
    // so neither effect could fire — a per-component "Forge is typing" state the server
    // had no way to enter. Removed with the event.
    window.addEventListener('chat:message', handler);
    return () => {
      window.removeEventListener('chat:message', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: attach window listeners once on mount; referenced values are read via refs/stable callbacks
  }, []);

  const [nudge, setNudge] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // When a section gets drafted (Construct), bring the freshly-built draft into
  // view — otherwise it lands below the fold and the click feels like a no-op.
  const draftedNow = activeId
    ? components.find((c) => c.id === activeId)?.status === 'drafted' ||
      components.find((c) => c.id === activeId)?.status === 'approved'
    : false;
  useEffect(() => {
    if (draftedNow) draftRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [draftedNow, activeId]);

  // Approval is explicit — the user clicks Approve, which calls the nod endpoint.
  // No client-side auto-approve from collab state.

  const active = components.find((c) => c.id === activeId) ?? null;
  const approvedCount = components.filter((c) => c.status === 'approved' || (c.approvedBy as string[]).length > 0).length;

  // Auto-construct the draft for any component that has sections with content.
  // The toggle lets users switch between Spec and Discussion views.
  /** Resolve a member id for attribution (you · pool · any seeded participant). */
  function memberById(id: string): MemberRef | undefined {
    if (id === currentMember.id) return currentMember;
    return (
      projectMembers.find((m) => m.id === id) ??
      Object.values(collab)
        .flatMap((u) => u.participants)
        .find((p) => p.member.id === id)?.member
    );
  }

  // Spec/Discussion toggle — these hooks MUST run unconditionally, before the
  // `if (!active)` early return below, or hook order changes between renders
  // (rules of hooks). Their inputs are computed defensively for the null case.
  const [craftViewOverride, setCraftViewOverride] = useState<Record<string, 'spec' | 'conversation'>>({});
  const setCraftView = useCallback((v: 'spec' | 'conversation') => {
    setCraftViewOverride((prev) => ({ ...prev, [activeIdRef.current!]: v }));
  }, []);
  const craftView: 'spec' | 'conversation' = (() => {
    if (!active) return 'conversation';
    const draftedNow = active.status === 'drafted' || active.status === 'approved';
    const showing = constructedDrafts[active.id] ?? null;
    const hasQ = draftedNow && !active.aiSatisfied;
    return craftViewOverride[active.id] ?? (hasQ ? 'conversation' : showing ? 'spec' : 'conversation');
  })();
  useEffect(() => {
    if (craftView === 'conversation') {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    } else {
      contentRef.current?.scrollTo?.(0, 0);
    }
  }, [activeId, collab, craftView]);

  if (!active) {
    // While a refresh is in flight (e.g. right after "Continue to Craft", when the
    // freshly-created components are still being fetched), show a loader instead of
    // the empty state — the components are on their way, not absent.
    if (loading) {
      return (
        <div className="grid min-h-40 place-items-center">
          <Loader2 className="size-6 animate-spin text-accent" />
        </div>
      );
    }
    return <Text className="!text-sm !text-ink-faint">No components yet — confirm the outline.</Text>;
  }

  const drafted = active.status === 'drafted' || active.status === 'approved';
  const Icon = KIND_ICON[active.kind];
  const showingDraft = constructedDrafts[active.id] ?? null;
  // craftView + setCraftView are computed above the early return (hooks must run
  // unconditionally); showingDraft/hasQuestions here are plain derived values.
  const activeCollab = collab[active.id] ?? { participants: [], discussion: [] };
  const iApproved = hasApproved(activeCollab.participants, currentMember.id);
  const forgeMember: MemberRef = { id: 'forge', displayName: FORGE_DISPLAY_NAME, avatarTint: FORGE_AVATAR_TINT };
  const otherMembers = activeCollab.participants
    .filter((p) => p.member.id !== currentMember.id && p.member.id !== 'forge')
    .map((p) => p.member)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const inChatMembers = [forgeMember, ...otherMembers];

  /** Patch the active component's collaborative state. */
  function patchCollab(updater: (u: UnitCollab) => UnitCollab): void {
    const id = active!.id;
    setCollab((prev) => ({ ...prev, [id]: updater(prev[id] ?? { participants: [], discussion: [] }) }));
  }

  /** Pull a teammate in from the top "Invite" picker. */
  function invite(m: MemberRef): void {
    if (readOnly || !active) return;
    const already = activeCollab.participants.some((p) => p.member.id === m.id);
    if (already) return;
    const compId = active.id;
    const prevCollab = collab[compId];
    void optimistic.run({
      apply: () => patchCollab((u) => ({ ...u, participants: addParticipant(u.participants, m) })),
      commit: async () => {
        const r = await fetch(`/api/projects/${projectId}/spec/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId: m.id, componentId: compId }) });
        if (!r.ok) throw new Error(await responseError(r, `Request failed (${r.status}).`));
      },
      rollback: () => setCollab((prev) => ({ ...prev, [compId]: prevCollab ?? { participants: [], discussion: [] } })),
      error: 'Couldn’t invite — reverted.',
      retryable: true });
  }

  async function submit(): Promise<void> {
    if (!input.trim() || readOnly || !active) return;
    const text = input.trim();
    const compId = active.id;
    setInput('');

    // Optimistic local append — sender sees immediately
    const tempId = localId('tmp');
    patchCollab((u) => ({
      ...u,
      discussion: [
        ...u.discussion,
        { id: tempId, authorId: currentMember.id, body: text },
      ] }));
    // Persist to DB BEFORE any @Forge refine: refine_component reads the persisted thread, so
    // dispatching it before the row commits makes Forge miss the just-sent message. And on a
    // failed send, roll the optimistic message back + surface the error — never leave a phantom
    // "sent" line that vanishes on reload.
    try {
      const r = await fetch(`/api/projects/${projectId}/spec/components/${compId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyMd: text }) });
      if (!r.ok) throw new Error(await responseError(r, `send failed (${r.status})`));
      const data = (await r.json()) as { id: string };
      seenMsgIds.current.add(data.id); // mark seen so the SSE echo is skipped
      patchCollab((u) => ({
        ...u,
        discussion: u.discussion.map((d) => d.id === tempId ? { ...d, id: data.id } : d) }));
    } catch {
      patchCollab((u) => ({ ...u, discussion: u.discussion.filter((d) => d.id !== tempId) }));
      showToast({ type: 'error', message: 'Couldn’t send your message — try again.' });
      return;
    }

    // @Forge triggers the AI to process and respond — the message is now persisted, so
    // refine_component reads the just-sent line.
    const forgeTagged = isForgeMention(text);
    if (forgeTagged && drafted) {
      setRefiningComponents((prev) => new Set(prev).add(compId));
      setCraftView('conversation');

      mma.transition('refine_component', { componentId: compId }, 'spec-refine')
        .then(() => {
          setRefiningComponents((prev) => { const next = new Set(prev); next.delete(compId); return next; });
        })
        .catch(() => {
          setRefiningComponents((prev) => { const next = new Set(prev); next.delete(compId); return next; });
          patchCollab((u) => ({
            ...u,
            discussion: [
              ...u.discussion,
              { id: localId('forge-err'), authorId: 'forge', body: 'Something went wrong — please try again.' },
            ] }));
        });
    } else if (forgeTagged && !drafted) {
      // @Forge refines a DRAFTED section — on a still-gathering one it would silently do nothing
      // (message posts, no reply). Tell the user why, so the mention isn't a dead no-op.
      showToast({ type: 'error', message: 'Forge refines a section once it’s drafted — draft this section first, then @Forge.' });
    }
  }

  function approve(): void {
    if (!active || iApproved) return;
    const compId = active.id;
    const prevStatus = active.status;
    const prevApprovedBy = [...active.approvedBy];
    const prevCollab = collab[compId];
    // Persist approval to DB — one component-level nod through the unified engine
    // (approve_component → onHumanSatisfied, idempotent for the whole component).
    void optimistic.run({
      apply: () => {
        patchCollab((u) => ({
          ...u,
          participants: recordApproval(u.participants, currentMember) }));
        // Patch approvedBy too, not just status: the re-seed effect rebuilds
        // participants from approvedBy on any `components` change, so without this the
        // optimistic approval is wiped on the very next render — which is why it looked
        // like a manual refresh was needed.
        onPatch(compId, { status: 'approved', approvedBy: Array.from(new Set([...prevApprovedBy, currentMember.id])) });
      },
      commit: () => mma.transition('approve_component', { componentId: compId }),
      rollback: () => {
        onPatch(compId, { status: prevStatus, approvedBy: prevApprovedBy });
        setCollab((prev) => ({ ...prev, [compId]: prevCollab ?? { participants: [], discussion: [] } }));
      },
      error: 'Couldn’t approve — reverted.',
      retryable: true });
    // Stay on the just-approved section so the button flips to "Revoke" and the
    // approval is visible immediately. (Previously it auto-jumped to the next open
    // section, so you never saw your own approval land.)
  }

  function backToEdit(): void {
    if (readOnly || !active) return;
    if (active.status === 'approved') {
      const compId = active.id;
      const prevStatus = active.status;
      const prevApprovedBy = [...active.approvedBy];
      const prevCollab = collab[compId];
      void optimistic.run({
        apply: () => {
          // Revoke removes ONLY my approval (matches the server route). Patch
          // approvedBy so the re-seed keeps other approvers intact; status stays
          // 'approved' if anyone else still approves, else back to 'drafted'. Clear
          // only my own flag, not everyone's.
          const nextApprovedBy = prevApprovedBy.filter((id) => id !== currentMember.id);
          onPatch(compId, { status: nextApprovedBy.length > 0 ? 'approved' : 'drafted', approvedBy: nextApprovedBy });
          patchCollab((u) => ({
            ...u,
            participants: u.participants.map((p) => (p.member.id === currentMember.id ? { ...p, approved: false } : p)) }));
        },
        commit: async () => {
          const r = await fetch(`/api/projects/${projectId}/spec/components/${compId}/revoke`, { method: 'POST' });
          if (!r.ok) throw new Error(await responseError(r, `Request failed (${r.status}).`));
        },
        rollback: () => {
          onPatch(compId, { status: prevStatus, approvedBy: prevApprovedBy });
          setCollab((prev) => ({ ...prev, [compId]: prevCollab ?? { participants: [], discussion: [] } }));
        },
        error: 'Couldn’t revoke — reverted.',
        retryable: true });
    }
    setConstructedDrafts((prev) => { const next = { ...prev }; delete next[active.id]; return next; });
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  /** Is anyone still pending on at least one section? Drives the soft nudge.
   * A boolean, deliberately: this used to build a Set of unique member ids because the
   * COUNT was rendered (and section×person double-counting showed "15" for 2 people).
   * The copy no longer names a number, so the Set was an O(sections x people)
   * allocation to answer a yes/no. */
  const anyPending = components.some(
    (c) => pendingParticipants(collab[c.id]?.participants ?? []).length > 0,
  );
  function consolidate(): void {
    if (anyPending && !nudge) {
      setNudge(true);
      return;
    }
    onConsolidate();
  }

  return (
    <StageShell
      note={<SpecNote phase="craft" />}
      navigator={
        // Rail keeps its own box: its rows are bespoke components, not NavItems.
        <>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Components</CardTitle>
          </CardHeader>
          <div className="flex items-center gap-2 border-b border-line px-5 py-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-[var(--sage)] transition-all"
                style={{ width: `${components.length ? (approvedCount / components.length) * 100 : 0}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium text-ink-faint">{approvedCount}/{components.length}</span>
          </div>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
            {components.map((c) => (
              <ComponentRow
                key={c.id}
                c={c}
                active={c.id === activeId}
                participants={collab[c.id]?.participants ?? []}
                displayState={componentDisplayState(c)}
                onClick={() => {
                  setActiveId(c.id);
                  setInput('');
                }}
              />
            ))}
            <button
              type="button"
              onClick={onEditOutline}
              className="flex w-full items-center justify-center gap-1.5 rounded-[var(--r-md)] border border-dashed border-line-strong px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent"
            >
              <Plus className="size-4" /> Add component
            </button>
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            {nudge && anyPending ? (
              <div className="rounded-[var(--r-md)] border border-amber-tint bg-amber-tint/40 px-3 py-2 text-xs leading-relaxed text-ink-soft">
                Not all invited approvers have responded yet. One nod per section is
                enough — you can proceed anyway.
              </div>
            ) : null}
            <Button className="w-full" onClick={consolidate} disabled={!allApproved || readOnly} rightIcon={<ArrowRight />}>
              Continue to Finalize
            </Button>
          </CardFooter>
        </Card>
        </>
      }
    >
      {/* LEFT — the conversation that crafts the active component (2/3) */}
      <DocumentShell
        className="flex min-h-0 flex-1 flex-col"
        meta={
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-accent">
            <Icon className="size-4" />
          </span>
        }
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="truncate">{active.label}</span>
            {active.primaryRoles.map((r) => (
              <RoleChip key={r} role={r} />
            ))}
          </span>
        }
        tabs={drafted ? CRAFT_TABS : undefined}
        activeTab={craftView}
        onTabChange={(v) => setCraftView(v as 'spec' | 'conversation')}
        approvers={
          /* Co-approval strip — only show when the section has a draft to review. */
          drafted ? (
            <div className="shrink-0 border-b border-line px-5 py-2.5">
              <ParticipantStrip
                participants={activeCollab.participants}
                pool={projectMembers}
                onAdd={invite}
                disabled={readOnly}
              />
            </div>
          ) : null
        }
        bodyRef={contentRef}
        body={
          <div className="space-y-5">
          {/* Loading state while the section awaits its draft. Keyed on the section
              still being `gathering` with no draft (not just the transient dispatch
              flag) so the panel stays consistent with the rail's "Drafting…" the whole
              time the auto-draft is generating — the SSE-done flag clears before the
              draft actually lands. */}
          {!showingDraft && !drafted && (autoDrafting || active.status === 'gathering') ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="text-sm font-medium text-ink">Drafting from exploration brief…</p>
              <p className="text-xs text-ink-soft">Each component is drafted using the exploration findings. This takes a moment.</p>
            </div>
          ) : (
          <>

          {/* Spec view: rendered markdown, like exploration summary */}
          {craftView === 'spec' ? (
            showingDraft
              ? <ProseBlock>{showingDraft}</ProseBlock>
              : <p className="py-8 text-center text-sm text-ink-faint">No draft content yet. Switch to Discussion to refine this section.</p>
          ) : null}

          {/* Conversation view */}
          {craftView === 'conversation' ? (
            <>
              <DiscussionThread
                messages={activeCollab.discussion}
                memberById={memberById}
                currentMemberId={currentMember.id}
                mentionPool={inChatMembers}
                pending={!!active && componentRefining(active.id)}
              />
            </>
          ) : null}
          </>
          )}
          <div ref={bottomRef} />
          </div>
        }
        actions={craftView === 'spec' && showingDraft ? (
            <Button
              size="sm"
              onClick={iApproved ? backToEdit : approve}
              disabled={readOnly}
              variant={iApproved ? 'secondary' : 'primary'}
              leftIcon={iApproved ? <RotateCcw /> : <Check />}
            >
              {iApproved ? 'Revoke' : 'Approve'}
            </Button>
        ) : null}
        footer={!(craftView === 'spec' && showingDraft) ? (
          <ConversationComposer
            value={input}
            onChange={setInput}
            onSend={() => submit()}
            disabled={readOnly || (active != null && componentRefining(active.id))}
            voice={voiceEnabled}
            mentionPool={inChatMembers}
          />
        ) : null}
      />

    </StageShell>
  );
}

/** Craft tabs — the drafted spec section, then its discussion. */
const CRAFT_TABS: readonly DocumentShellTab[] = [
  { id: 'spec', label: 'Spec' },
  { id: 'conversation', label: 'Discussion' },
];

/** Finalize tabs — the whole spec document, then the audit findings against it. */
const FINALIZE_TABS: readonly DocumentShellTab[] = [
  { id: 'document', label: 'Spec' },
  { id: 'conversation', label: 'Audit' },
];

function ComponentRow({
  c,
  active,
  participants,
  displayState,
  onClick }: {
  c: ComponentView;
  active: boolean;
  participants: Participant[];
  displayState: DisplayState;
  onClick: () => void;
}) {
  const Icon = KIND_ICON[c.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors',
        active ? 'border-accent bg-surface shadow-sm' : 'border-transparent hover:bg-surface-2/50',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {c.status === 'approved' ? (
            <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
          ) : (
            <Icon className="size-4 shrink-0 text-ink-faint" />
          )}
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.label}</span>
        </div>
        <div className="mt-1 pl-6">
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', displayState.cls)}>
            {displayState.label}
          </span>
        </div>
      </div>
      <ApproverCluster participants={participants} />
    </button>
  );
}

/* ── Document screen — whole-spec finalization conversation ──────────────── */

/** One turn in the finalization chat. */
function DocumentScreen({
  projectId,
  projectName,
  spec,
  allApproved,
  readOnly,
  mmaReady,
  initialAuditHistory,
  pendingApply,
  mma,
  currentMember,
  projectMembers,
  components,
  specApprovers,
  setSpecApprovers,
  onAssembled,
  onError }: {
  projectId: string;
  projectName: string;
  spec: { version: number; bodyMd: string } | null;
  allApproved: boolean;
  readOnly: boolean;
  mmaReady: boolean;
  initialAuditHistory: AuditPassView[];
  pendingApply?: string | null;
  mma: MmaDispatchState;
  currentMember: MemberRef;
  projectMembers: MemberRef[];
  components: ComponentView[];
  specApprovers: string[];
  setSpecApprovers: (v: string[]) => void;
  onAssembled: (v: { version: number; bodyMd: string }) => void;
  onError: (m: string | null) => void;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const optimistic = useOptimisticAction();
  const initialRounds = useMemo(() =>
    initialAuditHistory.map((p) => ({ passNo: p.passNo, verdict: p.verdict, findings: p.findings ?? [], applied: p.applied ?? false, appliedIndices: p.appliedIndices ?? [] })),
    [initialAuditHistory],
  );
  const [rounds] = useServerState(initialRounds);
  const [docView, setDocView] = useState<'conversation' | 'document'>(spec ? 'document' : 'conversation');
  const [selectedPass, setSelectedPass] = useState<number | null>(rounds.length > 0 ? rounds[rounds.length - 1].passNo : null);
  // Auto-select latest pass when new audit completes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-select the newest audit pass when rounds grow
    if (rounds.length > 0) setSelectedPass(rounds[rounds.length - 1].passNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: keys off rounds.length; reading full rounds only to index the latest, not to retrigger
  }, [rounds.length]);
  const activeRound = selectedPass !== null ? rounds.find((r) => r.passNo === selectedPass) : null;
  const iApprovedSpec = specApprovers.includes(currentMember.id);

  // Assemble runs as a plain fetch, not a react-query mutation: the auto-assemble below
  // fires from an effect, and an effect-triggered mutation gets its observer torn down
  // during next-dev Strict-Mode remounts, leaving `isPending` stuck true. A ref cannot get
  // stuck that way, and it is only ever read by the re-entrancy guards below — never during
  // render — so it needs no companion state. There was one: a `useState` whose value was
  // discarded at the destructure, re-rendering on every assemble for a flag nothing showed.
  const assemblingRef = useRef(false);
  async function runAssemble(): Promise<void> {
    if (assemblingRef.current) return;
    assemblingRef.current = true;
    try {
      const data = await postJson<{ artifact: { version: number; body_md: string } }>(
        `/api/projects/${projectId}/spec/assemble`,
        {},
      );
      onError(null);
      const next = { version: data.artifact.version, bodyMd: data.artifact.body_md };
      onAssembled(next);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Assemble failed.');
    } finally {
      assemblingRef.current = false;
    }
  }

  // The spec-audit effect is synchronous (await:true → the POST resolves when the
  // audit terminal handler has recorded the pass), so drive the button from a local
  // flag rather than an SSE busy-handler.
  const [auditing, setAuditing] = useState(false);
  const auditingRef = useRef(false);
  async function runAudit(): Promise<void> {
    if (auditingRef.current) return;
    auditingRef.current = true;
    setAuditing(true);
    try {
      await mma.transition('dispatch_audit');
      refresh(); // useServerState re-pulls the recorded pass
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Audit failed.');
    } finally {
      auditingRef.current = false;
      setAuditing(false);
    }
  }
  // The audit indicator must survive navigation: the local `auditing` flag is lost on
  // unmount, but the spec-audit batch keeps running and `mma.busyHandlers` rehydrates it
  // on remount (via /pending-handlers). Drive the button + "Running…" row from BOTH, so
  // coming back to the page still shows the audit in flight (and blocks a double Re-run).
  const auditRunning = auditing || mma.busyHandlers.has('spec-audit');


  // Entering Document with everything approved → assemble automatically so the
  // full spec is shown immediately (also re-assembles a stale/empty draft).
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || readOnly || assemblingRef.current) return;
    if (allApproved && (!spec || !spec.bodyMd.trim())) {
      autoTried.current = true;
      void runAssemble();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `runAssemble` is deliberately excluded: it is recreated each render and the one-shot is already guarded by the `autoTried` ref
  }, [allApproved, spec, readOnly]);

  const [applying, setApplying] = useState(!!pendingApply);
  const [applyingPass, setApplyingPass] = useState<number | null>(null);
  const [appliedPasses, setAppliedPasses] = useState<Set<number>>(new Set());
  const [applyCount, setApplyCount] = useState(0);
  // Manual subset selection — indices into the active round's findings array.
  const [selectedFindings, setSelectedFindings] = useState<number[]>([]);
  const toggleFinding = (i: number) => setSelectedFindings((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the manual finding selection when the viewed pass changes
  useEffect(() => { setSelectedFindings([]); }, [selectedPass]);

  function apply(passNo: number, indices: number[]): void {
    if (readOnly || applying || indices.length === 0) return;
    const round = rounds.find((r) => r.passNo === passNo);
    if (!round || round.findings.length === 0) return;
    // Same dispatch for auto and manual — only the array size differs. Auto mode
    // dispatches apply_findings for the WHOLE pass (no findingIndices); manual sends the
    // user-selected subset (or all) as `findingIndices`. The server filters the re-parsed
    // findings by these indices — identical parser, so indices align 1:1 with the rows.
    setApplying(true);
    setApplyingPass(passNo);
    setApplyCount(indices.length);
    void mma.transition('apply_findings', { findingIndices: indices, passNo })
      .then(() => {
        setApplying(false);
        setAppliedPasses((prev) => new Set(prev).add(passNo));
        setApplyingPass(null);
        setSelectedFindings([]);
        refresh();
      })
      .catch(() => {
        // Surface the failure. This used to reset the flags silently, so a failed apply
        // looked identical to one that had not been started — the Plan stage has always
        // toasted here.
        setApplying(false);
        setApplyingPass(null);
        showToast({ type: 'error', message: 'Couldn’t apply findings — try again.' });
      });
  }

  return (
    <StageShell
      note={<SpecNote phase="finalize" />}
      navigator={
        // Rail keeps its own box: its rows are bespoke components, not NavItems.
        <>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Audit rounds</CardTitle>
            </div>
            <Button
              size="sm"
              onClick={() => void runAudit()}
              loading={auditRunning}
              disabled={readOnly || !mmaReady || !spec || auditRunning || applying}
              leftIcon={<Shield />}
            >
              {auditRunning ? 'Auditing…' : rounds.length > 0 ? 'Re-run' : 'Run audit'}
            </Button>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
            {!auditRunning && rounds.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
                <span className="grid size-10 place-items-center rounded-full bg-surface-2">
                  <Shield className="size-5 text-ink-faint" />
                </span>
                <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                  Each audit round lands here<br />with its verdict and findings.
                </p>
              </div>
            ) : null}
            {auditRunning ? (
              <div className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2/60 px-3 py-2.5">
                <Loader2 className="size-4 animate-spin text-accent" />
                <span className="text-sm font-medium text-ink">Pass {rounds.length + 1}</span>
                <span className="text-xs text-ink-faint">Running…</span>
              </div>
            ) : null}
            {[...rounds].reverse().map((r) => (
              <div key={r.passNo} className="relative">
                <PatternAuditRoundCard
                  passNo={r.passNo}
                  verdict={r.verdict}
                  findings={r.findings}
                  applied={r.applied || appliedPasses.has(r.passNo)}
                  active={selectedPass === r.passNo && docView === 'conversation'}
                  onClick={() => { setSelectedPass(r.passNo); setDocView('conversation'); }}
                />
                {applying && applyingPass === r.passNo ? (
                  <div className="mt-1.5 flex items-center gap-2 rounded-[var(--r-md)] border border-accent/30 bg-accent-tint/30 px-3 py-1.5">
                    <Loader2 className="size-3.5 animate-spin text-accent" />
                    <span className="text-xs font-medium text-accent-deep">
                      Applying {applyCount} finding{applyCount !== 1 ? 's' : ''}...
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <StageAdvance
              href={`/projects/${projectId}/plan`}
              projectId={projectId}
              from="spec"
              label="Continue to Plan"
              testId="spec-continue-link"
              disabled={specApprovers.length === 0 || readOnly}
            />
          </CardFooter>
        </Card>
        </>
      }
    >
      {/* CENTRE — the whole-spec finalization conversation (2/3) */}
      <DocumentShell
        className="flex min-h-0 flex-1 flex-col"
        title={`${projectName} — specification`}
        version={spec ? spec.version : undefined}
        tabs={spec ? FINALIZE_TABS : undefined}
        activeTab={docView}
        onTabChange={(v) => setDocView(v as 'document' | 'conversation')}
        // Only the findings grid is edge-to-edge; the empty state keeps the inset.
        flush={docView !== 'document' && rounds.length > 0 && Boolean(activeRound)}
        approvers={
          // Participants strip — unique members from spec with approval state.
          (() => {
            const allPool = [currentMember, ...projectMembers];
            const involvedIds = new Set<string>([currentMember.id]);
            for (const c of components) {
              for (const pid of (c.participantIds ?? []) as string[]) involvedIds.add(pid);
              for (const aid of c.approvedBy as string[]) involvedIds.add(aid);
            }
            const involved: Participant[] = [...involvedIds]
              .map((id) => allPool.find((m) => m.id === id))
              .filter(Boolean)
              .map((m) => ({
                member: m!,
                approved: specApprovers.includes(m!.id) }));
            return (
              <div className="shrink-0 border-b border-line px-5 py-2.5">
                {/* No `onAdd`: invites are per-component and happen in Craft. Passing a
                    no-op handler here rendered a live "Invite" picker that did nothing. */}
                <ParticipantStrip
                  participants={involved}
                  pool={projectMembers}
                  disabled={readOnly}
                />
              </div>
            );
          })()
        }
        body={
          <>
          {docView === 'document' && spec ? (
            <ProseBlock>{spec.bodyMd}</ProseBlock>
          ) : rounds.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-xs text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--frost)]">
                  <Shield className="size-7 text-[var(--steel)]" />
                </span>
                <p className="mt-5 text-sm font-semibold text-ink">Ready for audit</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                  Run an audit from the right panel to check for gaps, contradictions, and missing detail.
                </p>
              </div>
            </div>
          ) : activeRound ? (
            <FindingsGrid
              findings={activeRound.findings}
              selectable
              selectedIndices={selectedFindings}
              onToggle={toggleFinding}
              applying={applying}
              // Mark only the applied rows, leaving the rest selectable so a partial apply
              // can be finished — `applied={…}` would green every finding and lock the grid.
              appliedIndices={activeRound.appliedIndices}
              readOnly={readOnly}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-ink-faint">Select a pass from the right panel to view its findings.</p>
            </div>
          )}
          </>
        }
        actions={
          docView === 'document' && spec ? (
                <Button
                  size="sm"
                  onClick={() => {
                    const action = iApprovedSpec ? 'revoke' : 'approve';
                    const prev = specApprovers;
                    void optimistic.run({
                      apply: () => setSpecApprovers(iApprovedSpec
                        ? specApprovers.filter((a: string) => a !== currentMember.id)
                        : [...specApprovers, currentMember.id]),
                      commit: async () => {
                        const r = await fetch(`/api/projects/${projectId}/spec/approve`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action }) });
                        if (!r.ok) throw new Error(await responseError(r, `Request failed (${r.status}).`));
                      },
                      rollback: () => setSpecApprovers(prev),
                      error: iApprovedSpec ? 'Couldn’t revoke — reverted.' : 'Couldn’t approve — reverted.',
                      retryable: true });
                  }}
                  variant={iApprovedSpec ? 'secondary' : 'primary'}
                  leftIcon={iApprovedSpec ? <RotateCcw /> : <Check />}
                  disabled={readOnly}
                >
                  {iApprovedSpec ? 'Revoke' : 'Approve'}
                </Button>
          ) : null
        }
        footer={
          <>
            {docView !== 'document' && activeRound && activeRound.findings.length > 0 ? (
              // The apply bar stays put after applying — it locks (readOnly) rather than
              // vanishing, matching the governed AuditView so the three stages can't drift.
              <FindingsApplyBar
                selectedCount={selectedFindings.length}
                total={activeRound.findings.length}
                applying={applying}
                // Locked only when EVERY finding has been applied. It used to lock on the
                // first apply of any subset, stranding the remaining findings.
                readOnly={readOnly || activeRound.appliedIndices.length >= activeRound.findings.length}
                onToggleAll={() => setSelectedFindings(selectedFindings.length === activeRound.findings.length ? [] : activeRound.findings.map((_, i) => i))}
                onApply={() => apply(activeRound.passNo, selectedFindings)}
              />
            ) : null}
            {!mmaReady ? (
              <div className="shrink-0 border-t border-line px-5 py-2">
                <TextSm className="!text-[var(--amber)]">
                  <a href="/settings/connections" className="underline">
                    Configure the MMA token
                  </a>{' '}
                  to run the audit.
                </TextSm>
              </div>
            ) : null}
          </>
        }
      />

    </StageShell>
  );
}
