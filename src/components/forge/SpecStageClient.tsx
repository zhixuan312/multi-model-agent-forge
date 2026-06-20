'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  type LucideIcon,
} from 'lucide-react';
import { Markdown } from '@/components/forge/Markdown';
import { RoleChip } from '@/components/forge/RoleChip';
import { ForgeMark } from '@/components/forge/ForgeMark';
import { useRouter } from 'next/navigation';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { StageAdvance } from '@/components/forge/StageAdvance';
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
  Textarea,
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
}

/** Pre-authored Craft content (mock) — question rounds + the constructed draft per component. */
interface CraftSeed {
  questions: string[][];
  draftMd: string;
}

type SpecPhase = 'outline' | 'craft' | 'document';

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
  const [components, setComponents] = useState<ComponentView[]>(props.initialComponents);
  const [spec, setSpec] = useState(props.initialSpec);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');
  // Intent carried forward from the Exploration brief (no longer hand-typed here).
  const [intent] = useState(props.intentMd ?? '');
  const [picked, setPicked] = useState<Set<ComponentKind>>(
    () => new Set(components.length > 0 ? components.map((c) => c.kind) : props.defaultKinds),
  );
  const [phase, setPhase] = useState<SpecPhase>(
    components.length === 0 ? 'outline' : spec ? 'document' : 'craft',
  );
  const needsAutoDraft = components.length > 0 && components.some(
    (c) => c.sections.some((s) => s.status === 'gathering' && !s.draftMd),
  );
  const [autoDrafting, setAutoDrafting] = useState(
    () => phase === 'craft' && needsAutoDraft,
  );
  const [sectionQuestions, setSectionQuestions] = useState<Record<string, string[]>>({});
  const autoDraftFired = useRef(false);

  // Auto-trigger drafting when landing on craft with undrafted sections.
  useEffect(() => {
    if (phase !== 'craft' || !needsAutoDraft || autoDraftFired.current) return;
    autoDraftFired.current = true;
    setAutoDrafting(true);
    fetch(`/projects/${props.projectId}/spec/auto-draft`, { method: 'POST' })
      .then((r) => r.json())
      .then((data: { components?: ComponentView[]; sections?: { componentKind: string; sectionKey: string; questions: string[] }[] }) => {
        if (data.components) setComponents(data.components);
        if (data.sections) {
          const qMap: Record<string, string[]> = {};
          for (const s of data.sections) qMap[`${s.componentKind}:${s.sectionKey}`] = s.questions;
          setSectionQuestions(qMap);
        }
      })
      .catch(() => {})
      .finally(() => setAutoDrafting(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, needsAutoDraft]);

  // Publish the live sub-phase to the stepper (Outline · Craft · Document).
  useEffect(() => stagePhaseStore.set(phase), [phase]);
  // Let the stepper's sub-phase chips jump back to a phase (Craft/Document need a confirmed outline).
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'outline' || ((key === 'craft' || key === 'document') && components.length > 0)) {
          setPhase(key as SpecPhase);
        }
      }),
    [components.length],
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
        disabled={readOnly || phase !== 'document'}
        idleHint={
          phase === 'document'
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
            setPhase('craft');
            setAutoDrafting(true);
            fetch(`/projects/${props.projectId}/spec/auto-draft`, { method: 'POST' })
              .then((r) => r.json())
              .then((data: { components?: ComponentView[]; sections?: { componentKind: string; sectionKey: string; questions: string[] }[] }) => {
                if (data.components) setComponents(data.components);
                if (data.sections) {
                  const qMap: Record<string, string[]> = {};
                  for (const s of data.sections) {
                    qMap[`${s.componentKind}:${s.sectionKey}`] = s.questions;
                  }
                  setSectionQuestions(qMap);
                }
              })
              .catch(() => {})
              .finally(() => setAutoDrafting(false));
          }}
          onError={setError}
        />
      ) : phase === 'craft' ? (
        <CraftStage
          projectId={props.projectId}
          components={components}
          readOnly={readOnly}
          autoDrafting={autoDrafting}
          sectionQuestions={sectionQuestions}
          allApproved={allApproved}
          craftContent={props.craftContent}
          currentMember={props.currentMember}
          projectMembers={props.projectMembers ?? []}
          craftCollab={props.craftCollab ?? {}}
          onPatch={(id, patch) =>
            setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
          }
          onEditOutline={() => setPhase('outline')}
          onConsolidate={() => setPhase('document')}
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
          driving={auto === 'running'}
          onAdvance={() => router.push(`/projects/${props.projectId}/plan?auto=1`)}
          onAssembled={(v) => setSpec(v)}
          onError={setError}
        />
      )}
    </div>
  );
}

