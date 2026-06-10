'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Snowflake } from 'lucide-react';
import { Markdown } from '@/components/forge/Markdown';
import { Composer, type QaMessageView } from '@/components/forge/Composer';
import { SatisfactionGate } from '@/components/forge/SatisfactionGate';
import { RoleChip } from '@/components/forge/RoleChip';
import {
  Button,
  Card,
  CardContent,
  Badge,
  Banner,
  Field,
  Textarea,
  Checkbox,
  Heading,
  Title,
  Text,
  TextSm,
  Micro,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ComponentView, SectionView } from '@/spec/spec-core';
import type { ComponentKind, ProjectPhase } from '@/db/enums';

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
}

type Screen = 'outline' | 'interview' | 'document';

interface SectionRepaint {
  section: Pick<SectionView, 'status' | 'aiSatisfied' | 'humanSatisfied' | 'forced' | 'draftMd' | 'stale'>;
  qaMessages: QaMessageView[];
  component: { status: SectionView['status'] };
}

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
  const readOnly = props.phase !== 'design';
  const [screen, setScreen] = useState<Screen>(
    props.initialComponents.length === 0 ? 'outline' : 'interview',
  );
  const [components, setComponents] = useState<ComponentView[]>(props.initialComponents);
  const [spec, setSpec] = useState(props.initialSpec);
  const [error, setError] = useState<string | null>(null);

  const allApproved = components.length > 0 && components.every((c) => c.status === 'approved');

  return (
    <div className="flex flex-col gap-4" data-testid="spec-stage">
      {!props.mainTierReady ? (
        <Banner
          variant="warning"
          title="The main tier is not configured."
          description={
            <>
              <a href="/settings/roster" className="font-medium underline">
                Configure the main tier in Team Settings
              </a>{' '}
              to start the Q&amp;A.
            </>
          }
        />
      ) : null}

      <nav className="inline-flex w-fit rounded-[var(--r)] border border-line bg-surface p-0.5">
        {(['outline', 'interview', 'document'] as Screen[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScreen(s)}
            aria-current={screen === s ? 'page' : undefined}
            className={cn(
              'rounded-[calc(var(--r)-2px)] px-3 py-1 text-sm font-medium capitalize transition-colors',
              screen === s ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink',
            )}
          >
            {s}
          </button>
        ))}
      </nav>

      {error ? <TextSm className="!text-[var(--rose)]">{error}</TextSm> : null}

      {screen === 'outline' ? (
        <OutlineScreen
          projectId={props.projectId}
          intentMd={props.intentMd}
          defaultKinds={props.defaultKinds}
          existing={components}
          readOnly={readOnly}
          onConfirmed={(next) => {
            setComponents(next);
            setScreen('interview');
          }}
          onError={setError}
        />
      ) : null}

      {screen === 'interview' ? (
        <InterviewScreen
          projectId={props.projectId}
          components={components}
          readOnly={readOnly || !props.mainTierReady}
          onRepaint={(sectionId, repaint) =>
            setComponents((prev) => applyRepaint(prev, sectionId, repaint))
          }
          onError={setError}
        />
      ) : null}

      {screen === 'document' ? (
        <DocumentScreen
          projectId={props.projectId}
          projectName={props.projectName}
          spec={spec}
          allApproved={allApproved}
          readOnly={readOnly}
          mmaReady={props.mmaReady}
          initialAuditHistory={props.initialAuditHistory}
          initialCanFreeze={props.initialCanFreeze}
          onAssembled={(v) => setSpec(v)}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

/** Patch a section's flags into the components tree from a repaint payload. */
function applyRepaint(
  components: ComponentView[],
  sectionId: string,
  repaint: SectionRepaint,
): ComponentView[] {
  return components.map((c) => {
    if (!c.sections.some((s) => s.id === sectionId)) return c;
    return {
      ...c,
      status: repaint.component.status,
      sections: c.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              status: repaint.section.status,
              aiSatisfied: repaint.section.aiSatisfied,
              humanSatisfied: repaint.section.humanSatisfied,
              forced: repaint.section.forced,
              draftMd: repaint.section.draftMd,
              stale: repaint.section.stale,
            }
          : s,
      ),
    };
  });
}

/* ── Outline screen ─────────────────────────────────────────────────────── */

