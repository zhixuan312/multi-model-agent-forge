'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMmaDispatch, type MmaDispatchState } from '@/hooks/useMmaDispatch';
import { useServerState } from '@/hooks/useServerState';
import { useMutation } from '@tanstack/react-query';
import {
  Sparkles,
  Snowflake,
  Check,
  CheckCircle2,
  ArrowRight,
  ChevronLeft,
  Lightbulb,
  Pencil,
  Plus,
  Search,
  FileText,
  BookOpen,
  Target,
  Flag,
  Blocks,
  GitBranch,
  AlertTriangle,
  FlaskConical,
  ListTodo,
  Loader2,
  Database,
  Shield,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { ProseBlock } from '@/components/patterns/prose-block';
import { RailNote } from '@/components/patterns/feature-rail';
import { RoleChip } from '@/components/forge/RoleChip';
import { ForgeMark } from '@/components/forge/ForgeMark';
import { useRouter } from 'next/navigation';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { ConversationComposer } from '@/components/patterns/conversation';
import { FindingsGrid, AuditRoundCard as PatternAuditRoundCard, type Finding } from '@/components/patterns/findings';
import { AutomationBar, type AutoMode } from '@/components/forge/AutomationBar';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Banner,
  Input,
  Heading,
  Text,
  TextSm,
  Micro,
  Eyebrow,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { COMPONENT_TEMPLATES, DOC_TEMPLATES, templateForKind, type DocTemplate } from '@/spec/components';
import { ParticipantStrip, ApproverCluster } from '@/components/forge/collab/Participants';
import { DiscussionThread } from '@/components/forge/collab/DiscussionThread';
import { MentionComposer } from '@/components/forge/collab/MentionComposer';
import {
  addParticipant,
  recordApproval,
  parseMentions,
  isHumanApproved,
  hasApproved,
  pending as pendingParticipants,
} from '@/collab/section-approval';
import type { ComponentView } from '@/spec/spec-core';
import type { MemberRef, UnitCollab, DiscussionMsg, Participant } from '@/collab/types';
import type { ComponentKind, ComponentStatus, ProjectPhase } from '@/db/enums';

/**
 * `SpecStageClient` (Spec 4 Part A) — the interview/document client island. Three
 * screens: outline (pick components + intent), interview (per-section Q&A
 * chatbox + satisfaction indicators + force-advance), document (assembled spec).
 * Drives the orchestrator through the `projects/[id]/spec/**` route handlers via
 * TanStack Query; patches local state from each repaint payload.
 */

/** One row in the audit-pass timeline ("pass 1: 2 findings → revised"). */
export interface AuditPassView {
  passNo: number;
  findingsCount: number;
  verdict: 'clean' | 'revised';
  findings?: AuditFinding[];
  applied?: boolean;
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
  initialCanFreeze: boolean;
  /** Mock-only: realistic per-component questions + drafts for the Craft conversation. */
  craftContent?: Record<string, CraftSeed>;
  /** The signed-in member — drives "you" attribution and approvals. */
  currentMember: MemberRef;
  /** Teammates who can be @-mentioned into a section for co-approval. */
  projectMembers?: MemberRef[];
  /** Mock-only: per-component seeded participants + group-chat (by kind). */
  craftCollab?: Partial<Record<ComponentKind, UnitCollab>>;
  /** Persisted qa_messages per sectionId — loaded from DB on page render. */
  initialMessages?: Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId?: string | null }>>;
  /** Whether OpenAI transcription key is configured — enables voice input. */
  voiceEnabled?: boolean;
  /** In-flight audit batch ID (from DB on page load). */
  pendingAudit?: string | null;
  /** In-flight auto-draft batch ID (from DB on page load). */
  pendingAutoDraft?: string | null;
  /** In-flight audit-apply batch ID (from DB on page load). */
  pendingApply?: string | null;
  specApprovers?: string[];
  /** URL-persisted initial phase (outline/craft/document). */
  initialPhase?: 'outline' | 'craft' | 'finalize';
}

/** Pre-authored Craft content (mock) — question rounds + the constructed draft per component. */
interface CraftSeed {
  questions: string[][];
  draftMd: string;
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
  stories_tasks: ListTodo,
};

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
  default: t.default,
}));

/** Distinct disciplines across the component library — the role filter chips. */
const ALL_ROLES: string[] = [...new Set(KIND_CARDS.flatMap((c) => c.roles))];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

