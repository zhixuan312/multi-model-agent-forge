import { existsSync } from 'node:fs';
import { PageHeader } from '@/components/forge/PageHeader';
import { JournalTabs } from '@/components/forge/journal/JournalTabs';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { readAllNodes } from '@/journal/store-reader';
import type { JournalReadOutcome } from '@/journal/types';

/**
 * `/journal` — the team decision-graph viewer (Spec 6). RSC: resolve the
 * workspace root, read `index.md` + `log.md` + every node's FRONTMATTER
 * server-side (bodies stay lazy), and hand the reconciled result to the
 * `JournalTabs` client island. The page is auth-gated by the `(app)` layout
 * (any member; no admin). The journal is TEAM-LEVEL — read from MMA's
 * `.mmagent/journal/` at the workspace root, never a project repo.
 *
 * Graceful: an absent/unconfigured workspace root → a config-needed state;
 * present-but-empty → empty state; present-but-unreadable → diagnostic. Never 500.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; node?: string }>;
}) {
  const { view, node } = await searchParams;
  const root = resolveWorkspaceRoot();

  let read: JournalReadOutcome;
  if (!existsSync(root)) {
    // Workspace root itself isn't there yet → admin must configure it (Spec 2).
    read = { kind: 'unconfigured' };
  } else {
    read = await readAllNodes(root);
  }

  return (
    <>
      <PageHeader title="Journal" subtitle="The team knowledge base — recall, nodes, and the write-log." />
      <JournalTabs read={read} initialView={view} initialNode={node} />
    </>
  );
}