function OutlineScreen({
  projectId,
  intentMd,
  defaultKinds,
  existing,
  readOnly,
  onConfirmed,
  onError,
}: {
  projectId: string;
  intentMd: string | null;
  defaultKinds: ComponentKind[];
  existing: ComponentView[];
  readOnly: boolean;
  onConfirmed: (next: ComponentView[]) => void;
  onError: (m: string | null) => void;
}) {
  const [intent, setIntent] = useState(intentMd ?? '');
  const existingKinds = useMemo(() => new Set(existing.map((c) => c.kind)), [existing]);
  const [picked, setPicked] = useState<Set<ComponentKind>>(
    () => new Set(existing.length > 0 ? existing.map((c) => c.kind) : defaultKinds),
  );

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

  return (
    <div className="flex flex-col gap-4">
      <Field label="Intent">
        {(p) => (
          <Textarea
            {...p}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={4}
            disabled={readOnly}
            placeholder="What's the problem? What do you want to achieve? What's the requirement?"
          />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        {AVAILABLE_KINDS.map((k) => {
          const already = existingKinds.has(k.kind);
          const checked = picked.has(k.kind) || already;
          return (
            <label
              key={k.kind}
              className="flex cursor-pointer flex-col gap-2 rounded-[var(--r-md)] border border-line bg-surface p-3 transition-colors hover:border-line-strong"
            >
              <span className="flex items-center gap-2.5">
                <Checkbox
                  checked={checked}
                  disabled={readOnly || already}
                  onChange={(e) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(k.kind);
                      else next.delete(k.kind);
                      return next;
                    })
                  }
                />
                <span className="font-medium text-ink">{k.label}</span>
              </span>
              {k.roles.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {k.roles.map((r) => (
                    <RoleChip key={r} role={r} />
                  ))}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      <Button
        className="self-start"
        onClick={() => confirm.mutate()}
        loading={confirm.isPending}
        disabled={readOnly || intent.trim() === '' || picked.size === 0 || confirm.isPending}
      >
        {confirm.isPending ? 'Confirming…' : 'Confirm components'}
      </Button>
    </div>
  );
}

/* ── Interview screen ───────────────────────────────────────────────────── */

function InterviewScreen({
  projectId,
  components,
  readOnly,
  onRepaint,
  onError,
}: {
  projectId: string;
  components: ComponentView[];
  readOnly: boolean;
  onRepaint: (sectionId: string, repaint: SectionRepaint) => void;
  onError: (m: string | null) => void;
}) {
  const flatSections = useMemo(
    () => components.flatMap((c) => c.sections.map((s) => ({ component: c, section: s }))),
    [components],
  );
  const [activeId, setActiveId] = useState<string | null>(flatSections[0]?.section.id ?? null);
  const [messagesBySection, setMessagesBySection] = useState<Record<string, QaMessageView[]>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const active = flatSections.find((f) => f.section.id === activeId);

  const answer = useMutation({
    mutationFn: (vars: { sectionId: string; answerMd: string }) =>
      postJson<SectionRepaint>(`/projects/${projectId}/spec/sections/${vars.sectionId}/answer`, {
        answerMd: vars.answerMd,
      }),
    onSuccess: (data, vars) => {
      onError(null);
      setMessagesBySection((m) => ({ ...m, [vars.sectionId]: data.qaMessages }));
      onRepaint(vars.sectionId, data);
    },
    onError: (e: Error) => onError(e.message),
  });

  const force = useMutation({
    mutationFn: (sectionId: string) =>
      postJson<SectionRepaint>(`/projects/${projectId}/spec/sections/${sectionId}/force-advance`, {}),
    onSuccess: (data, sectionId) => {
      onError(null);
      setMessagesBySection((m) => ({ ...m, [sectionId]: data.qaMessages }));
      onRepaint(sectionId, data);
      advance(sectionId);
    },
    onError: (e: Error) => onError(e.message),
  });

  const nod = useMutation({
    mutationFn: (sectionId: string) =>
      postJson<SectionRepaint>(`/projects/${projectId}/spec/sections/${sectionId}/nod`, {}),
    onSuccess: (data, sectionId) => {
      onError(null);
      onRepaint(sectionId, data);
      if (data.section.status === 'approved') advance(sectionId);
    },
    onError: (e: Error) => onError(e.message),
  });

  /** On section advance, move to the next section and focus its answer input (F9). */
  function advance(sectionId: string) {
    const idx = flatSections.findIndex((f) => f.section.id === sectionId);
    const next = flatSections[idx + 1];
    if (next) {
      setActiveId(next.section.id);
      // Focus the next section's textarea after the paint.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  if (!active) {
    return <Text className="!text-sm !text-ink-faint">No sections yet — confirm components in the outline.</Text>;
  }

  const messages = messagesBySection[active.section.id] ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="flex flex-col gap-3" aria-label="Sections">
        {components.map((c) => (
          <div key={c.id}>
            <Micro className="!font-semibold !uppercase !tracking-wide">{c.label}</Micro>
            <ul className="mt-1 flex flex-col gap-0.5">
              {c.sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(s.id)}
                    data-section={s.id}
                    data-status={s.status}
                    aria-current={s.id === activeId ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-[var(--r-sm)] px-2 py-1 text-left text-xs transition-colors',
                      s.id === activeId ? 'bg-accent-tint text-accent-deep' : 'text-ink-soft hover:bg-surface-2',
                    )}
                  >
                    {s.label} · {s.status}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <section className="flex flex-col gap-3">
        <Heading className="!text-base">{active.section.label}</Heading>

        <Composer
          messages={messages}
          textareaRef={textareaRef}
          disabled={readOnly || active.section.status === 'approved'}
          busy={answer.isPending}
          onAnswer={(answerMd) => answer.mutate({ sectionId: active.section.id, answerMd })}
        />

        {active.section.draftMd ? (
          <Card>
            <CardContent>
              <Micro className="mb-1 block !font-semibold !uppercase !tracking-wide">Draft</Micro>
              <Markdown>{active.section.draftMd}</Markdown>
            </CardContent>
          </Card>
        ) : null}

        <SatisfactionGate
          aiSatisfied={active.section.aiSatisfied}
          humanSatisfied={active.section.humanSatisfied}
          forced={active.section.forced}
          drafted={active.section.draftMd != null}
          disabled={readOnly}
          onNod={() => nod.mutate(active.section.id)}
          onForceAdvance={() => force.mutate(active.section.id)}
        />
      </section>
    </div>
  );
}

/* ── Document screen ────────────────────────────────────────────────────── */

function DocumentScreen({
  projectId,
  projectName,
  spec,
  allApproved,
  readOnly,
  mmaReady,
  initialAuditHistory,
  initialCanFreeze,
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
  onAssembled: (v: { version: number; bodyMd: string }) => void;
  onError: (m: string | null) => void;
}) {
  const assemble = useMutation({
    mutationFn: () =>
      postJson<{ artifact: { version: number; body_md: string } }>(
        `/projects/${projectId}/spec/assemble`,
        {},
      ),
    onSuccess: (data) => {
      onError(null);
      onAssembled({ version: data.artifact.version, bodyMd: data.artifact.body_md });
    },
    onError: (e: Error) => onError(e.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Title className="!text-lg">{projectName} — Specification</Title>
        <Button
          size="sm"
          leftIcon={<Sparkles />}
          onClick={() => assemble.mutate()}
          loading={assemble.isPending}
          disabled={readOnly || !allApproved || assemble.isPending}
        >
          {assemble.isPending ? 'Assembling…' : 'Assemble specification'}
        </Button>
        {spec ? (
          <Badge variant="sage" size="sm">
            v{spec.version}
          </Badge>
        ) : null}
      </div>

      {spec ? (
        <Card>
          <CardContent>
            <Markdown>{spec.bodyMd}</Markdown>
          </CardContent>
        </Card>
      ) : (
        <Text className="!text-sm !text-ink-faint">
          {allApproved
            ? 'Assemble the specification to see the full document.'
            : 'Approve every section before assembling.'}
        </Text>
      )}

      {spec ? (
        <AuditPanel
          projectId={projectId}
          readOnly={readOnly}
          mmaReady={mmaReady}
          initialHistory={initialAuditHistory}
          initialCanFreeze={initialCanFreeze}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

/* ── Audit panel (run audit → pass timeline → freeze CTA) ────────────────── */

export interface AuditFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  claim: string;
}

export function AuditPanel({
  projectId,
  readOnly,
  mmaReady,
  initialHistory,
  initialCanFreeze,
  onError,
}: {
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
    <Card data-testid="audit-panel">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Heading className="!text-base">Audit</Heading>
          <Button
            size="sm"
            onClick={() => audit.mutate()}
            loading={audit.isPending}
            disabled={readOnly || !mmaReady || audit.isPending}
          >
            {audit.isPending ? 'Auditing…' : history.length > 0 ? 'Re-run audit' : 'Run audit'}
          </Button>
          {!mmaReady ? (
            <TextSm className="!text-[var(--amber)]">
              <a href="/settings/connections" className="underline">
                Configure the MMA token
              </a>{' '}
              to audit.
            </TextSm>
          ) : null}
        </div>

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

        <div className="mt-1 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <a
            href={canFreeze && !readOnly ? `/projects/${projectId}/freeze` : undefined}
            aria-disabled={!canFreeze || readOnly}
            data-testid="freeze-link"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--r)] px-4 py-1.5 text-sm font-medium transition-colors',
              canFreeze && !readOnly
                ? 'bg-ink text-white hover:bg-ink/90'
                : 'pointer-events-none cursor-not-allowed bg-surface-2 text-ink-faint',
            )}
          >
            <Snowflake aria-hidden="true" className="size-4" />
            Freeze the spec
          </a>
          <TextSm className="!text-ink-faint">
            {canFreeze ? 'Ready to freeze — this is irreversible.' : 'Freeze unlocks after a clean audit.'}
          </TextSm>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Component catalogue for the outline checkboxes ─────────────────────── */

const AVAILABLE_KINDS: Array<{ kind: ComponentKind; label: string; roles: string[] }> = [
  { kind: 'context', label: 'Context', roles: ['Business user', 'PM'] },
  { kind: 'problem', label: 'Problem statement & goals', roles: ['Business user', 'PM'] },
  { kind: 'tech_design', label: 'Technical design', roles: ['SWE'] },
  { kind: 'test_plan', label: 'Test plan', roles: ['Business user', 'QE'] },
  { kind: 'stories_tasks', label: 'User stories & tech tasks', roles: ['PM', 'SWE', 'QE'] },
  { kind: 'nfr', label: 'Non-functional constraints', roles: [] },
  { kind: 'assumptions', label: 'Assumptions & open decisions', roles: [] },
];
