import { CircleAlert, Loader2, CheckCircle2, Lightbulb } from 'lucide-react';
import { Card, CardContent, Eyebrow, TextStrong } from '@/components/ui';
import type { DashboardProject } from '@/dashboard/dashboard-core';

/**
 * ProjectsRail — the RAIL of the Projects control tower, on the app's standard
 * rail language: the functional panels (attention · agent activity) are Cards,
 * and the standing tip is the accent-tint note used by every other page's rail
 * (JournalNote / SettingsAccessNote). Each panel is real data; the attention card
 * shows "all caught up" when nothing is blocked, never a fabricated alert.
 */
function reason(p: DashboardProject): string {
  if (p.awaitingHuman > 0) {
    return `${p.awaitingHuman} spec section${p.awaitingHuman === 1 ? '' : 's'} await your review`;
  }
  return `spec audit has ${p.openAuditIssues} open finding${p.openAuditIssues === 1 ? '' : 's'}`;
}

export function ProjectsRail({ projects }: { projects: DashboardProject[] }) {
  const attention = projects.filter((p) => p.awaitingHuman > 0 || p.openAuditIssues > 0);
  const running = projects.filter((p) => p.agentsRunning > 0);
  const totalAgents = running.reduce((s, p) => s + p.agentsRunning, 0);

  return (
    <>
      {/* Needs your attention */}
      <Card>
        <CardContent>
          <Eyebrow as="h3" className="text-ink-faint">Needs your attention</Eyebrow>
          <ul className="mt-2.5 flex flex-col">
            {attention.length > 0 ? (
              attention.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/projects/${p.id}`}
                    className="focus-ring flex gap-2.5 border-t border-line py-2.5 text-sm leading-snug text-ink-soft transition-colors first:border-t-0 first:pt-0 hover:text-ink"
                  >
                    <CircleAlert className="mt-px size-[15px] shrink-0 text-amber" aria-hidden />
                    <span className="min-w-0">
                      <TextStrong as="span" className="!text-ink">{p.name}</TextStrong> — {reason(p)}
                    </span>
                  </a>
                </li>
              ))
            ) : (
              <li className="flex gap-2.5 pt-1 text-sm text-ink-soft">
                <CheckCircle2 className="mt-px size-[15px] shrink-0 text-sage" aria-hidden />
                <span>You&rsquo;re all caught up — nothing is waiting on a decision.</span>
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      {/* Agent activity */}
      {totalAgents > 0 ? (
        <Card>
          <CardContent>
            <Eyebrow as="h3" className="text-ink-faint">Agent activity</Eyebrow>
            <div className="mt-2.5 flex items-center gap-2.5 text-sm text-ink-soft">
              <Loader2 className="size-[15px] shrink-0 animate-spin text-amber" aria-hidden />
              <span>
                <TextStrong as="span" className="!text-ink">{totalAgents}</TextStrong> agent
                {totalAgents === 1 ? '' : 's'} running across {running.length} project
                {running.length === 1 ? '' : 's'}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Tip — the accent-tint note used by every other page's rail */}
      <div className="flex items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4">
        <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
          <Lightbulb className="size-5" />
        </span>
        <p className="text-xs leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Freeze when the audit is clean.</span> Freezing the
          spec is a point of no return into Build — only freeze once its audit has zero open findings.
        </p>
      </div>
    </>
  );
}
