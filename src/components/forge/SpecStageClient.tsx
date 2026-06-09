'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Markdown } from '@/components/forge/Markdown';
import { Composer, type QaMessageView } from '@/components/forge/Composer';
import { SatisfactionGate } from '@/components/forge/SatisfactionGate';
import { RoleChip } from '@/components/forge/RoleChip';
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
        <div className="rounded-[var(--r-md)] border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
          The main tier is not configured.{' '}
          <a href="/settings/roster" className="underline">
            Configure the main tier in Team Settings
          </a>{' '}
          to start the Q&A.
        </div>
      ) : null}

      <nav className="flex gap-2 text-sm">
        {(['outline', 'interview', 'document'] as Screen[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScreen(s)}
            className={cn(
              'rounded-[var(--r-md)] px-3 py-1 capitalize',
              screen === s ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted',
            )}
          >
            {s}
          </button>
        ))}
      </nav>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

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
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Intent</span>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={4}
          disabled={readOnly}
          placeholder="What's the problem? What do you want to achieve? What's the requirement?"
          className="rounded-[var(--r-md)] border border-line bg-surface p-2 text-sm disabled:opacity-50"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        {AVAILABLE_KINDS.map((k) => {
          const already = existingKinds.has(k.kind);
          const checked = picked.has(k.kind) || already;
          return (
            <label
              key={k.kind}
              className="flex cursor-pointer flex-col gap-1 rounded-[var(--r-md)] border border-line bg-surface p-3"
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
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
              <span className="flex flex-wrap gap-1">
                {k.roles.map((r) => (
                  <RoleChip key={r} role={r} />
                ))}
              </span>
            </label>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => confirm.mutate()}
        disabled={readOnly || intent.trim() === '' || picked.size === 0 || confirm.isPending}
        className="self-start rounded-[var(--r-md)] bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {confirm.isPending ? 'Confirming…' : 'Confirm components'}
      </button>
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
    return <p className="text-sm text-ink-faint">No sections yet — confirm components in the outline.</p>;
  }

  const messages = messagesBySection[active.section.id] ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="flex flex-col gap-2" aria-label="Sections">
        {components.map((c) => (
          <div key={c.id}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{c.label}</p>
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
                      'w-full rounded px-2 py-1 text-left text-xs',
                      s.id === activeId ? 'bg-accent-tint text-accent-deep' : 'text-ink-muted',
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
        <h2 className="font-serif text-lg text-ink">{active.section.label}</h2>

        <Composer
          messages={messages}
          textareaRef={textareaRef}
          disabled={readOnly || active.section.status === 'approved'}
          busy={answer.isPending}
          onAnswer={(answerMd) => answer.mutate({ sectionId: active.section.id, answerMd })}
        />

        {active.section.draftMd ? (
          <div className="rounded-[var(--r-md)] border border-line bg-surface p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Draft</p>
            <Markdown>{active.section.draftMd}</Markdown>
          </div>
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
      <div className="flex items-center gap-3">
        <h2 className="font-serif text-lg text-ink">{projectName} — Specification</h2>
        <button
          type="button"
          onClick={() => assemble.mutate()}
          disabled={readOnly || !allApproved || assemble.isPending}
          className="rounded-[var(--r-md)] bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {assemble.isPending ? 'Assembling…' : 'Assemble specification'}
        </button>
        {spec ? <span className="text-xs text-ink-faint">v{spec.version}</span> : null}
      </div>

      {spec ? (
        <div className="rounded-[var(--r-md)] border border-line bg-surface p-4">
          <Markdown>{spec.bodyMd}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">
          {allApproved
            ? 'Assemble the specification to see the full document.'
            : 'Approve every section before assembling.'}
        </p>
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
    <section className="flex flex-col gap-3 rounded-[var(--r-md)] border border-line bg-surface p-4" data-testid="audit-panel">
      <div className="flex items-center gap-3">
        <h3 className="font-medium text-ink">Audit</h3>
        <button
          type="button"
          onClick={() => audit.mutate()}
          disabled={readOnly || !mmaReady || audit.isPending}
          className="rounded-[var(--r-md)] bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {audit.isPending ? 'Auditing…' : history.length > 0 ? 'Re-run audit' : 'Run audit'}
        </button>
        {!mmaReady ? (
          <span className="text-xs text-amber-700">
            <a href="/settings/connections" className="underline">
              Configure the MMA token
            </a>{' '}
            to audit.
          </span>
        ) : null}
      </div>

      {history.length > 0 ? (
        <ol className="flex flex-wrap items-center gap-2 text-xs" data-testid="audit-timeline">
          {history.map((p) => (
            <li
              key={p.passNo}
              className={cn(
                'rounded-full px-2 py-0.5',
                p.verdict === 'clean' ? 'bg-sage-tint text-sage-deep' : 'bg-surface-2 text-ink-muted',
              )}
            >
              pass {p.passNo}: {p.verdict === 'clean' ? 'clean' : `${p.findingsCount} finding${p.findingsCount === 1 ? '' : 's'} → revised`}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-ink-faint">Run the audit to check the spec for critical / high findings.</p>
      )}

      {findings.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs" data-testid="audit-findings">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span
                className={cn(
                  'shrink-0 rounded px-1 font-medium uppercase',
                  f.severity === 'critical' || f.severity === 'high'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-surface-2 text-ink-muted',
                )}
              >
                {f.severity}
              </span>
              <span className="text-ink">{f.claim}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {capReached ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">
            The audit still reports critical/high findings. You can keep fixing, or accept and override.
          </span>
          <button
            type="button"
            onClick={() => override.mutate()}
            disabled={readOnly || override.isPending}
            className="rounded-[var(--r-md)] border border-amber-500 px-3 py-1 text-xs font-medium text-amber-700 disabled:opacity-50"
          >
            Accept findings &amp; override
          </button>
        </div>
      ) : null}

      <div className="mt-1 flex items-center gap-3 border-t border-line pt-3">
        <a
          href={canFreeze && !readOnly ? `/projects/${projectId}/freeze` : undefined}
          aria-disabled={!canFreeze || readOnly}
          data-testid="freeze-link"
          className={cn(
            'rounded-[var(--r-md)] px-4 py-1.5 text-sm font-medium',
            canFreeze && !readOnly
              ? 'bg-ink text-white'
              : 'pointer-events-none cursor-not-allowed bg-surface-2 text-ink-faint',
          )}
        >
          Freeze the spec
        </a>
        <span className="text-xs text-ink-faint">
          {canFreeze ? 'Ready to freeze — this is irreversible.' : 'Freeze unlocks after a clean audit.'}
        </span>
      </div>
    </section>
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
