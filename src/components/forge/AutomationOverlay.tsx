'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Square,
  Loader2,
  Check,
  BookOpen,
  FileText,
  ListTree,
  Rocket,
  ScanSearch,
  NotebookPen,
  Clock,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format-date';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
} from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { automationOverlayStore } from '@/components/forge/AutomationGate';

const AUTOMATION_NOTE = `### What is this?

- Forge drives every stage step-by-step, as if a human is clicking
- Audit loops run up to 5 passes or until no critical/high findings
- Each plan task gets self-validation before approval
- You can stop anytime and take over manually`;

const STAGES = [
  { key: 'exploration', label: 'Explore', icon: BookOpen, phases: [
    { key: 'brief', label: 'Brief' },
    { key: 'discover', label: 'Discover' },
    { key: 'synthesize', label: 'Synthesize' },
  ]},
  { key: 'spec', label: 'Spec', icon: FileText, phases: [
    { key: 'outline', label: 'Outline' },
    { key: 'craft', label: 'Craft' },
    { key: 'finalize', label: 'Finalize' },
  ]},
  { key: 'plan', label: 'Plan', icon: ListTree, phases: [
    { key: 'refine', label: 'Refine' },
    { key: 'validate', label: 'Validate' },
  ]},
  { key: 'execute', label: 'Execute', icon: Rocket, phases: [
    { key: 'configure', label: 'Configure' },
    { key: 'monitor', label: 'Monitor' },
  ]},
  { key: 'review', label: 'Review', icon: ScanSearch, phases: [
    { key: 'review', label: 'Review' },
  ]},
  { key: 'journal', label: 'Reflect', icon: NotebookPen, phases: [
    { key: 'journal', label: 'Journal' },
    { key: 'summary', label: 'Summary' },
  ]},
] as const;

const STAGE_ORDER = STAGES.map((s) => s.key);
type StageKey = typeof STAGE_ORDER[number];

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2 last:border-0">
      <span className="flex items-center gap-1.5 text-xs text-ink-faint">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

interface Props {
  projectId: string;
  projectName: string;
  autoMode: boolean;
  autoNote: string;
  currentStage: string;
  phase: string;
}

