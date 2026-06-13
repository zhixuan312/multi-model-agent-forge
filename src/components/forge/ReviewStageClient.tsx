'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Shield,
  ScanSearch,
  Sparkles,
  GitBranch,
  FileCode,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ForgeMark } from '@/components/forge/ForgeMark';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Banner,
  Textarea,
  TextSm,
  Eyebrow,
} from '@/components/ui';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { AutomationBar, type AutoMode } from '@/components/forge/AutomationBar';
import { StageAdvance } from '@/components/forge/StageAdvance';
import type { ProjectPhase } from '@/db/enums';
import type { ReviewUnit, ReviewFinding } from '@/mock/domains/projects/review';

type ReviewPhase = 'inspect' | 'judge' | 'resolve';
type Msg =
  | { id: string; role: 'forge' | 'user'; text: string }
  | { id: string; role: 'review'; passNo: number; verdict: 'clean' | 'changes'; findings: ReviewFinding[] };

export interface ReviewStageClientProps {
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
  mmaReady: boolean;
  units: ReviewUnit[];
  reviewRounds: ReviewFinding[][];
}

const SEVERITY_ORDER: ReviewFinding['severity'][] = ['critical', 'high', 'medium', 'low'];
const SEVERITY_STYLE: Record<ReviewFinding['severity'], string> = {
  critical: 'bg-rose-tint text-[var(--rose)]',
  high: 'bg-amber-tint text-[var(--amber)]',
  medium: 'bg-[var(--frost)] text-[var(--steel)]',
  low: 'bg-surface-2 text-ink-soft',
};

let _id = 0;
const nid = () => `rv${_id++}`;

