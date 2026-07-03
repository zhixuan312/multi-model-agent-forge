'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Square } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import type { ProjectSummary } from '@/projects/project-summary';

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
  summary: ProjectSummary;
}

export function AutomationDashboard({ projectId, projectName, autoMode, autoNote, currentStage, phase, summary }: Props) {
  const router = useRouter();
  const [liveNote, setLiveNote] = useState(autoNote);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; active?: boolean }>>([]);

  useEffect(() => { setLiveNote(autoNote); }, [autoNote]);

  useEffect(() => {
    function onProgress(e: Event) {
      const detail = (e as CustomEvent).detail as { note?: string };
      if (detail?.note) {
        setLiveNote(detail.note);
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        setLogs((prev) => [
          ...prev.map((l) => ({ ...l, active: false })),
          { time, text: detail.note ?? '', active: true },
        ]);
      }
    }
    function onStepDone() {
      router.refresh();
    }
    function onError(e: Event) {
      const detail = (e as CustomEvent).detail as { error?: string };
      if (detail?.error) {
        setLiveNote(`Error: ${detail.error}`);
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        setLogs((prev) => [...prev, { time, text: `Error: ${detail.error}`, active: true }]);
      }
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
  }, [router]);

  const currentStageIdx = STAGE_ORDER.indexOf(currentStage as typeof STAGE_ORDER[number]);

  function stageStatus(stageKey: string): 'done' | 'active' | 'pending' {
    const idx = STAGE_ORDER.indexOf(stageKey as typeof STAGE_ORDER[number]);
    const stg = summary.timeline.stages.find((s) => s.kind === stageKey);
    if (stg?.completedAt) return 'done';
    if (idx === currentStageIdx) return 'active';
    if (idx < currentStageIdx) return 'done';
    return 'pending';
  }

  function phaseDetail(stageKey: string, phaseName: string): string {
    const stg = summary.timeline.stages.find((s) => s.kind === stageKey);
    if (!stg?.completedAt && STAGE_ORDER.indexOf(stageKey as typeof STAGE_ORDER[number]) > currentStageIdx) return '';
    if (stageKey === 'spec') {
      if (phaseName === 'Finalize') return `${summary.quality.auditPasses.filter((p) => p.scope === 'spec').length} audits`;
      if (phaseName === 'Craft') return `v${summary.quality.specVersion}`;
    }
    if (stageKey === 'plan') {
      if (phaseName === 'Refine') return `${summary.delivery.totalTasks} tasks`;
      if (phaseName === 'Validate') return `${summary.quality.auditPasses.filter((p) => p.scope === 'plan').length} audits`;
    }
    if (stageKey === 'execute') return `${summary.delivery.committed} committed`;
    if (stageKey === 'journal') return `${summary.knowledge.recorded} learnings`;
    return '';
  }

  async function handleStop() {
    await fetch(`/api/projects/${projectId}/automation/stop`, { method: 'POST' });
    router.push(`/projects/${projectId}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* AutomationBar */}
      <div className="flex shrink-0 items-center gap-3 rounded-[var(--r-lg)] bg-ink px-4 py-3 text-white">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm">🤖</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            Forge is driving — {projectName}
            {autoMode && <span className="inline-flex size-1.5 animate-pulse rounded-full bg-[#4ade80]" />}
          </p>
          <p className="truncate text-xs text-white/60">{liveNote || 'Starting automation...'}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/60">
          <span>${summary.cost.totalUsd.toFixed(2)}</span>
          <span>{Math.round(summary.effort.totalDurationMs / 1000 / 60)}m</span>
        </div>
        <Button size="sm" variant="secondary" onClick={handleStop} leftIcon={<Square />}>
          Stop
        </Button>
      </div>

      {/* Main: Pipeline + Log */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3 lg:items-stretch">
        {/* LEFT 2/3: SVG Pipeline */}
        <Card className="relative overflow-hidden lg:col-span-2">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#c4b5a0 0.5px, transparent 0.5px)', backgroundSize: '14px 14px' }} />
          <CardContent className="relative z-10 flex h-full items-center justify-center p-4">
            <svg viewBox="0 0 760 290" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
              {STAGES.map((stg, i) => {
                const x = 12 + i * 128;
                const s = stageStatus(stg.key);
                const fill = s === 'done' ? '#3d6b4f' : s === 'active' ? '#c4521e' : '#fff';
                const stroke = s === 'pending' ? '#e0dbd4' : 'none';
                const textFill = s === 'pending' ? '#bbb' : '#fff';

                return (
                  <g key={stg.key}>
                    {/* Horizontal connector */}
                    {i > 0 && (
                      <>
                        <line x1={x - 28} y1={34} x2={x - 4} y2={34}
                          stroke={stageStatus(STAGES[i - 1].key) === 'done' && s !== 'pending' ? '#3d6b4f' : '#ddd'}
                          strokeWidth={2} strokeDasharray={s === 'pending' ? '5,4' : 'none'} />
                        <polygon points={`${x - 6},30 ${x + 2},34 ${x - 6},38`}
                          fill={s === 'active' ? '#c4521e' : s === 'done' ? '#3d6b4f' : '#ddd'} />
                      </>
                    )}

                    {/* Stage node */}
                    {s === 'active' && (
                      <rect x={x - 4} y={4} width={100} height={56} rx={14} fill="none" stroke="rgba(196,82,30,0.2)" strokeWidth={4} />
                    )}
                    <rect x={x} y={8} width={92} height={48} rx={12} fill={fill} stroke={stroke} strokeWidth={stroke !== 'none' ? 1.5 : 0} />
                    <text x={x + 46} y={28} textAnchor="middle" fill={textFill} fontSize={12} fontWeight={700}>
                      {s === 'done' ? '✓ ' : s === 'active' ? '⚡ ' : ''}{stg.label}
                    </text>
                    {s !== 'pending' && (
                      <text x={x + 46} y={44} textAnchor="middle" fill={s === 'done' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.7)'} fontSize={8}>
                        {s === 'done' ? 'Done' : liveNote?.split(':')[0] || ''}
                      </text>
                    )}

                    {/* Vertical connector */}
                    <line x1={x + 46} y1={56} x2={x + 46} y2={80} stroke={s === 'done' ? '#3d6b4f' : s === 'active' ? '#c4521e' : '#e0dbd4'} strokeWidth={1.5} opacity={0.3} />

                    {/* Phase nodes */}
                    {stg.phases.map((ph, pi) => {
                      const py = 82 + pi * 60;
                      const phaseDone = s === 'done';
                      const phaseActive = s === 'active' && pi === 0;
                      const pFill = phaseDone ? '#f0f7f2' : phaseActive ? '#fff7ed' : '#faf8f5';
                      const pStroke = phaseDone ? '#3d6b4f' : phaseActive ? '#c4521e' : '#e8e2d9';
                      const pText = phaseDone ? '#3d6b4f' : phaseActive ? '#c4521e' : '#ccc';
                      const detail = phaseDetail(stg.key, ph);

                      return (
                        <g key={ph}>
                          {pi > 0 && (
                            <line x1={x + 46} y1={py - 12} x2={x + 46} y2={py} stroke={pStroke} strokeWidth={1} opacity={0.25} />
                          )}
                          <rect x={x} y={py} width={92} height={detail ? 48 : 38} rx={8} fill={pFill} stroke={pStroke} strokeWidth={phaseActive ? 2 : 1} />
                          <text x={x + 46} y={py + 16} textAnchor="middle" fill={pText} fontSize={10} fontWeight={phaseActive || phaseDone ? 700 : 500}>
                            {phaseDone ? '✓ ' : phaseActive ? '● ' : '○ '}{ph}
                          </text>
                          {detail && (
                            <text x={x + 46} y={py + 30} textAnchor="middle" fill={pText} fontSize={7} opacity={0.8}>{detail}</text>
                          )}
                          {phaseActive && (
                            <>
                              <rect x={x + 8} y={py + 36} width={76} height={3} rx={1.5} fill="#f0ede8" />
                              <rect x={x + 8} y={py + 36} width={16} height={3} rx={1.5} fill="#c4521e" />
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

        {/* RIGHT 1/3: Stats + Activity Log */}
        <div className="flex min-h-0 flex-col gap-3">
          {/* Stats */}
          <Card>
            <CardContent className="grid grid-cols-3 gap-2 py-3 text-center">
              <div>
                <p className="text-lg font-bold text-ink">{summary.effort.totalCalls}</p>
                <p className="text-[9px] uppercase tracking-wide text-ink-faint">Calls</p>
              </div>
              <div>
                <p className="text-lg font-bold text-ink">${summary.cost.totalUsd.toFixed(0)}</p>
                <p className="text-[9px] uppercase tracking-wide text-ink-faint">Cost</p>
              </div>
              <div>
                <p className="text-lg font-bold text-ink">{Math.round(summary.effort.totalDurationMs / 1000 / 60)}m</p>
                <p className="text-[9px] uppercase tracking-wide text-ink-faint">Elapsed</p>
              </div>
            </CardContent>
          </Card>

          {/* Activity Log */}
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wide text-ink-faint">Activity</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-0 overflow-y-auto font-mono text-[11px]">
              {logs.length === 0 && (
                <p className="py-4 text-center text-xs text-ink-faint">Automation events appear here...</p>
              )}
              {logs.map((l, i) => (
                <div key={i} className="flex items-start gap-1.5 border-b border-line/50 py-1">
                  <span className="min-w-[28px] text-ink-faint">{l.time}</span>
                  <span className={`mt-1 size-1 shrink-0 rounded-full ${l.active ? 'animate-pulse bg-accent' : 'bg-[var(--sage)]'}`} />
                  <span className={l.active ? 'font-medium text-accent' : 'text-ink-soft'}>{l.text}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
