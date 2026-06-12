import { CircleAlert, Loader, CheckCircle2, Lightbulb } from 'lucide-react';
import { RailPanel, RailItem, GuidanceCard, TextStrong } from '@/components/ui';
import type { DashboardProject } from '@/dashboard/dashboard-core';

/**
 * ProjectsRail — the RAIL section of the Projects control tower. Composes the
 * rail primitives from real signals: an attention list (projects blocked on a
 * human decision or an audit finding), an agent-activity summary, and a
 * standing guidance tip. Each panel is real data — the attention panel shows
 * "all caught up" when nothing is blocked, never a fabricated alert.
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
      <RailPanel title="Needs your attention">
        {attention.length > 0 ? (
          attention.map((p) => (
            <RailItem
              key={p.id}
              href={`/projects/${p.id}`}
              icon={<CircleAlert className="text-[var(--amber)]" />}
            >
              <TextStrong as="span" className="!text-ink">
                {p.name}
              </TextStrong>{' '}
              — {reason(p)}
            </RailItem>
          ))
        ) : (
          <RailItem icon={<CheckCircle2 className="text-[var(--sage)]" />}>
            You&rsquo;re all caught up — nothing is waiting on a decision.
          </RailItem>
        )}
      </RailPanel>

      {totalAgents > 0 ? (
        <RailPanel title="Agent activity">
          <RailItem icon={<Loader className="text-[var(--amber)]" />}>
            {totalAgents} agent{totalAgents === 1 ? '' : 's'} running across {running.length} project
            {running.length === 1 ? '' : 's'}
          </RailItem>
        </RailPanel>
      ) : null}

      <RailPanel title="Tips">
        <GuidanceCard icon={<Lightbulb />}>
          Freeze the spec only after its audit is clean — it&rsquo;s a point of no return into Build.
        </GuidanceCard>
      </RailPanel>
    </>
  );
}