export function ReviewStageClient(props: ReviewStageClientProps) {
  const router = useRouter();
  const readOnly = props.phase !== 'build';
  const { units } = props;

  const [phase, setPhase] = useState<ReviewPhase>('inspect');
  const [rounds, setRounds] = useState<{ passNo: number; verdict: 'clean' | 'changes'; findings: ReviewFinding[] }[]>([]);
  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');

  useEffect(() => stagePhaseStore.set(phase), [phase]);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'inspect') setPhase('inspect');
        else if (key === 'judge') setPhase('judge');
        else if (key === 'resolve' && rounds.length > 0) setPhase('resolve');
      }),
    [rounds.length],
  );

  useEffect(() => {
    if (readOnly) return;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      setAutoNote('AI is driving — reviewing the changeset…');
      setAuto('running');
    }
  }, [readOnly]);

  const reviewClean = rounds[rounds.length - 1]?.verdict === 'clean';

  function runReview() {
    const passNo = rounds.length + 1;
    const findings = props.reviewRounds[passNo - 1] ?? [];
    const hasCritHigh = findings.some((f) => f.severity === 'critical' || f.severity === 'high');
    setRounds((r) => [...r, { passNo, verdict: hasCritHigh ? 'changes' : 'clean', findings }]);
  }

  // Automated driver: inspect → judge → run review (clear crit/high) → resolve → Journal.
  useEffect(() => {
    if (auto !== 'running' || readOnly) return;
    const t = setTimeout(() => {
      if (phase === 'inspect') {
        setAutoNote('Inspected the changeset — running code review…');
        setPhase('judge');
      } else if (phase === 'judge') {
        if (!reviewClean && rounds.length < props.reviewRounds.length) {
          setAutoNote('Code review pass ' + (rounds.length + 1) + ' — applied critical/high fixes.');
          runReview();
        } else {
          setAutoNote('Critical & high cleared — resolving the review.');
          setPhase('resolve');
        }
      } else if (phase === 'resolve') {
        router.push(`/projects/${props.projectId}/journal?auto=1`);
      }
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, phase, rounds, reviewClean, readOnly]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="review-stage">
      {!props.mmaReady ? (
        <Banner
          variant="warning"
          title="The MMA token is not configured."
          description={
            <>
              <a href="/settings/connections" className="font-medium underline">
                Configure the MMA token
              </a>{' '}
              to run code review.
            </>
          }
        />
      ) : null}

      <AutomationBar
        mode={auto}
        note={autoNote}
        disabled={readOnly}
        idleHint="Review the changeset yourself, or let Forge run code review and resolve it on to Journal."
        runningHint="Forge runs code review, applies critical & high, resolves, then hands off to Journal. Stop anytime."
        onRun={() => {
          setAutoNote('AI is driving — reviewing the changeset…');
          setAuto('running');
        }}
        onStop={() => {
          setAuto('off');
          setAutoNote('Stopped — you have the wheel.');
        }}
      />

      {phase === 'inspect' ? (
        <InspectStage units={units} readOnly={readOnly} onReview={() => setPhase('judge')} />
      ) : phase === 'judge' ? (
        <JudgeStage
          projectName={props.projectName}
          units={units}
          readOnly={readOnly}
          driving={auto === 'running'}
          mmaReady={props.mmaReady}
          rounds={rounds}
          reviewClean={reviewClean}
          onRunReview={runReview}
          onResolve={() => setPhase('resolve')}
          onBack={() => setPhase('inspect')}
        />
      ) : (
        <ResolveStage
          projectId={props.projectId}
          projectName={props.projectName}
          units={units}
          rounds={rounds}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

/* ── Inspect — the landed changeset ─────────────────────────────────────────── */
function InspectStage({ units, readOnly, onReview }: { units: ReviewUnit[]; readOnly: boolean; onReview: () => void }) {
  const totalFiles = useMemo(() => units.reduce((n, u) => n + u.files.length, 0), [units]);
  const repos = useMemo(() => [...new Set(units.map((u) => u.repo).filter((r) => r !== 'monorepo'))], [units]);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <ScanSearch className="size-4 shrink-0 text-accent" />
            <CardTitle>Changeset</CardTitle>
            <Badge variant="neutral" size="sm">
              {units.length} commits
            </Badge>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            from Execute
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
          {units.map((u) => (
            <div key={u.id} className="rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface-2 font-mono text-[10px] font-semibold text-ink-soft">
                  {u.num}
                </span>
                <span className="text-sm font-medium text-ink">{u.title}</span>
                <span className="ml-auto shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">{u.commit}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[26px]">
                {u.files.map((f) => (
                  <span key={f} className="rounded-[5px] bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-soft">{f}</span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <aside className="flex min-h-0 flex-col gap-4">
        <div className="flex shrink-0 items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/30 px-4 py-4">
          <Shield className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0">
            <Eyebrow as="h3" className="text-accent-deep">
              Ready to review
            </Eyebrow>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
              Forge runs MMA code-review across the landed commits — a reviewer on the opposite tier. Findings come back
              with their file + severity; you apply or discuss them, just like the audit.
            </p>
          </div>
        </div>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Diff</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <Stat label="Commits" value={`${units.length}`} />
            <Stat label="Files touched" value={`${totalFiles}`} />
            <Stat label="Repos" value={`${repos.length}`} />
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onReview} disabled={readOnly} leftIcon={<Shield />}>
              Run code review
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2 last:border-0">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

/* ── Judge — the code-review chat (mirrors the audit interface) ─────────────── */
function JudgeStage({
  projectName,
  units,
  readOnly,
  driving,
  mmaReady,
  rounds,
  reviewClean,
  onRunReview,
  onResolve,
  onBack,
}: {
  projectName: string;
  units: ReviewUnit[];
  readOnly: boolean;
  driving: boolean;
  mmaReady: boolean;
  rounds: { passNo: number; verdict: 'clean' | 'changes'; findings: ReviewFinding[] }[];
  reviewClean: boolean;
  onRunReview: () => void;
  onResolve: () => void;
  onBack: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    {
      id: nid(),
      role: 'forge',
      text: `I've got the ${units.length} commits from Execute. Run a code review — findings land here with their file and severity; apply the ones you want, tell me by number, or discuss.`,
    },
  ]);
  const [input, setInput] = useState('');
  const seen = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [msgs]);

  useEffect(() => {
    if (rounds.length <= seen.current) return;
    const fresh = rounds.slice(seen.current);
    seen.current = rounds.length;
    setMsgs((m) => [
      ...m,
      ...fresh.flatMap((r) => [
        { id: nid(), role: 'review', passNo: r.passNo, verdict: r.verdict, findings: r.findings } as Msg,
        {
          id: nid(),
          role: 'forge',
          text: r.verdict === 'clean' ? 'Clean pass — no critical or high. You can resolve the review.' : 'Pick the findings to apply, or tell me by number — I’ll push the fixes and you re-review.',
        } as Msg,
      ]),
    ]);
  }, [rounds]);

  function apply(passNo: number, indices: number[], total: number) {
    if (readOnly || indices.length === 0) return;
    const label = indices.length === total ? `all ${total} findings` : `finding${indices.length === 1 ? '' : 's'} #${indices.map((i) => i + 1).sort((a, b) => a - b).join(', #')}`;
    setMsgs((m) => [...m, { id: nid(), role: 'forge', text: `Pushed fixes for ${label} from pass ${passNo}. Re-run the review to verify.` }]);
  }
  function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMsgs((m) => [...m, { id: nid(), role: 'user', text }, { id: nid(), role: 'forge', text: 'Done — pushed that fix to the branch. Re-run the review to verify.' }]);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>{projectName} — code review</CardTitle>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            <Shield className="size-3" /> reviewer · opposite tier
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-2/40 !py-5">
          {msgs.map((m) =>
            m.role === 'user' ? (
              <ChatUser key={m.id} text={m.text} />
            ) : m.role === 'review' ? (
              <ReviewMessage key={m.id} passNo={m.passNo} verdict={m.verdict} findings={m.findings} readOnly={readOnly} onApply={(idx) => apply(m.passNo, idx, m.findings.length)} />
            ) : (
              <ChatForge key={m.id}>{m.text}</ChatForge>
            ),
          )}
          <div ref={bottomRef} />
        </CardContent>
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          secondaries={[
            { label: rounds.length > 0 ? 'Re-run review' : 'Run code review', icon: <Shield />, onClick: onRunReview, disabled: readOnly || !mmaReady || reviewClean },
            { label: 'Back to diff', icon: <ArrowLeft />, onClick: onBack },
          ]}
          placeholder="Discuss the review — “address the worktree quoting finding”…"
          disabled={readOnly || driving}
        />
      </Card>

      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Review rounds</CardTitle>
            {rounds.length > 0 ? <span className="text-sm font-medium text-ink-faint">{rounds.length}</span> : null}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
            {rounds.length === 0 ? (
              <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
                <Shield className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <p className="text-xs leading-relaxed text-ink-soft">
                  Run the review from the conversation. {driving ? 'The AI clears critical & high, then resolves.' : 'Each pass lands here with its severity summary.'}
                </p>
              </div>
            ) : (
              rounds.map((r) => <RoundCard key={r.passNo} round={r} />)
            )}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <TextSm className="!text-ink-faint">
              {reviewClean ? 'Clean review — ready to resolve.' : 'Resolving accepts the changes. Open findings won’t block it.'}
            </TextSm>
            <Button className="w-full" onClick={onResolve} disabled={readOnly} rightIcon={<ArrowRight />}>
              Resolve the review
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── Resolve — accepted changeset + handoff to Journal ──────────────────────── */
function ResolveStage({
  projectId,
  projectName,
  units,
  rounds,
  readOnly,
}: {
  projectId: string;
  projectName: string;
  units: ReviewUnit[];
  rounds: { passNo: number; verdict: 'clean' | 'changes'; findings: ReviewFinding[] }[];
  readOnly: boolean;
}) {
  const passes = rounds.length;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
            <CardTitle>{projectName} — review resolved</CardTitle>
            <Badge variant="sage" size="sm">
              {units.length} commits accepted
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
          {units.map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
              <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
              <span className="font-mono text-[10px] text-ink-faint">{u.num}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.title}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                <FileCode className="size-2.5" /> {u.files.length}
              </span>
              <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">{u.commit}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Resolved</CardTitle>
            <Badge variant="sage" size="sm">accepted</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <Stat label="Commits accepted" value={`${units.length}`} />
            <Stat label="Review passes" value={`${passes}`} />
            <div className="flex items-start gap-2 rounded-[var(--r-md)] border border-sage-tint bg-sage-tint/40 px-3 py-2.5">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--sage-deep)]" />
              <p className="text-[11px] leading-relaxed text-ink-soft">Build complete — the changes are reviewed and accepted. Last stop is the journal.</p>
            </div>
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <TextSm className="!text-ink-faint">Capture what this run taught us before closing out.</TextSm>
            <StageAdvance
              href={`/projects/${projectId}/journal`}
              label="Continue to Journal"
              disabled={readOnly}
              testId="review-continue-link"
            />
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── chat + finding primitives (audit-style, shared language) ───────────────── */
function ChatForge({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <ForgeMark className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-semibold text-ink">Forge</span>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

function ChatUser({ text }: { text: string }) {
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

interface ComposerAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function Composer({
  value,
  onChange,
  onSend,
  secondaries,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  secondaries?: ComposerAction[];
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-line px-5 py-4">
      <div className="flex gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sage-tint text-[11px] font-semibold text-[var(--sage-deep)]">
          AD
        </span>
        <div className="min-w-0 flex-1">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            disabled={disabled}
            placeholder={placeholder}
            className="!min-h-0 !rounded-2xl !text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(secondaries ?? []).map((s, i) => (
              <Button key={i} size="sm" variant="ghost" onClick={s.onClick} disabled={disabled || s.disabled} leftIcon={s.icon}>
                {s.label}
              </Button>
            ))}
            <span className="flex-1" />
            <Button size="sm" onClick={onSend} disabled={disabled || !value.trim()} rightIcon={<ArrowRight />}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeverityTag({ s }: { s: ReviewFinding['severity'] }) {
  return (
    <span className={cn('inline-flex w-[58px] shrink-0 items-center justify-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_STYLE[s])}>
      {s}
    </span>
  );
}

/** A code-review pass — numbered, selectable findings with file location + apply. */
function ReviewMessage({
  passNo,
  verdict,
  findings,
  readOnly,
  onApply,
}: {
  passNo: number;
  verdict: 'clean' | 'changes';
  findings: ReviewFinding[];
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
          <span className="text-xs font-semibold text-ink">Code review</span>
          <span className="text-[11px] text-ink-faint">pass {passNo}</span>
          <Badge variant={verdict === 'clean' ? 'sage' : 'neutral'} size="sm">
            {verdict === 'clean' ? 'clean' : `${findings.length} finding${findings.length === 1 ? '' : 's'} → changes`}
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
                      <button type="button" onClick={() => !readOnly && toggle(i)} disabled={readOnly} className={cn('flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors', on ? 'bg-accent-tint/40' : 'hover:bg-surface-2/50')}>
                        <span className={cn('mt-px grid size-5 shrink-0 place-items-center rounded-[6px] border text-[11px] font-semibold transition-colors', on ? 'border-accent bg-accent text-white' : 'border-line-strong text-ink-faint')}>
                          {on ? <Check className="size-3.5" /> : i + 1}
                        </span>
                        <SeverityTag s={f.severity} />
                        <span className="min-w-0">
                          <span className="text-sm leading-relaxed text-ink">{f.claim}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-ink-faint">{f.location}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-3.5 py-2.5">
                <span className="text-[11px] text-ink-faint">Pick the ones to apply, or tell Forge by number.</span>
                <span className="flex-1" />
                <Button size="sm" variant="secondary" onClick={() => onApply([...sel])} disabled={readOnly || sel.size === 0} leftIcon={<Check />}>
                  Apply selected{sel.size > 0 ? ` (${sel.size})` : ''}
                </Button>
                <Button size="sm" onClick={() => onApply(findings.map((_, i) => i))} disabled={readOnly} leftIcon={<Sparkles />}>
                  Apply all {findings.length}
                </Button>
              </div>
            </>
          ) : (
            <p className="px-4 py-3 text-sm leading-relaxed text-ink">No critical or high findings — the changes are ready to accept.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function RoundCard({ round }: { round: { passNo: number; verdict: 'clean' | 'changes'; findings: ReviewFinding[] } }) {
  const counts: Record<ReviewFinding['severity'], number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of round.findings) counts[f.severity] += 1;
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">Pass {round.passNo}</span>
        <Badge variant={round.verdict === 'clean' ? 'sage' : 'neutral'} size="sm">
          {round.verdict === 'clean' ? 'clean' : 'changes'}
        </Badge>
        <span className="ml-auto text-[11px] text-ink-faint">
          {round.findings.length} finding{round.findings.length === 1 ? '' : 's'}
        </span>
      </div>
      {round.findings.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <span key={s} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', SEVERITY_STYLE[s])}>
              <span className="font-semibold">{counts[s]}</span>
              {s}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-ink-faint">No critical or high findings.</p>
      )}
    </div>
  );
}
