import { ArrowUpRight, GitBranch, FileText, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { Section, SectionTitle, Badge, Mono, Micro, Text, TextStrong, Separator } from '@/components/ui';
import type { LoopRunRow, RunVerification } from '@/db/schema/loop';
import { RUN_STATUS_VARIANT, statusLabel, cap, fmtRunTime, fmtDuration, cleanChange, shortId } from './run-format';
import { RunLivePoll } from './RunLivePoll';

/** A labeled meta item in the header strip. */
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Micro className="uppercase tracking-wide text-ink-faint">{label}</Micro>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

function VerificationRow({ verification }: { verification: RunVerification | null }) {
  if (!verification || verification.command === null) {
    return (
      <div className="flex items-center gap-2 text-ink-soft">
        <ShieldQuestion className="size-4 text-ink-faint" aria-hidden />
        <Text className="!text-sm">Not configured — this repo has no test command for the loop to run.</Text>
      </div>
    );
  }
  const passed = verification.passed === true;
  return (
    <div className="flex items-start gap-2">
      {passed ? <ShieldCheck className="mt-0.5 size-4 text-sage-deep" aria-hidden /> : <ShieldAlert className="mt-0.5 size-4 text-rose" aria-hidden />}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge size="sm" variant={passed ? 'sage' : 'rose'}>{passed ? 'Passed' : 'Failed'}</Badge>
          <Mono className="!text-xs text-ink-soft">{verification.command}</Mono>
        </div>
        <Text className="!text-sm text-ink-soft">{verification.detail}</Text>
      </div>
    </div>
  );
}

/**
 * The full record for a single loop run — a header strip (status, id, branch,
 * PR, timing) above discrete sections (Summary · Key changes · Verification ·
 * Files · Journal). Renders inside the run-history canvas, so it carries no card
 * chrome of its own. Legacy metadata change lines are filtered out — verification
 * and files render from their own structured slots.
 */
export function RunDetail({ run, repoName }: { run: LoopRunRow; repoName?: string }) {
  const cleaned = ((run.keyChanges as string[] | null) ?? [])
    .map(cleanChange)
    .filter((c) => !/file\(s\) changed/i.test(c) && !/^verification\b/i.test(c));
  const summary = cleaned[0] ?? null;
  const changes = cleaned.slice(1);
  const files = (run.filesChanged as string[] | null) ?? [];
  const journal = (run.journalEntries as { tag: string; text: string }[] | null) ?? [];
  const verification = (run.verification as RunVerification | null) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header — identity + timing (no nested card; the canvas is the surface) */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={RUN_STATUS_VARIANT[run.status] ?? 'neutral'} dot={run.status === 'running'}>{statusLabel(run.status)}</Badge>
          <Mono className="!text-sm font-medium text-ink" title={run.runId}>{shortId(run.runId)}</Mono>
          {run.branch ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-ink-faint">
              <GitBranch className="size-3.5 shrink-0" aria-hidden />
              <Mono className="!text-xs truncate" title={run.branch}>{run.branch}</Mono>
            </span>
          ) : null}
          {run.prUrl ? (
            <a href={run.prUrl} target="_blank" rel="noreferrer" className="focus-ring ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-sage-deep hover:underline">
              Open PR <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Meta label="Trigger">{cap(run.trigger)}</Meta>
          {repoName ? <Meta label="Repo">{repoName}</Meta> : null}
          <Meta label="Started">{fmtRunTime(run.startedAt)}</Meta>
          <Meta label="Finished">{fmtRunTime(run.finishedAt)}</Meta>
          <Meta label="Duration">{fmtDuration(run.startedAt, run.finishedAt)}</Meta>
        </div>
      </div>

      <Separator />

      {run.status === 'running' ? (
        <>
          <Text className="!text-sm text-ink-soft">This run is in progress — the summary, changes and journal appear once it finishes.</Text>
          {/* Live-refresh the history until the run terminates (no manual reload needed). */}
          <RunLivePoll active />
        </>
      ) : null}

      {summary ? (
        <Section>
          <SectionTitle>Summary</SectionTitle>
          <Text className="max-w-[80ch] !text-sm leading-relaxed">{summary}</Text>
        </Section>
      ) : null}

      {changes.length ? (
        <Section>
          <SectionTitle>Key changes</SectionTitle>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-soft marker:text-accent">
            {changes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </Section>
      ) : null}

      <Section>
        <SectionTitle>Verification</SectionTitle>
        <VerificationRow verification={verification} />
      </Section>

      {files.length ? (
        <Section>
          <SectionTitle>Files changed</SectionTitle>
          <ul className="flex flex-col gap-1">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <FileText className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                <Mono className="!text-xs text-ink-soft">{f}</Mono>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {journal.length ? (
        <Section>
          <SectionTitle>Journal</SectionTitle>
          <ul className="flex flex-col gap-2">
            {journal.map((j, i) => (
              <li key={i} className="flex items-start gap-2">
                <Badge size="sm" variant={j.tag === 'missed' ? 'rose' : j.tag === 'avoided' ? 'amber' : 'steel'}>{j.tag}</Badge>
                <TextStrong className="!text-sm !font-normal text-ink-soft">{j.text}</TextStrong>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