/** Flow navigation for the sections/document phases (not tabs — natural forward/back). */
/** Standing guidance — the accent-tint note every stage's rail carries. */
function SpecNote() {
  return (
    <div className="flex shrink-0 items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4">
      <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
        <Lightbulb className="size-5" />
      </span>
      <div className="min-w-0">
        <Eyebrow as="h3" className="text-accent-deep">
          How the spec works
        </Eyebrow>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          Pick the skeleton here, then Forge interviews you <span className="font-medium text-ink">section by section</span>{' '}
          — in any order — and consolidates your answers into one specification document.
        </p>
      </div>
    </div>
  );
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
          <Button
            size="sm"
            onClick={() => confirm.mutate()}
            loading={confirm.isPending}
            disabled={readOnly || !valid || confirm.isPending}
            rightIcon={<ArrowRight />}
          >
            {confirm.isPending ? 'Confirming…' : 'Confirm outline'}
          </Button>
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
        <SpecNote />
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Template</CardTitle>
            <Micro className="!text-ink-faint">Sets the components</Micro>
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

function componentDisplayState(
  c: ComponentView,
  autoDrafting?: boolean,
  sectionQuestions?: Record<string, string[]>,
): DisplayState {
  if (c.status === 'approved') return { label: 'Approved', cls: 'bg-sage-tint text-[var(--sage-deep)]' };
  if (c.status === 'drafted') {
    const aiSatisfied = c.sections.every((s) => s.aiSatisfied);
    if (aiSatisfied) return { label: 'Ready', cls: 'bg-accent-tint text-accent' };
    // Check if there are questions from auto-draft
    const hasQuestions = c.sections.some((s) => {
      const qKey = `${c.kind}:${s.key}`;
      return (sectionQuestions?.[qKey]?.length ?? 0) > 0;
    });
    if (hasQuestions) return { label: 'Needs input', cls: 'bg-amber-tint text-[var(--amber)]' };
    return { label: 'Ready', cls: 'bg-accent-tint text-accent' };
  }
  if (autoDrafting) return { label: 'Drafting...', cls: 'bg-surface-2 text-ink-soft' };
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
  sectionQuestions,
  craftContent,
  currentMember,
  projectMembers,
  craftCollab,
  onPatch,
  onEditOutline,
  onConsolidate,
}: {
  projectId: string;
  components: ComponentView[];
  readOnly: boolean;
  allApproved: boolean;
  autoDrafting?: boolean;
  sectionQuestions?: Record<string, string[]>;
  craftContent?: Record<string, CraftSeed>;
  currentMember: MemberRef;
  projectMembers: MemberRef[];
  craftCollab: Partial<Record<ComponentKind, UnitCollab>>;
  onPatch: (id: string, patch: Partial<ComponentView>) => void;
  onEditOutline: () => void;
  onConsolidate: () => void;
}) {
  const firstOpen = components.find((c) => c.status !== 'approved') ?? components[0];
  const [activeId, setActiveId] = useState<string | null>(firstOpen?.id ?? null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [input, setInput] = useState('');
  // Per-component view: 'dialogue' (Forge message + input) or 'constructed' (showing draft)
  // All drafted components start as constructed (auto-pressed).
  const [constructed, setConstructed] = useState<Set<string>>(
    () => new Set(components.filter((c) => c.status === 'drafted' || c.status === 'approved').map((c) => c.id)),
  );
  // Track which components the user manually un-constructed (Back to edit).
  const [manuallyEditing, setManuallyEditing] = useState<Set<string>>(new Set());
  const [refining, setRefining] = useState(false);
  const [sectionHistory, setSectionHistory] = useState<Record<string, { role: 'forge' | 'user'; text: string }[]>>({});

  // Auto-construct newly drafted components ONLY if not manually editing.
  useEffect(() => {
    const draftedIds = components
      .filter((c) => (c.status === 'drafted' || c.status === 'approved') && !manuallyEditing.has(c.id))
      .map((c) => c.id);
    setConstructed((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of draftedIds) { if (!next.has(id)) { next.add(id); changed = true; } }
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components]);
  // Collaborative state per component (participants + group chat), seeded by kind.
  const [collab, setCollab] = useState<Record<string, UnitCollab>>(() => {
    const out: Record<string, UnitCollab> = {};
    for (const c of components) {
      const seed = craftCollab[c.kind];
      out[c.id] = seed
        ? {
            participants: seed.participants.map((p) => ({ ...p })),
            discussion: seed.discussion.map((d) => ({ ...d })),
          }
        : { participants: [], discussion: [] };
    }
    return out;
  });
  const [nudge, setNudge] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  // Auto-scroll the thread to the latest turn (messenger-style).
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [activeId, answers, collab]);
  // When a section gets drafted (Construct), bring the freshly-built draft into
  // view — otherwise it lands below the fold and the click feels like a no-op.
  const draftedNow = activeId
    ? components.find((c) => c.id === activeId)?.status === 'drafted' ||
      components.find((c) => c.id === activeId)?.status === 'approved'
    : false;
  useEffect(() => {
    if (draftedNow) draftRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [draftedNow, activeId]);

  // The dual gate: a drafted section auto-approves once ANY participant has
  // nodded (so a teammate's approval alone is enough — §"≥1 is good to go").
  useEffect(() => {
    for (const c of components) {
      if (c.status === 'drafted' && isHumanApproved(collab[c.id]?.participants ?? [])) {
        onPatch(c.id, { status: 'approved' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab, components]);

  const active = components.find((c) => c.id === activeId) ?? null;
  const approvedCount = components.filter((c) => c.status === 'approved').length;

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
  const draftMd = drafted
    ? (active.sections.find((s) => s.draftMd)?.draftMd ?? null)
    : null;
  const activeCollab = collab[active.id] ?? { participants: [], discussion: [] };
  const iApproved = hasApproved(activeCollab.participants, currentMember.id);
  // People already in this section's chat — the only ones you can @-mention.
  const inChatMembers = activeCollab.participants.map((p) => p.member);
  // Live: does the current draft message address teammates (→ them, AI silent)?
  const liveMentions = parseMentions(input, inChatMembers);

  /** Patch the active component's collaborative state. */
  function patchCollab(updater: (u: UnitCollab) => UnitCollab): void {
    const id = active!.id;
    setCollab((prev) => ({ ...prev, [id]: updater(prev[id] ?? { participants: [], discussion: [] }) }));
  }

  /** Mock: append a reply into a section's thread after a short beat. A mentioned
   *  teammate responds (and approves when asked); `'forge'` acknowledges. */
  function scheduleReply(
    authorId: string,
    sectionId: string,
    body: string,
    opts: { approve?: boolean; delay?: number } = {},
  ): void {
    setTimeout(() => {
      setCollab((prev) => {
        const u = prev[sectionId] ?? { participants: [], discussion: [] };
        let participants = u.participants;
        if (opts.approve) {
          const m = participants.find((p) => p.member.id === authorId)?.member;
          if (m) participants = recordApproval(participants, m, new Date().toISOString());
        }
        const msg: DiscussionMsg = {
          id: `r-${sectionId}-${u.discussion.length}`,
          authorId,
          body,
          approval: opts.approve,
        };
        return { ...prev, [sectionId]: { ...u, participants, discussion: [...u.discussion, msg] } };
      });
    }, opts.delay ?? 1100);
  }

  /** Pull a teammate in from the top "Invite" picker — the one place to add an
   *  approver. They join the section and say a quick hello in the thread. */
  function invite(m: MemberRef): void {
    if (readOnly || !active) return;
    const already = activeCollab.participants.some((p) => p.member.id === m.id);
    patchCollab((u) => ({ ...u, participants: addParticipant(u.participants, m, currentMember.id) }));
    if (!already) {
      scheduleReply(m.id, active.id, `Thanks for pulling me in — reading through ${active.label.toLowerCase()} now. Will weigh in shortly.`);
    }
  }

  function submit(): void {
    if (!input.trim() || readOnly || !active) return;
    const text = input.trim();
    const mentions = parseMentions(text, inChatMembers);

    // @-mentions a teammate in the chat → directed at them; the AI stays out and
    // the mentioned people reply (approving when you ask them to).
    if (mentions.length > 0) {
      patchCollab((u) => ({
        ...u,
        discussion: [
          ...u.discussion,
          { id: `y-${active.id}-${u.discussion.length}`, authorId: currentMember.id, body: text },
        ],
      }));
      setInput('');
      const wantsApproval = /\b(approve|approval|sign[\s-]?off|lgtm)\b/i.test(text);
      mentions.forEach((m, i) =>
        scheduleReply(
          m.id,
          active.id,
          wantsApproval ? 'Looks right to me — approving. 👍' : `On it — looking at ${active.label.toLowerCase()} now.`,
          { approve: wantsApproval, delay: 1000 + i * 700 },
        ),
      );
      return;
    }

    // No @-mention → you're talking to Forge. Send to the refine route.
    if (drafted) {
      const sectionId = active.sections[0]?.id;
      if (!sectionId) return;
      patchCollab((u) => ({
        ...u,
        discussion: [
          ...u.discussion,
          { id: `y-${active.id}-${u.discussion.length}`, authorId: currentMember.id, body: text },
        ],
      }));
      setInput('');
      setRefining(true);
      const history = sectionHistory[active.id] ?? [];
      const newHistory = [...history, { role: 'user' as const, text }];
      setSectionHistory((prev) => ({ ...prev, [active.id]: newHistory }));

      fetch(`/projects/${projectId}/spec/sections/${sectionId}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAnswer: text, history }),
      })
        .then((r) => r.json())
        .then((data: { refinement?: { draftMd: string; questions: string[] } }) => {
          if (data.refinement) {
            // Update the section draft
            onPatch(active.id, {
              sections: active.sections.map((s) =>
                s.id === sectionId ? { ...s, draftMd: data.refinement!.draftMd } : s,
              ),
            });
            // Add Forge response to history — make AI state clear
            const aiOk = data.refinement.questions.length === 0;
            const forgeReply = aiOk
              ? '✅ Updated the draft with your feedback. I\'m satisfied with this section — press "Construct section" to review, then approve.'
              : data.refinement.questions.map((q, i) => `Q${i + 1}: ${q}`).join('\n');
            setSectionHistory((prev) => ({
              ...prev,
              [active.id]: [...(prev[active.id] ?? []), { role: 'forge', text: forgeReply }],
            }));
            patchCollab((u) => ({
              ...u,
              discussion: [
                ...u.discussion,
                { id: `f-${active.id}-${u.discussion.length}`, authorId: 'forge', body: forgeReply },
              ],
            }));
            // Stay in dialogue mode — don't auto-construct
            setConstructed((prev) => { const next = new Set(prev); next.delete(active.id); return next; });
            setManuallyEditing((prev) => new Set(prev).add(active.id));
          }
        })
        .catch(() => {
          patchCollab((u) => ({
            ...u,
            discussion: [
              ...u.discussion,
              { id: `f-${active.id}-${u.discussion.length}`, authorId: 'forge', body: 'Something went wrong — please try again.' },
            ],
          }));
        })
        .finally(() => setRefining(false));
      return;
    }
    setInput('');
    // User feedback on the draft — will be handled by the refine route in future
    onPatch(active.id, { status: 'drafted' });
  }

  /** End the Q&A and let Forge construct the draft from what's gathered. */
  function construct(): void {
    if (readOnly || !active) return;
    if (input.trim()) setInput('');
    setInput('');
    // A freshly constructed draft supersedes any prior sign-offs — they approved
    // an EARLIER version. Reset approvals so the author reviews the new draft and
    // approvers re-sign it. Without this, a stale approval (e.g. the seeded "Bo
    // already approved" on technical_design) trips the auto-approve gate the instant
    // the section is drafted, skipping review and showing "approved" immediately.
    patchCollab((u) => ({
      ...u,
      participants: u.participants.map((p) => (p.approvedAt ? { ...p, approvedAt: null } : p)),
    }));
    onPatch(active.id, { status: 'drafted' });
  }

  function approve(): void {
    if (!active || iApproved) return;
    patchCollab((u) => ({
      ...u,
      participants: recordApproval(u.participants, currentMember, new Date().toISOString()),
    }));
    onPatch(active.id, { status: 'approved' });
    const nextOpen = components.find((c) => c.id !== active.id && c.status !== 'approved');
    if (nextOpen) {
      setActiveId(nextOpen.id);
      setInput('');
    }
  }

  /** Reopen a drafted/approved section to keep editing the conversation. */
  function constructSection(): void {
    if (!active) return;
    setConstructed((prev) => new Set(prev).add(active.id));
    setManuallyEditing((prev) => { const next = new Set(prev); next.delete(active.id); return next; });
  }

  function backToEdit(): void {
    if (readOnly || !active) return;
    setConstructed((prev) => { const next = new Set(prev); next.delete(active.id); return next; });
    setManuallyEditing((prev) => new Set(prev).add(active.id));
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
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            <Database className="size-3" /> grounded · live mma-investigate
          </span>
        </CardHeader>

        {/* Co-approval strip — who's on this section and who's approved. */}
        <div className="shrink-0 border-b border-line px-5 py-2.5">
          <ParticipantStrip
            participants={activeCollab.participants}
            pool={projectMembers}
            onAdd={invite}
            disabled={readOnly}
          />
        </div>

        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-2/40 !py-5">
          {autoDrafting ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="text-sm font-medium text-ink">Drafting from exploration brief…</p>
              <p className="text-xs text-ink-soft">Each section is drafted using the exploration findings. This takes a moment.</p>
            </div>
          ) : drafted && draftMd ? (
            constructed.has(active.id) ? (
              /* Constructed: show the drafted content */
              <div className="flex gap-2.5">
                <ForgeMark className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink">Forge</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-[10px] font-medium text-accent-deep">
                      constructed section
                    </span>
                  </div>
                  <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
                    <Markdown>{draftMd}</Markdown>
                  </div>
                </div>
              </div>
            ) : (
              /* Dialogue: show Forge message with questions or "looks complete" + construct button */
              <>
                {(() => {
                  const firstSection = active.sections[0];
                  const qKey = firstSection ? `${active.kind}:${firstSection.key}` : '';
                  const questions = sectionQuestions?.[qKey] ?? [];
                  return (
                    <div className="flex gap-2.5">
                      <ForgeMark className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1">
                          <span className="text-xs font-semibold text-ink">Forge</span>
                        </div>
                        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
                          {questions.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-sm leading-relaxed text-ink">
                                <span className="mr-1.5">❓</span>I've drafted this section but have a few questions:
                              </p>
                              {questions.map((q, i) => (
                                <p key={i} className="text-sm leading-relaxed text-ink">
                                  <span className="mr-1.5 font-semibold text-accent">Q{i + 1}</span>
                                  {q}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm leading-relaxed text-ink">
                              <span className="mr-1.5">✅</span>This section looks complete based on the exploration findings. You can approve it, or tell me what to change.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )
          ) : null}

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
          <div ref={bottomRef} />
        </CardContent>

        {/* Approve / back — shown when constructed */}
        {drafted && !autoDrafting && constructed.has(active.id) ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <div className="flex items-center gap-2.5">
              <FileText className="size-5 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{approved ? 'Section approved' : 'Draft ready for review'}</p>
                <p className="text-xs text-ink-faint">
                  {approved
                    ? 'At least one approver has signed off — good to go.'
                    : 'Approve to lock it, or tell me what to change.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={backToEdit} disabled={readOnly} leftIcon={<ChevronLeft />}>
                Back to edit
              </Button>
              <Button onClick={approve} disabled={readOnly || iApproved} leftIcon={<Check />}>
                {iApproved ? 'Approved by you' : 'Approve'}
              </Button>
            </div>
          </div>
        ) : null}

        {/* One conversation. No @-mention → you're talking to Forge (the AI), which
            runs the interview. @-mention teammates already in the chat to talk to
            them instead — the AI stays out of that turn and they reply. */}
        <div className="shrink-0 border-t border-line px-5 py-4">
          <div className="flex gap-2.5">
            <Avatar
              size="sm"
              name={currentMember.displayName}
              tint={currentMember.avatarTint}
              aria-hidden
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <MentionComposer
                value={input}
                onChange={setInput}
                onSubmit={submit}
                pool={inChatMembers}
                disabled={readOnly}
                placeholder={
                  inChatMembers.length > 0
                    ? 'Message Forge — or @mention a teammate in the chat…'
                    : drafted
                      ? 'Message Forge…'
                      : 'Type your answer…'
                }
                submitLabel={liveMentions.length > 0 ? 'Send' : drafted ? 'Send' : 'Send answer'}
                secondary={
                  drafted && !constructed.has(active.id) ? (
                    <Button size="sm" variant="ghost" onClick={constructSection} disabled={readOnly} leftIcon={<FileText />}>
                      Construct section
                    </Button>
                  ) : undefined
                }
              />
            </div>
          </div>
        </div>
      </Card>

      {/* RIGHT — all selected components + progress (1/3) */}
      <aside className="flex min-h-0 flex-col">
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
                displayState={componentDisplayState(c, autoDrafting, sectionQuestions)}
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
              {nudge && pendingTotal > 0 ? 'Consolidate anyway' : 'Consolidate into document'}
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
        <ApproverCluster participants={participants} />
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
  driving,
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
  driving: boolean;
  onAdvance: () => void;
  onAssembled: (v: { version: number; bodyMd: string }) => void;
  onError: (m: string | null) => void;
}) {
  const [messages, setMessages] = useState<DocMsg[]>([]);
  const [input, setInput] = useState('');
  const [rounds, setRounds] = useState<
    { passNo: number; verdict: 'clean' | 'revised'; findings: AuditFinding[] }[]
  >(() => initialAuditHistory.map((p) => ({ passNo: p.passNo, verdict: p.verdict, findings: [] as AuditFinding[] })));
  const [canFreeze, setCanFreeze] = useState(initialCanFreeze);
  const seeded = useRef(false);
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

  // Audit also runs as a plain fetch (same reason as assemble) so the automation
  // driver below can fire it from an effect without the mutation observer sticking.
  const [auditing, setAuditing] = useState(false);
  const auditingRef = useRef(false);
  async function runAudit(): Promise<void> {
    if (auditingRef.current) return;
    auditingRef.current = true;
    setAuditing(true);
    try {
      const data = await postJson<{
        pass: { passNo: number; verdict: 'clean' | 'revised'; findingsCount: number; findings: AuditFinding[] };
        contextBlockId: string | null;
        history: AuditPassView[];
        canFreeze: boolean;
      }>(`/projects/${projectId}/spec/audit`, {});
      onError(null);
      setCanFreeze(data.canFreeze);
      setRounds((r) => [...r, { passNo: data.pass.passNo, verdict: data.pass.verdict, findings: data.pass.findings }]);
      setMessages((m) => [
        ...m,
        { id: nid(), role: 'audit', passNo: data.pass.passNo, verdict: data.pass.verdict, findings: data.pass.findings },
        {
          id: nid(),
          role: 'forge',
          text:
            data.pass.verdict === 'clean'
              ? "Clean pass — no critical or high findings. You can continue to Plan whenever you're ready."
              : "I found the issues above. Tell me to address one and I'll revise the spec, then re-run the audit to verify.",
        },
      ]);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Audit failed.');
    } finally {
      auditingRef.current = false;
      setAuditing(false);
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

  /** Apply a chosen subset (or all) of a pass's findings, then re-assemble. */
  function apply(passNo: number, indices: number[], total: number): void {
    if (readOnly || indices.length === 0) return;
    const all = indices.length === total;
    const nums = indices.map((i) => i + 1).sort((a, b) => a - b);
    const label = all
      ? `all ${total} findings`
      : `finding${indices.length === 1 ? '' : 's'} #${nums.join(', #')}`;
    setMessages((m) => [
      ...m,
      {
        id: nid(),
        role: 'forge',
        text: `Applied ${label} from pass ${passNo} — I've revised the affected sections and am re-assembling the spec.`,
      },
    ]);
    void runAssemble();
  }

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
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            <Sparkles className="size-3" /> whole-spec review
          </span>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-2/40 !py-5">
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
            messages.map((m) =>
              m.role === 'forge' ? (
                <ForgeSays key={m.id} text={m.text} />
              ) : m.role === 'user' ? (
                <AnswerBlock key={m.id} text={m.text} />
              ) : m.role === 'draft' ? (
                <SpecDraftCard key={m.id} version={m.version} md={m.md} />
              ) : (
                <AuditMsg
                  key={m.id}
                  passNo={m.passNo}
                  verdict={m.verdict}
                  findings={m.findings}
                  readOnly={readOnly}
                  onApply={(indices) => apply(m.passNo, indices, m.findings.length)}
                />
              ),
            )
          )}
          <div ref={bottomRef} />
        </CardContent>

        {/* Composer pinned to the bottom (messenger-style). */}
        <div className="shrink-0 border-t border-line px-5 py-4">
          <div className="flex gap-2.5">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sage-tint text-[11px] font-semibold text-[var(--sage-deep)]">
              AD
            </span>
            <div className="min-w-0 flex-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={2}
                disabled={readOnly || !spec}
                placeholder="Tell Forge what to refine across the spec…"
                className="!min-h-0 !rounded-2xl !text-sm"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void runAudit()}
                  loading={auditing}
                  disabled={readOnly || !mmaReady || !spec || auditing}
                  leftIcon={<Shield />}
                >
                  {rounds.length > 0 ? 'Re-run audit' : 'Run audit'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void runAssemble()}
                  loading={assembling}
                  disabled={readOnly || !allApproved || assembling}
                  leftIcon={<Sparkles />}
                >
                  Construct spec
                </Button>
                <span className="flex-1" />
                <Button size="sm" onClick={sendRefine} disabled={readOnly || !input.trim()} rightIcon={<ArrowRight />}>
                  Send
                </Button>
              </div>
              {!mmaReady ? (
                <TextSm className="mt-2 !text-[var(--amber)]">
                  <a href="/settings/connections" className="underline">
                    Configure the MMA token
                  </a>{' '}
                  to run the audit.
                </TextSm>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* RIGHT — every audit round + the freeze handoff (1/3) */}
      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Audit rounds</CardTitle>
            {rounds.length > 0 ? (
              <span className="text-sm font-medium text-ink-faint">{rounds.length}</span>
            ) : null}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
            {rounds.length === 0 ? (
              <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
                <Shield className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <p className="text-xs leading-relaxed text-ink-soft">
                  Run the audit from the conversation. Each round lands here with its verdict and findings.
                </p>
              </div>
            ) : (
              rounds.map((r) => (
                <AuditRoundCard
                  key={r.passNo}
                  passNo={r.passNo}
                  verdict={r.verdict}
                  findings={r.findings}
                  onReplay={() => replay(r.passNo)}
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
              href={`/projects/${projectId}/plan`}
              label="Continue to Plan"
              disabled={readOnly}
              testId="spec-continue-link"
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
          <Markdown className="max-w-none prose-headings:mb-2 prose-headings:mt-5 first:prose-headings:mt-0">
            {md}
          </Markdown>
        </div>
      </div>
    </div>
  );
}

const SEVERITY_ORDER: AuditFinding['severity'][] = ['critical', 'high', 'medium', 'low'];

/** A distinct tint per severity (critical = rose · high = amber · medium = steel · low = neutral). */
const SEVERITY_STYLE: Record<AuditFinding['severity'], string> = {
  critical: 'bg-rose-tint text-[var(--rose)]',
  high: 'bg-amber-tint text-[var(--amber)]',
  medium: 'bg-[var(--frost)] text-[var(--steel)]',
  low: 'bg-surface-2 text-ink-soft',
};

/** Fixed-width severity tag so finding claims align in a clean column. */
function SeverityTag({ s }: { s: AuditFinding['severity'] }) {
  return (
    <span
      className={cn(
        'inline-flex w-[58px] shrink-0 items-center justify-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        SEVERITY_STYLE[s],
      )}
    >
      {s}
    </span>
  );
}

/** Tally findings by severity for the rail summary. */
function severityCounts(findings: AuditFinding[]): Record<AuditFinding['severity'], number> {
  const c = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) c[f.severity] += 1;
  return c;
}

/** A small severity-count chip used in the audit-rounds summary. */
function CountChip({ s, n }: { s: AuditFinding['severity']; n: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        SEVERITY_STYLE[s],
      )}
    >
      <span className="font-semibold">{n}</span>
      {s}
    </span>
  );
}

/** An audit pass in the thread — numbered, selectable findings + apply controls. */
function AuditMsg({
  passNo,
  verdict,
  findings,
  readOnly,
  onApply,
}: {
  passNo: number;
  verdict: 'clean' | 'revised';
  findings: AuditFinding[];
  readOnly: boolean;
  onApply: (indices: number[]) => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--frost)] text-[var(--steel)]">
        <Shield className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">Audit</span>
          <span className="text-[11px] text-ink-faint">pass {passNo}</span>
          <Badge variant={verdict === 'clean' ? 'sage' : 'neutral'} size="sm">
            {verdict === 'clean'
              ? 'clean'
              : `${findings.length} finding${findings.length === 1 ? '' : 's'} → revised`}
          </Badge>
        </div>
        <div className="overflow-hidden rounded-2xl rounded-tl-md border border-line bg-surface shadow-sm">
          {findings.length > 0 ? (
            <>
              <ul className="divide-y divide-line/70">
                {findings.map((f, i) => {
                  const on = sel.has(i);
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => !readOnly && toggle(i)}
                        disabled={readOnly}
                        className={cn(
                          'flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors',
                          on ? 'bg-accent-tint/40' : 'hover:bg-surface-2/50',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-px grid size-5 shrink-0 place-items-center rounded-[6px] border text-[11px] font-semibold transition-colors',
                            on ? 'border-accent bg-accent text-white' : 'border-line-strong text-ink-faint',
                          )}
                        >
                          {on ? <Check className="size-3.5" /> : i + 1}
                        </span>
                        <SeverityTag s={f.severity} />
                        <span className="text-sm leading-relaxed text-ink">{f.claim}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-3.5 py-2.5">
                <span className="text-[11px] text-ink-faint">
                  Pick the ones to apply, or tell Forge by number — e.g. "apply #1, #2 and #5".
                </span>
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onApply([...sel])}
                  disabled={readOnly || sel.size === 0}
                  leftIcon={<Check />}
                >
                  Apply selected{sel.size > 0 ? ` (${sel.size})` : ''}
                </Button>
                <Button
                  size="sm"
                  onClick={() => onApply(findings.map((_, i) => i))}
                  disabled={readOnly}
                  leftIcon={<Sparkles />}
                >
                  Apply all {findings.length}
                </Button>
              </div>
            </>
          ) : (
            <p className="px-4 py-3 text-sm leading-relaxed text-ink">
              No critical or high findings — the specification is ready to freeze.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** One audit round in the right rail — a clickable severity summary. */
function AuditRoundCard({
  passNo,
  verdict,
  findings,
  onReplay,
}: {
  passNo: number;
  verdict: 'clean' | 'revised';
  findings: AuditFinding[];
  onReplay: () => void;
}) {
  const counts = severityCounts(findings);
  return (
    <button
      type="button"
      onClick={onReplay}
      className="group w-full rounded-[var(--r-md)] border border-line bg-surface p-3 text-left transition-colors hover:border-accent hover:bg-surface-2/40"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">Pass {passNo}</span>
        <Badge variant={verdict === 'clean' ? 'sage' : 'neutral'} size="sm">
          {verdict === 'clean' ? 'clean' : 'revised'}
        </Badge>
        <span className="ml-auto text-[11px] text-ink-faint">
          {findings.length} finding{findings.length === 1 ? '' : 's'}
        </span>
      </div>
      {findings.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <CountChip key={s} s={s} n={counts[s]} />
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-ink-faint">No critical or high findings.</p>
      )}
      <span className="mt-2 flex items-center gap-1 text-[11px] font-medium text-ink-faint group-hover:text-accent">
        <ArrowRight className="size-3" /> Re-post to chat
      </span>
    </button>
  );
}

/* ── Audit panel (run audit → pass timeline → freeze CTA) ────────────────── */

export interface AuditFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  claim: string;
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