export function AutomationOverlay({ projectId, projectName, autoMode, autoNote, currentStage, phase }: Props) {
  const router = useRouter();
  const [countdown, setCountdown] = useState(autoMode ? 0 : 3);
  const [liveNote, setLiveNote] = useState(autoMode ? autoNote : 'Starting in 3...');
  const [liveStage, setLiveStage] = useState(currentStage);
  const [livePhase, setLivePhase] = useState(phase);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; done: boolean }>>([]);
  const [stepCount, setStepCount] = useState(0);
  const startTime = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Countdown on mount (only when not already running from server)
  useEffect(() => {
    if (autoMode || countdown <= 0) return;
    const t = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          setLiveNote('Automation started');
          return 0;
        }
        setLiveNote(`Starting in ${prev - 1}...`);
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [autoMode, countdown]);

  // Elapsed time ticker
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startTime.current), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (autoNote) setLiveNote(autoNote); }, [autoNote]);
  useEffect(() => { setLiveStage(currentStage); }, [currentStage]);

  const addLog = useCallback((text: string) => {
    const time = formatTime(new Date());
    setLogs((prev) => [...prev, { time, text, done: false }]);
    setTimeout(() => {
      setLogs((prev) => prev.map((l, i) => i === prev.length - 1 ? { ...l, done: true } : l));
    }, 1500);
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    function onProgress(e: Event) {
      const d = (e as CustomEvent).detail as { note?: string; stage?: string; phase?: string };
      if (d?.note) { setLiveNote(d.note); addLog(d.note); }
      if (d?.stage) setLiveStage(d.stage);
      if (d?.phase) setLivePhase(d.phase);
    }
    function onStepDone(e: Event) {
      const d = (e as CustomEvent).detail as { step?: string; stage?: string; phase?: string; stepIndex?: number };
      if (d?.stage) setLiveStage(d.stage);
      if (d?.phase) setLivePhase(d.phase);
      if (d?.stepIndex) setStepCount(d.stepIndex);
      router.refresh();
    }
    function onError(e: Event) {
      const d = (e as CustomEvent).detail as { error?: string };
      if (d?.error) { setLiveNote(`Error: ${d.error}`); addLog(`Error: ${d.error}`); }
      router.refresh();
    }
    window.addEventListener('automation:progress', onProgress);
    window.addEventListener('automation:step_done', onStepDone);
    window.addEventListener('automation:error', onError);
    return () => {
      window.removeEventListener('automation:progress', onProgress);
      window.removeEventListener('automation:step_done', onStepDone);
      window.removeEventListener('automation:error', onError);
    };
  }, [router, addLog]);

  const currentIdx = STAGE_ORDER.indexOf(liveStage as StageKey);

  function stageStatus(key: string): 'done' | 'active' | 'pending' {
    const idx = STAGE_ORDER.indexOf(key as StageKey);
    if (idx < currentIdx) return 'done';
    if (idx === currentIdx) return 'active';
    return 'pending';
  }

  function phaseStatus(stgKey: string, phKey: string, phIdx: number, stg: 'done' | 'active' | 'pending') {
    if (stg === 'done') return 'done' as const;
    if (stg === 'pending') return 'pending' as const;
    // Active stage — check if current phase matches
    const stgDef = STAGES.find((s) => s.key === stgKey);
    if (!stgDef) return 'pending' as const;
    const livePIdx = stgDef.phases.findIndex((p) => p.key === livePhase);
    if (livePIdx < 0) return phIdx === 0 ? 'active' as const : 'pending' as const;
    if (phIdx < livePIdx) return 'done' as const;
    if (phIdx === livePIdx) return 'active' as const;
    return 'pending' as const;
  }

  async function handleStop() {
    await fetch(`/api/projects/${projectId}/automation/stop`, { method: 'POST' });
    automationOverlayStore.hide();
    router.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Automation bar */}
      <div className="flex shrink-0 items-center gap-3 rounded-[var(--r-lg)] border border-accent/40 bg-accent-tint/40 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-white">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            {countdown > 0 ? 'Getting ready...' : 'Forge is driving'}
            {countdown <= 0 && autoMode && <span className="inline-flex size-1.5 animate-pulse rounded-full bg-accent" />}
          </p>
          <p className="truncate text-xs text-ink-soft">{liveNote || 'Starting automation...'}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={handleStop} leftIcon={<Square />}>
          Stop &amp; take over
        </Button>
      </div>

      {/* Content — 2/3 pipeline + 1/3 details */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">

        {/* LEFT 2/3 — Pipeline stages */}
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            <Badge variant="accent" size="sm" dot>{projectName}</Badge>
          </CardHeader>

          {/* Progress bar */}
          <div className="flex items-center gap-2 border-b border-line px-5 py-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-[var(--sage)] transition-all duration-500"
                style={{ width: `${STAGES.length ? ((currentIdx + 1) / STAGES.length) * 100 : 0}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium text-ink-faint">
              {currentIdx + 1}/{STAGES.length}
            </span>
          </div>

          <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-3">
            {STAGES.map((stg) => {
              const s = stageStatus(stg.key);
              const Icon = stg.icon;
              const isActive = s === 'active';

              return (
                <div key={stg.key}>
                  {/* Stage row */}
                  <div
                    className={cn(
                      'flex w-full items-center gap-3 rounded-[var(--r-md)] border p-3 transition-colors',
                      isActive
                        ? 'border-accent bg-accent-tint/25 shadow-sm'
                        : s === 'done'
                          ? 'border-[var(--sage)]/30 bg-sage-tint/20'
                          : 'border-line bg-surface',
                    )}
                  >
                    <span className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-[8px]',
                      isActive ? 'bg-accent text-white'
                        : s === 'done' ? 'bg-[var(--sage)] text-white'
                          : 'bg-surface-2 text-ink-faint',
                    )}>
                      {s === 'done' ? <Check className="size-4" /> : isActive ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        'text-sm font-medium',
                        isActive ? 'text-accent' : s === 'done' ? 'text-[var(--sage-deep)]' : 'text-ink-faint',
                      )}>
                        {stg.label}
                      </p>
                      {/* Active stage shows the current note */}
                      {isActive && liveNote && countdown <= 0 && (
                        <p className="mt-0.5 truncate text-xs text-ink-soft">{liveNote}</p>
                      )}
                    </div>
                    {s === 'done' && (
                      <Badge variant="sage" size="sm">Done</Badge>
                    )}
                    {isActive && (
                      <Badge variant="accent" size="sm" dot>Active</Badge>
                    )}
                  </div>

                  {/* Phase sub-items (expanded for done + active stages) */}
                  {(s === 'done' || isActive) && (
                    <div className="ml-[22px] border-l border-line/60 pl-4 pt-1 pb-1">
                      {stg.phases.map((ph, pi) => {
                        const ps = phaseStatus(stg.key, ph.key, pi, s);
                        return (
                          <div key={ph.key} className="flex items-center gap-2 py-1">
                            {ps === 'done' ? (
                              <Check className="size-3.5 text-[var(--sage)]" />
                            ) : ps === 'active' ? (
                              <Loader2 className="size-3.5 animate-spin text-accent" />
                            ) : (
                              <span className="size-3.5 text-center text-[10px] text-ink-faint">○</span>
                            )}
                            <span className={cn(
                              'text-xs',
                              ps === 'done' ? 'text-[var(--sage-deep)]'
                                : ps === 'active' ? 'font-medium text-accent'
                                  : 'text-ink-faint',
                            )}>
                              {ph.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>

          <CardFooter className="text-xs text-ink-faint">
            Automation runs every step as if a human clicked through. Stop anytime to take over.
          </CardFooter>
        </Card>

        {/* RIGHT 1/3 — Note + Stats + Activity log */}
        <aside className="flex min-h-0 flex-col gap-4">
          {/* Static RailNote */}
          <RailNote icon={<Bot />}>{AUTOMATION_NOTE}</RailNote>

          {/* Summary stats */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 !py-4">
              <Stat label="Steps completed" value={`${stepCount}`} icon={<Zap className="size-3" />} />
              <Stat label="Time elapsed" value={formatElapsed(elapsed)} icon={<Clock className="size-3" />} />
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              {logs.length > 0 && <Badge variant="neutral" size="sm">{logs.length}</Badge>}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-0 overflow-y-auto">
              {logs.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12">
                  {countdown > 0 ? (
                    <>
                      <span className="text-3xl font-bold text-accent">{countdown}</span>
                      <p className="text-xs text-ink-faint">Starting shortly...</p>
                    </>
                  ) : (
                    <>
                      <Loader2 className="size-5 animate-spin text-accent" />
                      <p className="text-xs text-ink-faint">Waiting for first action...</p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {logs.map((l, i) => (
                    <div key={i} className="flex items-start gap-2 border-b border-line/40 py-1.5">
                      <span className="min-w-[32px] font-mono text-[10px] text-ink-faint">{l.time}</span>
                      {l.done ? (
                        <Check className="mt-0.5 size-3 shrink-0 text-[var(--sage)]" />
                      ) : (
                        <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-accent" />
                      )}
                      <span className={cn('text-[11px]', l.done ? 'text-ink-soft' : 'font-medium text-accent')}>
                        {l.text}
                      </span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
