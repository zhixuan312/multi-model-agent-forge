/**
 * Live smoke for Spec 6 — Journal (READ-ONLY). Two parts:
 *   1. Direct `fs` read of `.mmagent/journal/` at the workspace root via the
 *      Spec-6 store-reader (index + log + frontmatter reconciliation), printing
 *      a small summary. This is free and deterministic.
 *   2. ONE real `journal-recall` rod dispatch against the workspace root IF a
 *      journal exists there — else print "no journal — skipped" and exit 0.
 *
 * Never starts the MMA server; aborts if MMA is unreachable. Reads the bearer/
 * base-url from the live `team_settings` row via the same path the app uses.
 * Run: `npx tsx scripts/smoke-spec6.ts`.
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { teamSettings, agentTier } from '@/db/schema/config';
import { MmaClient } from '@/mma/client';
import { resolveMmaClientConfig } from '@/mma/client-config';
import { PostgresSecretStore } from '@/secrets/secret-store';
import { DEFAULT_MAIN_MODEL } from '@/anthropic/client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { readAllNodes, readLog } from '@/journal/store-reader';
import { parseRecallEnvelope } from '@/journal/recall';
import { interpretTerminal } from '@/sse/envelope';

async function main(): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot();
  const journalDir = join(workspaceRoot, '.mmagent', 'journal');
  console.log(`[smoke] workspace root: ${workspaceRoot}`);
  console.log(`[smoke] journal dir:    ${journalDir}`);

  // ── Part 1: direct store-read (free) ──
  const read = await readAllNodes(workspaceRoot);
  console.log(`[smoke] readAllNodes → kind=${read.kind}`);
  if (read.kind === 'ok') {
    console.log(`[smoke]   nodes=${read.nodes.length}  skipped=${read.skippedCount}  log=${read.log.length}`);
    const sample = read.nodes.slice(0, 3).map((n) => `${n.id}/${n.status}`).join(', ');
    console.log(`[smoke]   sample: ${sample}`);
    const log = await readLog(workspaceRoot);
    if (log.length) console.log(`[smoke]   newest log op: ${log[log.length - 1]!.op} ${log[log.length - 1]!.id}`);
  }

  if (!existsSync(journalDir)) {
    console.log('[smoke] no journal — skipped (journal-recall not dispatched).');
    process.exit(0);
  }

  // ── Part 2: one real journal-recall dispatch ──
  const db = getDb();
  const [settings] = await db
    .select({ mmaBaseUrl: teamSettings.mmaBaseUrl, mmaTokenRef: teamSettings.mmaTokenRef })
    .from(teamSettings)
    .limit(1);
  const [mainRow] = await db
    .select({ model: agentTier.model })
    .from(agentTier)
    .where(eq(agentTier.tier, 'main'))
    .limit(1);
  const secrets = await PostgresSecretStore.create({ db });
  const cfg = await resolveMmaClientConfig({
    settings: settings ?? null,
    mainModel: mainRow?.model ?? DEFAULT_MAIN_MODEL,
    secrets,
  });
  const client = new MmaClient(cfg);

  const health = await client.health();
  console.log(`[smoke] MMA health: ${health.status}`);
  if (health.status === 'unreachable') {
    console.error('[smoke] MMA is unreachable — aborting (do NOT start the server here).');
    process.exit(1);
  }

  console.log(`[smoke] journal-recall cwd=${workspaceRoot}`);
  try {
    const env = (await client.dispatchAndWait('journal-recall', {
      cwd: workspaceRoot,
      body: { query: 'what prior decisions exist about completion gating?' },
    })) as Record<string, unknown>;
    const state = interpretTerminal(env);
    const parsed = parseRecallEnvelope(env);
    console.log(`[smoke] journal-recall → terminal: status=${state.status}`);
    console.log(`[smoke]   synthesis: ${parsed.summary.slice(0, 200) || '(empty)'}`);
    console.log(`[smoke]   findings=${parsed.findings.length}  citedIds=[${parsed.citationIds.join(', ')}]`);
    if (state.error) console.log(`[smoke]   error: ${state.error.code} — ${state.error.message}`);
  } catch (err) {
    console.error(`[smoke] journal-recall FAILED: ${(err as Error).message}`);
  }
}

main()
  .then(() => {
    console.log('[smoke] done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[smoke] fatal:', err);
    process.exit(1);
  });