export function SpecStageClient(props: SpecStageClientProps) {
  const router = useRouter();
  const readOnly = props.phase !== 'design';
  const [components, setComponents] = useServerState<ComponentView[]>(props.initialComponents);
  const [spec, setSpec] = useServerState(props.initialSpec);
  const [messages] = useServerState(props.initialMessages ?? {});
  const [specApprovers, setSpecApprovers] = useServerState(props.specApprovers ?? []);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');
  // Intent carried forward from the Exploration brief (no longer hand-typed here).
  const [intent] = useState(props.intentMd ?? '');
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
    const url = new URL(window.location.href);
    url.searchParams.set('phase', p);
    router.push(url.pathname + url.search, { scroll: false });
    fetch(`/api/projects/${props.projectId}/phase`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'spec', phase: p }),
    }).catch(() => {});
  };
  const refresh = useCallback(() => { router.refresh(); }, [router]);
  const mma = useMmaDispatch(props.projectId, {
    onDone: {
      'spec-auto-draft': refresh,
      'spec-refine': refresh,
    },
    events: {
      'spec.updated': () => { console.log('[SSE] spec.updated received — refreshing'); refresh(); },
      'chat.message': (data) => {
        window.dispatchEvent(new CustomEvent('chat:message', { detail: data }));
      },
      'chat.typing': (data) => {
        window.dispatchEvent(new CustomEvent('chat:typing', { detail: data }));
      },
    },
  });

  const needsAutoDraft = components.length > 0 && components.some(
    (c) => c.status === 'gathering' && c.sections.some((s) => !s.draftMd),
  );
  const autoDrafting = !!props.pendingAutoDraft || mma.busyHandlers.has('spec-auto-draft');
  const autoDraftFired = useRef(false);

  // Auto-trigger drafting when landing on craft with undrafted sections.
  useEffect(() => {
    if (phase !== 'craft' || !needsAutoDraft || autoDraftFired.current) return;
    if (props.pendingAutoDraft) { autoDraftFired.current = true; return; }
    autoDraftFired.current = true;
    void mma.dispatch(`/projects/${props.projectId}/spec/auto-draft`, 'spec-auto-draft')
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Auto-draft failed.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, needsAutoDraft]);

  // Publish the live sub-phase to the stepper (Outline · Craft · Document).
  useEffect(() => stagePhaseStore.set(phase), [phase]);
  // Let the stepper's sub-phase chips jump back to a phase (Craft/Document need a confirmed outline).
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'outline' || key === 'craft' || key === 'finalize') {
          setPhase(key as SpecPhase);
        }
      }),
    [],
  );

  const allApproved = components.length > 0 && components.every((c) => c.status === 'approved');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="spec-stage">
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
      {error ? <TextSm className="shrink-0 !text-[var(--rose)]">{error}</TextSm> : null}

      <AutomationBar
        mode={auto}
        note={autoNote}
        disabled={readOnly || phase !== 'finalize'}
        idleHint={
          phase === 'finalize'
            ? 'Spec is ready — let Forge finalize it and run Plan → Build → Journal to the end.'
            : 'Automation unlocks at the Document phase — Outline & Craft are hand-authored.'
        }
        runningHint="Forge finalizes the spec and drives the whole flow to the end. Stop anytime."
        onRun={() => {
          setAutoNote('Forge is driving — finalizing the spec…');
          setAuto('running');
        }}
        onStop={() => {
          setAuto('off');
          setAutoNote('Stopped — you have the wheel.');
        }}
      />

      {/* BODY — every phase carries its own rails; no top status row. */}
      {phase === 'outline' ? (
        <OutlineStage
          projectId={props.projectId}
          intent={intent}
          picked={picked}
          onPick={setPicked}
          templates={DOC_TEMPLATES}
          existing={components}
          readOnly={readOnly}
          onConfirmed={(next) => {
            setComponents(next);
            setPicked(new Set(next.map((c) => c.kind)));
            autoDraftFired.current = true;
            setPhase('craft');
            const hasUndrafted = next.some((c) => c.status === 'gathering' && c.sections.some((s) => !s.draftMd));
            if (hasUndrafted) {
              void mma.dispatch(`/projects/${props.projectId}/spec/auto-draft`, 'spec-auto-draft')
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Auto-draft failed.'));
            }
          }}
          onError={setError}
        />
      ) : phase === 'craft' ? (
        <CraftStage
          projectId={props.projectId}
          components={components}
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
          onConsolidate={() => setPhase('finalize')}
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
          initialCanFreeze={props.initialCanFreeze}
          voiceEnabled={props.voiceEnabled ?? false}
          pendingApply={props.pendingApply}
          driving={auto === 'running'}
          mma={mma}
          currentMember={props.currentMember}
          projectMembers={props.projectMembers ?? []}
          components={components}
          specApprovers={specApprovers}
          setSpecApprovers={setSpecApprovers}
          onAdvance={() => router.push(`/projects/${props.projectId}/plan?auto=1`)}
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

- **Q&A** — Forge asks grounded questions; your answers shape the draft
- **Approve** — mark a section done when it matches your intent
- **Force** — skip AI questions and write your own draft

### Approval gates

- **AI satisfied** — Forge has enough context (no more questions)
- **You approve** — the section matches your intent
- All sections approved → Document phase unlocks`,

  finalize: `### Finalize — assemble & audit

- **Construct** — all approved sections assemble into one spec document
- **Audit** — MMA checks for gaps, contradictions, and missing detail
- **Apply fixes** — audit findings auto-revise the spec
- **Freeze** — locks the spec and opens the Build phase

### When to freeze

- Audit must pass clean (no critical or high findings)
- Freezing is irreversible — the spec becomes read-only`,
};

function SpecNote({ phase }: { phase: string }) {
  return <RailNote icon={<Lightbulb />}>{SPEC_PHASE_NOTES[phase] ?? SPEC_PHASE_NOTES.outline}</RailNote>;
}

/* ── Outline screen ─────────────────────────────────────────────────────── */

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="!pl-9"
      />
    </div>
  );
}

function OutlineStage({
  projectId,
  intent,
  picked,
  onPick,
  templates,
  existing,
  readOnly,
  onConfirmed,
  onError,
}: {
  projectId: string;
  intent: string;
  picked: Set<ComponentKind>;
  onPick: (s: Set<ComponentKind>) => void;
  templates: readonly DocTemplate[];
  existing: ComponentView[];
  readOnly: boolean;
  onConfirmed: (next: ComponentView[]) => void;
  onError: (m: string | null) => void;
}) {
  const existingKinds = useMemo(() => new Set(existing.map((c) => c.kind)), [existing]);
  const active = matchTemplate(picked, templates);

  const confirm = useMutation({
    mutationFn: () =>
      postJson<{ components: ComponentView[] }>(`/projects/${projectId}/spec/confirm`, {
        intentMd: intent,
        kinds: [...picked],
      }),
    onSuccess: (data) => {
      onError(null);
      onConfirmed(data.components);
    },
    onError: (e: Error) => onError(e.message),
  });

  function toggle(kind: ComponentKind): void {
    if (readOnly) return;
    const next = new Set(picked);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onPick(next);
  }

  const valid = intent.trim() !== '' && picked.size > 0;

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
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — the component-card picker (the spec skeleton) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>Spec outline</CardTitle>
            <Micro className="!text-ink-faint">Pick what this spec will cover</Micro>
          </div>
        </CardHeader>
        <div className="shrink-0 space-y-2.5 border-b border-line px-5 py-3">
          <SearchField value={compQuery} onChange={setCompQuery} placeholder="Search components…" />
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
              const selected = picked.has(c.kind);
              return (
                <button
                  key={c.kind}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={selected}
                  onClick={() => toggle(c.kind)}
                  className={cn(
                    'flex flex-col gap-2.5 rounded-[var(--r-md)] border p-3.5 text-left transition-colors',
                    selected ? 'border-accent bg-accent-tint/25 shadow-sm' : 'border-line bg-surface hover:border-line-strong',
                    readOnly && 'cursor-default',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-[8px] transition-colors',
                        selected ? 'bg-accent text-white' : 'bg-surface-2 text-ink-faint',
                      )}
                    >
                      {selected ? <Check className="size-4" /> : <Icon className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1 font-semibold text-ink">{c.label}</span>
                  </div>
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
                </button>
              );
            })}
          </div>
          {shownKinds.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-faint">No components match your filter.</p>
          ) : null}
        </CardContent>
      </Card>

      {/* RIGHT — guidance note (pinned) + the template picker & confirm */}
      <aside className="flex min-h-0 flex-col gap-4">
        <SpecNote phase="outline" />
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Template</CardTitle>
            <Button
              size="sm"
              onClick={() => confirm.mutate()}
              loading={confirm.isPending}
              disabled={readOnly || !valid || confirm.isPending}
              rightIcon={<ArrowRight />}
            >
              {confirm.isPending ? 'Drafting…' : 'Continue to Craft'}
            </Button>
          </CardHeader>
          <div className="shrink-0 border-b border-line px-5 py-3">
            <SearchField value={tplQuery} onChange={setTplQuery} placeholder="Search templates…" />
          </div>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
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
        </Card>
      </aside>
    </div>
  );
}

/** One selectable template row in the picker. */
function TemplateRow({
  label,
  description,
  count,
  selected,
  disabled,
  onClick,
}: {
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
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-1 rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors',
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

function componentDisplayState(c: ComponentView): DisplayState {
  if (c.status === 'approved') return { label: 'Approved', cls: 'bg-sage-tint text-[var(--sage-deep)]' };
  if (c.status === 'drafted') {
    return c.aiSatisfied
      ? { label: 'Ready', cls: 'bg-sage-tint text-[var(--sage-deep)]' }
      : { label: 'Needs input', cls: 'bg-amber-tint text-[var(--amber)]' };
  }
  return { label: 'Drafting...', cls: 'bg-surface-2 text-ink-soft' };
}

/** Group a component's section prompts into Forge "ask" rounds (2 questions each). */
function roundsFor(c: ComponentView): { questions: string[]; source: string; missing: string[] }[] {
  const prompts = templateForKind(c.kind).sections.map((s) => s.prompt);
  const out: { questions: string[]; source: string; missing: string[] }[] = [];
  for (let i = 0; i < prompts.length; i += 2) {
    out.push({
      questions: prompts.slice(i, i + 2),
      source: i === 0 ? 'mma-investigate · codebase scan' : 'mma-investigate · follow-up',
      missing: i === 0 ? [] : ['edge cases', 'constraints'],
    });
  }
  return out.length ? out : [{ questions: ['Tell Forge about this component.'], source: 'mma-investigate', missing: [] }];
}

function buildDraft(c: ComponentView, answers: string[]): string {
  return templateForKind(c.kind)
    .sections.map((s, i) => `### ${s.draftHeading}\n\n${answers[Math.floor(i / 2)] ?? '_(captured from the conversation)_'}`)
    .join('\n\n');
}

function CraftStage({
  projectId,
  components,
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
  onConsolidate,
}: {
  projectId: string;
  components: ComponentView[];
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
  const firstOpen = components.find((c) => c.status !== 'approved') ?? components[0];
  const [activeId, setActiveId] = useState<string | null>(firstOpen?.id ?? null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [input, setInput] = useState('');
  // Per-component: null = dialogue, string = showing fetched draft markdown
  const [constructedDrafts, setConstructedDrafts] = useState<Record<string, string>>({});
  const [refining, setRefining] = useState(false);

  // Auto-fetch drafts for all drafted components on first load
  const initialFetchDone = useRef(false);
  useEffect(() => {
    if (initialFetchDone.current || autoDrafting) return;
    const draftedComponents = components.filter((c) => c.status === 'drafted' || c.status === 'approved');
    if (draftedComponents.length === 0) return;
    initialFetchDone.current = true;
    const drafts: Record<string, string> = {};
    for (const c of draftedComponents) {
      const md = c.sections.filter((s) => s.draftMd).map((s) => s.draftMd!).join('\n\n');
      if (md) drafts[c.id] = md;
    }
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
        body: m.bodyMd,
      }));
      const approvers = c.approvedBy as string[];
      const meApprovedAt = approvers.includes(currentMember.id) ? new Date().toISOString() : null;
      const participants: Participant[] = [
        { member: currentMember, addedBy: null, approvedAt: meApprovedAt },
      ];
      for (const pid of (c.participantIds ?? []) as string[]) {
        if (pid === currentMember.id) continue;
        const m = allPool.find((p) => p.id === pid);
        if (m) participants.push({ member: m, addedBy: null, approvedAt: approvers.includes(pid) ? new Date().toISOString() : null });
      }
      for (const aid of approvers) {
        if (!participants.some((p) => p.member.id === aid)) {
          const approver = allPool.find((m) => m.id === aid);
          if (approver) participants.push({ member: approver, addedBy: null, approvedAt: new Date().toISOString() });
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
        const meApproved = approverList.includes(currentMember.id) ? new Date().toISOString() : null;
        const participants: Participant[] = [
          { member: currentMember, addedBy: null, approvedAt: meApproved },
        ];
        for (const pid of (c.participantIds ?? []) as string[]) {
          if (pid === currentMember.id) continue;
          const m = allPool.find((p) => p.id === pid);
          if (m) participants.push({ member: m, addedBy: null, approvedAt: approverList.includes(pid) ? new Date().toISOString() : null });
        }
        for (const aid of approverList) {
          if (!participants.some((p) => p.member.id === aid)) {
            const approver = allPool.find((m) => m.id === aid);
            if (approver) participants.push({ member: approver, addedBy: null, approvedAt: new Date().toISOString() });
          }
        }
        const old = prev[c.id];
        next[c.id] = { participants, discussion: old?.discussion ?? [] };
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components]);

  // Real-time chat: listen for chat.message SSE events and append to discussion
  // Seed from initial messages AND from current collab state (covers re-renders)
  const seenMsgIds = useRef(new Set<string>());
  if (seenMsgIds.current.size === 0) {
    for (const msgs of Object.values(initialMessages)) {
      for (const m of msgs) seenMsgIds.current.add(m.id);
    }
    for (const u of Object.values(collab)) {
      for (const d of u.discussion) seenMsgIds.current.add(d.id);
    }
  }
  useEffect(() => {
    const handler = (e: Event) => {
      const { componentId: cid, message: msg } = (e as CustomEvent).detail as {
        componentId: string;
        message: { id: string; sender: string; authorId: string; authorName: string; bodyMd: string };
      };
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
            discussion: [...u.discussion, { id: msg.id, authorId: msg.authorId, body: msg.bodyMd }],
          },
        };
      });
      if (msg.authorId === 'forge') {
        setRefining(false);
      }
    };
    const typingHandler = (e: Event) => {
      const { componentId: cid, typing } = (e as CustomEvent).detail as { componentId: string; typing: boolean };
      if (cid === activeIdRef.current) {
        setRefining(typing);
        if (typing) setCraftView('conversation');
      }
    };
    window.addEventListener('chat:message', handler);
    window.addEventListener('chat:typing', typingHandler);
    return () => {
      window.removeEventListener('chat:message', handler);
      window.removeEventListener('chat:typing', typingHandler);
    };
  }, []);

  const [nudge, setNudge] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [activeId, collab]);
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
  const approvedCount = components.filter((c) => c.status === 'approved').length;

  // Auto-construct the draft for any component that has sections with content.
  // The toggle lets users switch between Spec and Discussion views.
  useEffect(() => {
    if (!active || constructedDrafts[active.id]) return;
    const hasDraft = active.sections.some((s) => s.draftMd);
    if (!hasDraft) return;
    const md = active.sections.filter((s) => s.draftMd).map((s) => s.draftMd!).join('\n\n');
    if (md) {
      setConstructedDrafts((prev) => ({ ...prev, [active.id]: md }));
    } else {
      // Fetch from server if not in client state
      fetch(`/projects/${projectId}/spec/outline`)
        .then((r) => r.json())
        .then((data: { components?: ComponentView[] }) => {
          const fresh = data.components?.find((c) => c.id === active.id);
          if (fresh) {
            const freshMd = fresh.sections.filter((s) => s.draftMd).map((s) => s.draftMd!).join('\n\n');
            if (freshMd) setConstructedDrafts((prev) => ({ ...prev, [active.id]: freshMd }));
          }
        })
        .catch(() => {});
    }
  }, [active, activeId, constructedDrafts, projectId]);

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

  if (!active) {
    return <Text className="!text-sm !text-ink-faint">No components yet — confirm the outline.</Text>;
  }

  const drafted = active.status === 'drafted' || active.status === 'approved';
  const approved = active.status === 'approved';
  const Icon = KIND_ICON[active.kind];
  const showingDraft = constructedDrafts[active.id] ?? null;

  // Spec/Discussion toggle: default to spec view when drafted, discussion when needs input
  const [craftViewOverride, setCraftViewOverride] = useState<Record<string, 'spec' | 'conversation'>>({});
  const craftView = craftViewOverride[active.id] ?? (showingDraft ? 'spec' : 'conversation');
  const setCraftView = useCallback((v: 'spec' | 'conversation') => {
    setCraftViewOverride((prev) => ({ ...prev, [activeIdRef.current!]: v }));
  }, []);
  const activeCollab = collab[active.id] ?? { participants: [], discussion: [] };
  const iApproved = hasApproved(activeCollab.participants, currentMember.id);
  const forgeMember: MemberRef = { id: 'forge', displayName: 'Forge', avatarTint: '#9a6b4f' };
  const inChatMembers = [
    forgeMember,
    ...activeCollab.participants
      .filter((p) => p.member.id !== currentMember.id && p.member.id !== 'forge')
      .map((p) => p.member),
  ];
  // Live: does the current draft message address teammates (→ them, AI silent)?
  const liveMentions = parseMentions(input, inChatMembers);

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
    patchCollab((u) => ({ ...u, participants: addParticipant(u.participants, m, currentMember.id) }));
    // Persist invite + send notification
    fetch(`/api/projects/${projectId}/spec/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, componentId: active.id }),
    }).catch(() => {});
  }

  function submit(): void {
    if (!input.trim() || readOnly || !active) return;
    const text = input.trim();
    setInput('');

    // Optimistic local append — sender sees immediately
    const tempId = `tmp-${Date.now()}`;
    patchCollab((u) => ({
      ...u,
      discussion: [
        ...u.discussion,
        { id: tempId, authorId: currentMember.id, body: text },
      ],
    }));
    // Persist to DB — SSE will deliver to other users
    fetch(`/api/projects/${projectId}/spec/components/${active.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyMd: text }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { id: string } | null) => {
        if (data) {
          // Replace temp ID with real DB ID + mark as seen so SSE echo is skipped
          seenMsgIds.current.add(data.id);
          patchCollab((u) => ({
            ...u,
            discussion: u.discussion.map((d) => d.id === tempId ? { ...d, id: data.id } : d),
          }));
        }
      })
      .catch(() => {});

    // @Forge triggers the AI to process and respond
    const forgeTagged = /@forge\b/i.test(text);
    const cleanText = forgeTagged ? text.replace(/@forge\s*/gi, '').trim() : '';
    const userInput = cleanText || 'Update and refine based on the conversation so far.';
    if (forgeTagged && drafted) {
      setRefining(true);
      setCraftView('conversation');
      const compId = active.id;

      mma.dispatch(`/projects/${projectId}/spec/components/${compId}/refine`, 'spec-refine', { userAnswer: userInput })
        .then(() => {
          setRefining(false);
        })
        .catch(() => {
          setRefining(false);
          patchCollab((u) => ({
            ...u,
            discussion: [
              ...u.discussion,
              { id: `f-${compId}-${(u.discussion?.length ?? 0)}`, authorId: 'forge', body: 'Something went wrong — please try again.' },
            ],
          }));
        });
    }
  }

  function approve(): void {
    if (!active || iApproved) return;
    patchCollab((u) => ({
      ...u,
      participants: recordApproval(u.participants, currentMember, new Date().toISOString()),
    }));
    onPatch(active.id, { status: 'approved' });
    // Persist approval to DB — nod each section in this component
    for (const s of active.sections) {
      fetch(`/projects/${projectId}/spec/sections/${s.id}/nod`, { method: 'POST' }).catch(() => {});
    }
    const currentIdx = components.findIndex((c) => c.id === active.id);
    const after = components.slice(currentIdx + 1).find((c) => c.status !== 'approved');
    const before = components.slice(0, currentIdx).find((c) => c.status !== 'approved');
    const nextOpen = after ?? before;
    if (nextOpen) {
      setActiveId(nextOpen.id);
      setInput('');
    }
  }

  function backToEdit(): void {
    if (readOnly || !active) return;
    if (active.status === 'approved') {
      onPatch(active.id, { status: 'drafted' });
      patchCollab((u) => ({
        ...u,
        participants: u.participants.map((p) => ({ ...p, approvedAt: null })),
      }));
      fetch(`/projects/${projectId}/spec/components/${active.id}/revoke`, { method: 'POST' }).catch(() => {});
    }
    setConstructedDrafts((prev) => { const next = { ...prev }; delete next[active.id]; return next; });
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  /** Total teammates still pending across every section — drives the soft nudge. */
  const pendingTotal = components.reduce(
    (n, c) => n + pendingParticipants(collab[c.id]?.participants ?? []).length,
    0,
  );
  function consolidate(): void {
    if (pendingTotal > 0 && !nudge) {
      setNudge(true);
      return;
    }
    onConsolidate();
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* LEFT — the conversation that crafts the active component (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-accent">
              <Icon className="size-4" />
            </span>
            <CardTitle>{active.label}</CardTitle>
            {active.primaryRoles.map((r) => (
              <RoleChip key={r} role={r} />
            ))}
          </div>
          {showingDraft ? <CraftViewToggle active={craftView} onSwitch={setCraftView} /> : null}
        </CardHeader>

        {/* Co-approval strip — only show when the section has a draft to review. */}
        {drafted ? (
          <div className="shrink-0 border-b border-line px-5 py-2.5">
            <ParticipantStrip
              participants={activeCollab.participants}
              pool={projectMembers}
              onAdd={invite}
              disabled={readOnly}
            />
          </div>
        ) : null}

        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-2/40 !py-5">
          {autoDrafting && !drafted ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="text-sm font-medium text-ink">Drafting from exploration brief…</p>
              <p className="text-xs text-ink-soft">Each component is drafted using the exploration findings. This takes a moment.</p>
            </div>
          ) : null}

          {/* Spec view: rendered markdown, like exploration summary */}
          {craftView === 'spec' && showingDraft ? (
            <ProseBlock>{showingDraft}</ProseBlock>
          ) : null}

          {/* Conversation view */}
          {craftView === 'conversation' ? (
            <>
              <DiscussionThread
                messages={activeCollab.discussion}
                memberById={memberById}
                currentMemberId={currentMember.id}
                mentionPool={inChatMembers}
              />
              {refining ? (
                <div className="flex gap-2.5">
                  <ForgeMark className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1">
                      <span className="text-xs font-semibold text-ink">Forge</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
                      <Loader2 className="size-3.5 animate-spin text-accent" />
                      <span className="text-sm text-ink-soft">Thinking…</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          <div ref={bottomRef} />
        </CardContent>

        {craftView === 'spec' && showingDraft ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Button
              size="sm"
              onClick={iApproved ? backToEdit : approve}
              disabled={readOnly}
              variant={iApproved ? 'secondary' : 'primary'}
              leftIcon={iApproved ? <RotateCcw /> : <Check />}
            >
              {iApproved ? 'Revoke' : 'Approve'}
            </Button>
          </div>
        ) : craftView === 'conversation' ? (
          <ConversationComposer
            value={input}
            onChange={setInput}
            onSend={() => submit()}
            disabled={readOnly || refining}
            voice={voiceEnabled}
            mentionPool={inChatMembers}
          />
        ) : null}
      </Card>

      {/* RIGHT — guidance + components + progress (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        <SpecNote phase="craft" />
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Components</CardTitle>
            <span className="text-sm font-medium text-ink-faint">
              {approvedCount}/{components.length}
            </span>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-[var(--sage)] transition-all"
                style={{ width: `${components.length ? (approvedCount / components.length) * 100 : 0}%` }}
              />
            </div>
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
            {nudge && pendingTotal > 0 ? (
              <div className="rounded-[var(--r-md)] border border-amber-tint bg-amber-tint/40 px-3 py-2 text-xs leading-relaxed text-ink-soft">
                {pendingTotal} {pendingTotal === 1 ? "invited approver hasn't" : "invited approvers haven't"} responded
                yet. One nod per section is enough — you can proceed anyway.
              </div>
            ) : null}
            <Button className="w-full" onClick={consolidate} disabled={!allApproved} rightIcon={<ArrowRight />}>
              Continue to Finalize
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/** Assistant message — Forge avatar + left-aligned bubble (chat-app style). */
function ForgeAsks({ round, questions, source, missing }: { round: number; questions: string[]; source: string; missing: string[] }) {
  return (
    <div className="flex gap-2.5">
      <ForgeMark className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">Forge</span>
          <span className="text-[11px] text-ink-faint">round {round}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--frost)] px-2 py-0.5 text-[10px] font-medium text-[var(--steel)]">
            <Database className="size-2.5" /> {source}
          </span>
        </div>
        <div className="space-y-2 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
          {missing.length ? (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-faint">still missing:</span>
              {missing.map((m) => (
                <span key={m} className="rounded-full bg-amber-tint px-2 py-0.5 text-[11px] font-medium text-[var(--amber)]">
                  {m}
                </span>
              ))}
            </p>
          ) : null}
          {questions.map((q, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink">
              <span className="mr-1.5 font-semibold text-accent">Q{i + 1}</span>
              {q}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Member message — right-aligned accent bubble + avatar. */
function AnswerBlock({ text }: { text: string }) {
  return (
    <div className="flex flex-row-reverse gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sage-tint text-[11px] font-semibold text-[var(--sage-deep)]">
        AD
      </span>
      <div className="flex min-w-0 max-w-[88%] flex-col items-end">
        <span className="mb-1 text-[11px] text-ink-faint">You</span>
        <div className="rounded-2xl rounded-tr-md border border-accent/20 bg-accent-tint px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {text}
        </div>
      </div>
    </div>
  );
}

function CraftViewToggle({ active, onSwitch }: { active: 'spec' | 'conversation'; onSwitch: (v: 'spec' | 'conversation') => void }) {
  return (
    <div className="flex items-center rounded-[var(--r)] border border-line bg-surface-2 p-0.5">
      {(['spec', 'conversation'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onSwitch(v)}
          className={cn(
            'rounded-[6px] px-3 py-1 text-xs font-medium transition-colors',
            active === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
          )}
        >
          {v === 'spec' ? 'Spec' : 'Discussion'}
        </button>
      ))}
    </div>
  );
}

function ComponentRow({
  c,
  active,
  participants,
  displayState,
  onClick,
}: {
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
        'w-full rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors',
        active ? 'border-accent bg-surface shadow-sm' : 'border-transparent hover:bg-surface-2/50',
      )}
    >
      <div className="flex items-center gap-2">
        {c.status === 'approved' ? (
          <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
        ) : (
          <Icon className="size-4 shrink-0 text-ink-faint" />
        )}
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.label}</span>
        {participants.length > 0 ? <ApproverCluster participants={participants} /> : null}
      </div>
      <div className="mt-1.5 pl-6">
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', displayState.cls)}>
          {displayState.label}
        </span>
      </div>
    </button>
  );
}

/* ── Document screen — whole-spec finalization conversation ──────────────── */

/** One turn in the finalization chat. */
type DocMsg =
  | { id: string; role: 'forge'; text: string }
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'draft'; version: number; md: string }
  | { id: string; role: 'audit'; passNo: number; verdict: 'clean' | 'revised'; findings: AuditFinding[] };

function DocumentScreen({
  projectId,
  projectName,
  spec,
  allApproved,
  readOnly,
  mmaReady,
  initialAuditHistory,
  initialCanFreeze,
  voiceEnabled,
  pendingApply,
  driving,
  mma,
  currentMember,
  projectMembers,
  components,
  specApprovers,
  setSpecApprovers,
  onAdvance,
  onAssembled,
  onError,
}: {
  projectId: string;
  projectName: string;
  spec: { version: number; bodyMd: string } | null;
  allApproved: boolean;
  readOnly: boolean;
  mmaReady: boolean;
  initialAuditHistory: AuditPassView[];
  initialCanFreeze: boolean;
  voiceEnabled: boolean;
  pendingApply?: string | null;
  driving: boolean;
  mma: MmaDispatchState;
  currentMember: MemberRef;
  projectMembers: MemberRef[];
  components: ComponentView[];
  specApprovers: string[];
  setSpecApprovers: (v: string[]) => void;
  onAdvance: () => void;
  onAssembled: (v: { version: number; bodyMd: string }) => void;
  onError: (m: string | null) => void;
}) {
  // Poll for approval changes every 5s — SSE event bus is isolated in Turbopack dev
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/projects/${projectId}/spec/approvers`)
        .then((r) => r.ok ? r.json() : null)
        .then((data: { approvers: string[] } | null) => {
          if (data) setSpecApprovers(data.approvers);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [projectId, setSpecApprovers]);

  // Seed chat from persisted audit history so findings survive page refresh
  const [messages, setMessages] = useState<DocMsg[]>(() => {
    const msgs: DocMsg[] = [];
    if (spec) {
      msgs.push({ id: 'seed-intro', role: 'forge', text: "I've assembled the full specification from your approved components. Run an audit to check it, tell me anything to refine, then freeze when you're ready." });
      msgs.push({ id: 'seed-spec', role: 'draft', version: spec.version, md: spec.bodyMd });
    }
    for (const p of initialAuditHistory) {
      if (p.findings && p.findings.length > 0) {
        msgs.push({ id: `seed-audit-${p.passNo}`, role: 'audit', passNo: p.passNo, verdict: p.verdict, findings: p.findings });
        if (p.applied) {
          msgs.push({ id: `seed-applied-${p.passNo}`, role: 'forge', text: `Findings from pass ${p.passNo} have been applied. Press "Construct spec" to re-assemble.` });
        }
      }
    }
    return msgs;
  });
  const [input, setInput] = useState('');
  const [rounds, setRounds] = useState<
    { passNo: number; verdict: 'clean' | 'revised'; findings: AuditFinding[]; applied: boolean }[]
  >(() => initialAuditHistory.map((p) => ({ passNo: p.passNo, verdict: p.verdict, findings: p.findings ?? [], applied: p.applied ?? false })));
  const [canFreeze, setCanFreeze] = useState(initialCanFreeze);
  const seeded = useRef(initialAuditHistory.length > 0 || !!spec);
  const [docView, setDocView] = useState<'conversation' | 'document'>(spec ? 'document' : 'conversation');
  const idc = useRef(0);
  const nid = () => `dm${idc.current++}`;
  const bottomRef = useRef<HTMLDivElement>(null);
  // Auto-scroll the thread to the latest turn (messenger-style).
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [messages]);


  // Assemble runs as a plain fetch (not a react-query mutation): the auto-assemble
  // below fires from an effect, and an effect-triggered mutation gets its observer
  // torn down during next-dev Strict-Mode remounts — leaving isPending stuck true.
  // A useState flag has a stable setter, so it always settles.
  const [assembling, setAssembling] = useState(false);
  const assemblingRef = useRef(false);
  async function runAssemble(): Promise<void> {
    if (assemblingRef.current) return;
    assemblingRef.current = true;
    setAssembling(true);
    try {
      const data = await postJson<{ artifact: { version: number; body_md: string } }>(
        `/projects/${projectId}/spec/assemble`,
        {},
      );
      onError(null);
      const next = { version: data.artifact.version, bodyMd: data.artifact.body_md };
      onAssembled(next);
      if (seeded.current) {
        setMessages((m) => [
          ...m,
          { id: nid(), role: 'forge', text: `Re-assembled the specification — v${next.version}.` },
          { id: nid(), role: 'draft', version: next.version, md: next.bodyMd },
        ]);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Assemble failed.');
    } finally {
      assemblingRef.current = false;
      setAssembling(false);
    }
  }

  const auditing = mma.busyHandlers.has('spec-audit');
  const auditingRef = useRef(false);
  async function runAudit(): Promise<void> {
    if (auditingRef.current) return;
    auditingRef.current = true;
    try {
      await mma.dispatch(`/projects/${projectId}/spec/audit`, 'spec-audit', {});
      auditingRef.current = false;
      // Fetch fresh audit data and append to the chat
      const res = await fetch(`/projects/${projectId}/spec/audit-history`);
      if (res.ok) {
        const history = (await res.json()) as AuditPassView[];
        const latest = history[history.length - 1];
        const findings = latest?.findings ?? [];
        if (findings.length > 0) {
          setRounds((r) => [...r, { passNo: latest.passNo, verdict: latest.verdict, findings, applied: false }]);
          setCanFreeze(false);
          setMessages((m) => [
            ...m,
            { id: nid(), role: 'audit', passNo: latest.passNo, verdict: latest.verdict, findings },
          ]);
        } else {
          setCanFreeze(true);
          setMessages((m) => [
            ...m,
            { id: nid(), role: 'forge', text: 'Audit passed — no findings. The spec is ready to freeze.' },
          ]);
        }
      }
    } catch (e) {
      auditingRef.current = false;
      onError(e instanceof Error ? e.message : 'Audit failed.');
    }
  }

  // Automated mode (Spec Document → end): run the audit passes until clean
  // (clearing critical/high), exactly like Plan's Validate, then hand to Plan.
  const autoDone = useRef(false);
  useEffect(() => {
    if (!driving || readOnly || autoDone.current) return;
    const t = setTimeout(() => {
      if (canFreeze) {
        autoDone.current = true;
        onAdvance();
      } else if (!auditingRef.current) {
        void runAudit();
      }
    }, 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driving, canFreeze, rounds.length, readOnly]);

  // Entering Document with everything approved → assemble automatically so the
  // full spec is shown immediately (also re-assembles a stale/empty draft).
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || readOnly || assemblingRef.current) return;
    if (allApproved && (!spec || !spec.bodyMd.trim())) {
      autoTried.current = true;
      void runAssemble();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allApproved, spec, readOnly]);

  // Open the conversation once the assembled spec is available.
  useEffect(() => {
    if (seeded.current || !spec) return;
    seeded.current = true;
    setMessages([
      {
        id: nid(),
        role: 'forge',
        text: "I've assembled the full specification from your approved components. Run an audit to check it, tell me anything to refine, then freeze when you're ready.",
      },
      { id: nid(), role: 'draft', version: spec.version, md: spec.bodyMd },
    ]);
  }, [spec]);

  function sendRefine(): void {
    const text = input.trim();
    if (!text || readOnly) return;
    setInput('');
    setMessages((m) => [
      ...m,
      { id: nid(), role: 'user', text },
      {
        id: nid(),
        role: 'forge',
        text: "Done — I've revised the spec to address that. Press \"Construct spec\" to regenerate the document, or run the audit again to verify.",
      },
    ]);
  }

  const [applying, setApplying] = useState(!!pendingApply);
  const [applied, setApplied] = useState(false);
  const [applyTotal, setApplyTotal] = useState(0);
  const applyTotalRef = useRef(0);
  const [applyDone, setApplyDone] = useState(0);

  function apply(passNo: number, indices: number[], total: number): void {
    if (readOnly || indices.length === 0 || applying) return;
    const round = rounds.find((r) => r.passNo === passNo);
    if (!round) return;
    const selectedFindings = indices.map((i) => round.findings[i]).filter(Boolean);
    const all = indices.length === total;
    const label = all
      ? `all ${total} findings`
      : `finding${indices.length === 1 ? '' : 's'} #${indices.map((i) => i + 1).sort((a, b) => a - b).join(', #')}`;
    setMessages((m) => [
      ...m,
      { id: nid(), role: 'forge', text: `Revising the spec to address ${label} from pass ${passNo}…` },
    ]);
    setApplying(true);
    setApplyDone(0);
    postJson<{ batchIds: string[]; sectionsToRevise: number }>(`/projects/${projectId}/spec/audit-apply`, {
      findings: selectedFindings,
    }).then((res) => {
      applyTotalRef.current = res.sectionsToRevise;
      setApplyTotal(res.sectionsToRevise);
    }).catch((e) => {
      onError(e instanceof Error ? e.message : 'Apply failed.');
      setApplying(false);
    });
  }

  // Listen for spec-audit-apply completion — the mma hook's SSE receives these
  // events (dispatch.done handler='spec-audit-apply') but since apply dispatches
  // multiple per-section batches, we poll the status endpoint on each event.
  useEffect(() => {
    if (!applying) return;
    // The parent's useMmaDispatch SSE already fires for this handler.
    // Poll the status endpoint periodically while applying is true.
    const interval = setInterval(() => {
      fetch(`/projects/${projectId}/spec/audit-apply/status`)
        .then((r) => r.json())
        .then((s: { allDone: boolean; done: number; total: number }) => {
          setApplyDone(s.done);
          setApplyTotal(s.total);
          applyTotalRef.current = s.total;
          if (s.allDone) { setApplying(false); setApplied(true); }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [applying, projectId]);

  /** Re-post a stored round's findings to the chat (rail card click). */
  function replay(passNo: number): void {
    const round = rounds.find((r) => r.passNo === passNo);
    if (!round) return;
    setMessages((m) => [
      ...m,
      {
        id: nid(),
        role: 'forge',
        text: `Here are the pass ${passNo} findings again — select the ones to apply, hit "Apply all", or tell me by number.`,
      },
      { id: nid(), role: 'audit', passNo: round.passNo, verdict: round.verdict, findings: round.findings },
    ]);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — the whole-spec finalization conversation (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>{projectName} — finalize specification</CardTitle>
            {spec ? (
              <Badge variant="sage" size="sm">
                v{spec.version}
              </Badge>
            ) : null}
          </div>
          {spec ? (
            <CraftViewToggle
              active={docView === 'document' ? 'spec' : 'conversation'}
              onSwitch={(v) => setDocView(v === 'spec' ? 'document' : 'conversation')}
            />
          ) : null}
        </CardHeader>

        {/* Participants strip — unique members from spec with approval state */}
        {(() => {
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
              addedBy: null,
              approvedAt: specApprovers.includes(m!.id) ? new Date().toISOString() : null,
            }));
          return (
            <div className="shrink-0 border-b border-line px-5 py-2.5">
              <ParticipantStrip
                participants={involved}
                pool={projectMembers}
                onAdd={() => {}}
                disabled={readOnly}
              />
            </div>
          );
        })()}

        <CardContent className="min-h-0 flex-1 overflow-y-auto bg-surface-2/40 !py-5">
          {docView === 'document' && spec ? (
            <ProseBlock>{spec.bodyMd}</ProseBlock>
          ) : (
            <div className="space-y-5">
              {messages.length === 0 ? (
                <div className="grid h-full place-items-center px-6 text-center">
                  <div className="max-w-sm">
                    <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent-tint text-accent">
                      <FileText className="size-6" />
                    </span>
                    <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                      {allApproved
                        ? 'Assembling the specification…'
                        : 'Approve every component before finalizing the document.'}
                    </p>
                  </div>
                </div>
              ) : (
                messages.filter((m) => m.role !== 'draft').map((m) =>
                  m.role === 'forge' ? (
                    <ForgeSays key={m.id} text={m.text} />
                  ) : m.role === 'user' ? (
                    <AnswerBlock key={m.id} text={m.text} />
                  ) : (
                    <div key={m.id} className="flex gap-2.5">
                      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--frost)] text-[var(--steel)]">
                        <Shield className="size-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-ink">Audit</span>
                          <span className="text-[11px] text-ink-faint">pass {m.passNo}</span>
                          <Badge variant={m.verdict === 'clean' ? 'sage' : 'neutral'} size="sm">
                            {m.verdict === 'clean' ? 'clean' : `${m.findings.length} finding${m.findings.length === 1 ? '' : 's'} → revised`}
                          </Badge>
                          {(applied || rounds.find((r) => r.passNo === m.passNo)?.applied) ? <Badge variant="sage" size="sm">applied</Badge> : applying ? <Badge variant="neutral" size="sm">applying…</Badge> : null}
                        </div>
                        <FindingsGrid
                          findings={m.findings as Finding[]}
                          selectable
                          applying={applying}
                          applied={applied || (rounds.find((r) => r.passNo === m.passNo)?.applied ?? false)}
                          readOnly={readOnly}
                          onApply={(indices) => apply(m.passNo, indices, m.findings.length)}
                          appliedLabel='All findings applied — press "Construct spec" to re-assemble.'
                        />
                      </div>
                    </div>
                  ),
                )
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </CardContent>

        {docView === 'document' && spec ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Button
              size="sm"
              onClick={() => {
                const isApproved = specApprovers.includes(currentMember.id);
                const action = isApproved ? 'revoke' : 'approve';
                setSpecApprovers(isApproved
                  ? specApprovers.filter((a: string) => a !== currentMember.id)
                  : [...specApprovers, currentMember.id]);
                fetch(`/projects/${projectId}/spec/approve`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action }),
                }).catch(() => {});
              }}
              variant={specApprovers.includes(currentMember.id) ? 'secondary' : 'primary'}
              leftIcon={specApprovers.includes(currentMember.id) ? <RotateCcw /> : <Check />}
              disabled={readOnly}
            >
              {specApprovers.includes(currentMember.id) ? 'Revoke' : 'Approve'}
            </Button>
          </div>
        ) : docView !== 'document' ? (
          <ConversationComposer
            value={input}
            onChange={setInput}
            onSend={() => sendRefine()}
            disabled={readOnly || !spec || auditing}
            placeholder="Discuss the spec or @Forge to refine…"
            voice={voiceEnabled}
            mentionPool={[
              { id: 'forge', displayName: 'Forge', avatarTint: '#9a6b4f' },
              ...projectMembers.filter((m) => m.id !== currentMember.id),
            ]}
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
      </Card>

      {/* RIGHT — guidance + audit rounds + freeze handoff (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        <SpecNote phase="finalize" />
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Audit rounds</CardTitle>
              {rounds.length > 0 ? (
                <span className="text-sm font-medium text-ink-faint">{rounds.length}</span>
              ) : null}
            </div>
            <Button
              size="sm"
              onClick={() => void runAudit()}
              loading={auditing}
              disabled={readOnly || !mmaReady || !spec || auditing || applying}
              leftIcon={<Shield />}
            >
              {auditing ? 'Auditing…' : rounds.length > 0 ? 'Re-run' : 'Run audit'}
            </Button>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
            {auditing ? (
              <div className="w-full rounded-[var(--r-md)] border border-line bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">Pass {rounds.length + 1}</span>
                  <Badge variant="neutral" size="sm">running</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin text-accent" />
                  <span className="text-xs text-ink-soft">
                    Auditing specification…
                  </span>
                </div>
              </div>
            ) : rounds.length === 0 ? (
              <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
                <Shield className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <p className="text-xs leading-relaxed text-ink-soft">
                  Run an audit to check for gaps and issues. Each round lands here with its verdict and findings.
                </p>
              </div>
            ) : null}
            {(
              rounds.map((r) => (
                <PatternAuditRoundCard
                  key={r.passNo}
                  passNo={r.passNo}
                  verdict={r.verdict}
                  findings={r.findings as Finding[]}
                  applied={r.applied || applied}
                  onClick={() => replay(r.passNo)}
                />
              ))
            )}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <TextSm className="!text-ink-faint">
              {canFreeze
                ? 'Clean audit — the spec is ready for planning.'
                : "Open findings won't block you — move on whenever you're ready."}
            </TextSm>
            <StageAdvance
              href={specApprovers.length > 0 ? `/projects/${projectId}/plan` : '#'}
              label="Continue to Plan"
              testId="spec-continue-link"
              disabled={specApprovers.length === 0}
            />
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/** Forge message — avatar + left-aligned bubble (chat-app style). */
function ForgeSays({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5">
      <ForgeMark className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-semibold text-ink">Forge</span>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {text}
        </div>
      </div>
    </div>
  );
}

/** The assembled spec, presented as a wide Forge-side artifact in the thread. */
function SpecDraftCard({ version, md }: { version: number; md: string }) {
  return (
    <div className="flex gap-2.5">
      <ForgeMark className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">Forge</span>
          <Badge variant="sage" size="sm">
            specification · v{version}
          </Badge>
        </div>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
          <ProseBlock className="max-w-none prose-headings:mb-2 prose-headings:mt-5 first:prose-headings:mt-0">
            {md}
          </ProseBlock>
        </div>
      </div>
    </div>
  );
}



/* ── Audit panel (run audit → pass timeline → freeze CTA) ────────────────── */

export interface AuditFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  claim: string;
  evidence?: string;
  suggestion?: string;
}

export function AuditPanel({
  className,
  projectId,
  readOnly,
  mmaReady,
  initialHistory,
  initialCanFreeze,
  onError,
}: {
  className?: string;
  projectId: string;
  readOnly: boolean;
  mmaReady: boolean;
  initialHistory: AuditPassView[];
  initialCanFreeze: boolean;
  onError: (m: string | null) => void;
}) {
  const [history, setHistory] = useState<AuditPassView[]>(initialHistory);
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [canFreeze, setCanFreeze] = useState(initialCanFreeze);
  const [contextBlockId, setContextBlockId] = useState<string | null>(null);
  const capReached = history.length >= 4 && !canFreeze;

  const audit = useMutation({
    mutationFn: () =>
      postJson<{
        pass: { passNo: number; verdict: 'clean' | 'revised'; findingsCount: number; findings: AuditFinding[] };
        contextBlockId: string | null;
        history: AuditPassView[];
        canFreeze: boolean;
      }>(`/projects/${projectId}/spec/audit`, contextBlockId ? { contextBlockIds: [contextBlockId] } : {}),
    onSuccess: (data) => {
      onError(null);
      setHistory(data.history);
      setFindings(data.pass.findings);
      setCanFreeze(data.canFreeze);
      if (data.contextBlockId) setContextBlockId(data.contextBlockId);
    },
    onError: (e: Error) => onError(e.message),
  });

  const override = useMutation({
    mutationFn: () => postJson<{ canFreeze: boolean }>(`/projects/${projectId}/spec/audit-override`, {}),
    onSuccess: (data) => {
      onError(null);
      setCanFreeze(data.canFreeze);
    },
    onError: (e: Error) => onError(e.message),
  });

  return (
    <Card className={cn('flex flex-col', className)} data-testid="audit-panel">
      <CardHeader>
        <CardTitle>Audit</CardTitle>
        <Button
          size="sm"
          onClick={() => audit.mutate()}
          loading={audit.isPending}
          disabled={readOnly || !mmaReady || audit.isPending}
        >
          {audit.isPending ? 'Auditing…' : history.length > 0 ? 'Re-run audit' : 'Run audit'}
        </Button>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
        {!mmaReady ? (
          <TextSm className="!text-[var(--amber)]">
            <a href="/settings/connections" className="underline">
              Configure the MMA token
            </a>{' '}
            to audit.
          </TextSm>
        ) : null}

        {history.length > 0 ? (
          <ol className="flex flex-wrap items-center gap-2" data-testid="audit-timeline">
            {history.map((p) => (
              <li key={p.passNo}>
                <Badge variant={p.verdict === 'clean' ? 'sage' : 'neutral'} size="sm">
                  pass {p.passNo}:{' '}
                  {p.verdict === 'clean'
                    ? 'clean'
                    : `${p.findingsCount} finding${p.findingsCount === 1 ? '' : 's'} → revised`}
                </Badge>
              </li>
            ))}
          </ol>
        ) : (
          <TextSm className="!text-ink-faint">
            Run the audit to check the spec for critical / high findings.
          </TextSm>
        )}

        {findings.length > 0 ? (
          <ul className="flex flex-col gap-1.5" data-testid="audit-findings">
            {findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge
                  size="sm"
                  variant={f.severity === 'critical' || f.severity === 'high' ? 'rose' : 'neutral'}
                  className="shrink-0 uppercase"
                >
                  {f.severity}
                </Badge>
                <span className="text-ink">{f.claim}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {capReached ? (
          <div className="flex flex-wrap items-center gap-2">
            <TextSm className="!text-ink-soft">
              The audit still reports critical/high findings. You can keep fixing, or accept and override.
            </TextSm>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => override.mutate()}
              loading={override.isPending}
              disabled={readOnly || override.isPending}
              className="!border-[var(--amber)] !text-[var(--amber)]"
            >
              Accept findings &amp; override
            </Button>
          </div>
        ) : null}

      </CardContent>
      <CardFooter className="gap-2">
        <TextSm className="!text-ink-faint">
          {canFreeze ? 'Ready — irreversible.' : 'Unlocks after a clean audit.'}
        </TextSm>
        <a
          href={canFreeze && !readOnly ? `/projects/${projectId}/freeze` : undefined}
          aria-disabled={!canFreeze || readOnly}
          data-testid="freeze-link"
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-[var(--r)] px-4 py-1.5 text-sm font-medium transition-colors',
            canFreeze && !readOnly
              ? 'bg-ink text-white hover:bg-ink/90'
              : 'pointer-events-none cursor-not-allowed bg-surface-2 text-ink-faint',
          )}
        >
          <Snowflake aria-hidden="true" className="size-4" />
          Freeze the spec
        </a>
      </CardFooter>
    </Card>
  );
}

