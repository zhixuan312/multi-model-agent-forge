'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format-date';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@/components/ui';
import { automationThemeStore } from '@/components/forge/PhaseFromRoute';

const STAGES = [
  { key: 'exploration', label: 'Explore', phases: ['Brief', 'Discover', 'Synthesize'] },
  { key: 'spec', label: 'Spec', phases: ['Outline', 'Craft', 'Finalize'] },
  { key: 'plan', label: 'Plan', phases: ['Refine', 'Validate'] },
  { key: 'execute', label: 'Execute', phases: ['Configure', 'Monitor'] },
  { key: 'review', label: 'Review', phases: ['Review'] },
  { key: 'journal', label: 'Reflect', phases: ['Journal', 'Summary'] },
] as const;

const STAGE_ORDER = STAGES.map((s) => s.key);

interface Props {
  projectId: string;
  projectName: string;
  autoMode: boolean;
  autoNote: string;
  currentStage: string;
  phase: string;
}

export function AutomationOverlay({ projectId, projectName, autoMode, autoNote, currentStage }: Props) {
  const router = useRouter();
  const [liveNote, setLiveNote] = useState(autoNote);
  const [liveStage, setLiveStage] = useState(currentStage);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; active?: boolean }>>([]);

  useEffect(() => { setLiveNote(autoNote); }, [autoNote]);
  useEffect(() => { setLiveStage(currentStage); }, [currentStage]);
  useEffect(() => { automationThemeStore.set(true); return () => { automationThemeStore.set(false); }; }, []);

  const addLog = useCallback((text: string, active = true) => {
    const time = formatTime(new Date());
    setLogs((prev) => [
      ...prev.map((l) => ({ ...l, active: false })),
      { time, text, active },
    ]);
  }, []);

  useEffect(() => {
    function onProgress(e: Event) {
      const detail = (e as CustomEvent).detail as { note?: string };
      if (detail?.note) { setLiveNote(detail.note); addLog(detail.note); }
    }
    function onStepDone() { router.refresh(); }
    function onError(e: Event) {
      const detail = (e as CustomEvent).detail as { error?: string };
      if (detail?.error) { setLiveNote(`Error: ${detail.error}`); addLog(`Error: ${detail.error}`); }
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

  const currentIdx = STAGE_ORDER.indexOf(liveStage as typeof STAGE_ORDER[number]);

  function stageStatus(key: string): 'done' | 'active' | 'pending' {
    const idx = STAGE_ORDER.indexOf(key as typeof STAGE_ORDER[number]);
    if (idx < currentIdx) return 'done';
    if (idx === currentIdx) return 'active';
    return 'pending';
  }

  async function handleStop() {
    await fetch(`/api/projects/${projectId}/automation/stop`, { method: 'POST' });
    router.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Automation header — matches AutomationBar pattern */}
      <div className={cn(
        'flex shrink-0 items-center gap-3 rounded-[var(--r-lg)] border px-4 py-3 transition-colors',
        'border-accent/40 bg-accent-tint/40',
      )}>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-white">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            Forge is driving
            <span className="inline-flex size-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
          </p>
          <p className="truncate text-xs text-ink-soft">{liveNote || 'Starting automation...'}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={handleStop} leftIcon={<Square />}>
          Stop &amp; take over
        </Button>
      </div>

      {/* Main content — same grid as all other stages */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">

        {/* LEFT 2/3: Pipeline diagram */}
        <Card className="relative flex min-h-0 flex-col overflow-hidden lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            <Badge variant="accent" size="sm" dot>{projectName}</Badge>
          </CardHeader>
          <CardContent className="relative min-h-0 flex-1">
            {/* Dot grid background */}
            <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(var(--ink) 0.5px, transparent 0.5px)', backgroundSize: '16px 16px' }} />

            <svg viewBox="0 0 760 290" className="relative z-10 h-full w-full" preserveAspectRatio="xMidYMid meet">
              {STAGES.map((stg, i) => {
                const x = 12 + i * 128;
                const s = stageStatus(stg.key);

                return (
                  <g key={stg.key}>
                    {/* Horizontal connector */}
                    {i > 0 && (
                      <>
                        <line x1={x - 28} y1={34} x2={x - 4} y2={34}
                          stroke={s === 'pending' ? 'var(--line)' : s === 'active' ? 'var(--accent)' : 'var(--sage)'}
                          strokeWidth={2} strokeDasharray={s === 'pending' ? '5,4' : undefined} />
                        <polygon points={`${x - 6},30 ${x + 2},34 ${x - 6},38`}
                          fill={s === 'active' ? 'var(--accent)' : s === 'done' ? 'var(--sage)' : 'var(--line)'} />
                      </>
                    )}

                    {/* Active glow ring */}
                    {s === 'active' && (
                      <rect x={x - 4} y={4} width={100} height={56} rx={14}
                        fill="none" stroke="var(--accent)" strokeWidth={3} opacity={0.15} />
                    )}

                    {/* Stage node */}
                    <rect x={x} y={8} width={92} height={48} rx={12}
                      fill={s === 'done' ? 'var(--sage)' : s === 'active' ? 'var(--accent)' : 'var(--surface)'}
                      stroke={s === 'pending' ? 'var(--line)' : 'none'} strokeWidth={1.5} />
                    <text x={x + 46} y={28} textAnchor="middle"
                      fill={s === 'pending' ? 'var(--ink-faint)' : '#fff'}
                      fontSize={12} fontWeight={700}>
                      {s === 'done' ? '✓ ' : s === 'active' ? '⚡ ' : ''}{stg.label}
                    </text>
                    {s !== 'pending' && (
                      <text x={x + 46} y={44} textAnchor="middle"
                        fill={s === 'done' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.65)'} fontSize={8}>
                        {s === 'done' ? 'Complete' : ''}
                      </text>
                    )}

                    {/* Vertical connector to phases */}
                    <line x1={x + 46} y1={56} x2={x + 46} y2={80}
                      stroke={s === 'done' ? 'var(--sage)' : s === 'active' ? 'var(--accent)' : 'var(--line)'}
                      strokeWidth={1.5} opacity={0.25} />

                    {/* Phase nodes */}
                    {stg.phases.map((ph, pi) => {
                      const py = 82 + pi * 60;
                      const pDone = s === 'done';
                      const pActive = s === 'active' && pi === 0;

                      return (
                        <g key={ph}>
                          {pi > 0 && (
                            <line x1={x + 46} y1={py - 12} x2={x + 46} y2={py}
                              stroke={pDone ? 'var(--sage)' : pActive ? 'var(--accent)' : 'var(--line)'}
                              strokeWidth={1} opacity={0.2} />
                          )}
                          <rect x={x} y={py} width={92} height={38} rx={8}
                            fill={pDone ? 'var(--sage-tint)' : pActive ? 'var(--accent-tint)' : 'var(--surface-2)'}
                            stroke={pDone ? 'var(--sage)' : pActive ? 'var(--accent)' : 'var(--line)'}
                            strokeWidth={pActive ? 2 : 1} />
                          <text x={x + 46} y={py + 16} textAnchor="middle"
                            fill={pDone ? 'var(--sage-deep)' : pActive ? 'var(--accent)' : 'var(--ink-faint)'}
                            fontSize={10} fontWeight={pDone || pActive ? 700 : 500}>
                            {pDone ? '✓ ' : pActive ? '● ' : '○ '}{ph}
                          </text>
                          {pActive && (
                            <>
                              <rect x={x + 8} y={py + 28} width={76} height={3} rx={1.5} fill="var(--surface-2)" />
                              <rect x={x + 8} y={py + 28} width={16} height={3} rx={1.5} fill="var(--accent)">
                                <animate attributeName="width" from="8" to="76" dur="60s" fill="freeze" />
                              </rect>
                            </>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </CardContent>
        </Card>

        {/* RIGHT 1/3: Activity log */}
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-0 overflow-y-auto">
            {logs.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12">
                <Loader2 className="size-5 animate-spin text-accent" />
                <p className="text-xs text-ink-faint">Waiting for first action...</p>
              </div>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="flex items-start gap-2 border-b border-line/40 py-1.5">
                  <span className="min-w-[32px] font-mono text-[10px] text-ink-faint">{l.time}</span>
                  <span className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    l.active ? 'animate-pulse bg-accent' : 'bg-[var(--sage)]',
                  )} />
                  <span className={cn(
                    'text-[11px]',
                    l.active ? 'font-medium text-accent' : 'text-ink-soft',
                  )}>{l.text}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
