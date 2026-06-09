/**
 * Live smoke for Spec 5 (read-only). Dispatches ONE real `investigate` against a
 * real cwd (this Forge repo) → polls to a terminal envelope, and a `journal-recall`
 * against the workspace root if a journal exists (else skips gracefully). Does NOT
 * live-call OpenAI. Run: `npx tsx scripts/smoke-spec5.ts`.
 *
 * Reads the MMA bearer/base-url from the live `team_settings` row via
 * `buildMmaClient` (the same path the app uses).
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '@/db/client';
import { teamSettings, agentTier } from '@/db/schema/config';
import { eq } from 'drizzle-orm';
import { MmaClient } from '@/mma/client';
import { resolveMmaClientConfig } from '@/mma/client-config';
import { PostgresSecretStore } from '@/secrets/secret-store';
import { DEFAULT_MAIN_MODEL } from '@/anthropic/client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { interpretTerminal } from '@/sse/envelope';

async function main(): Promise<void> {
  // Build the client like buildMmaClient, but inject a default main model when the
  // main tier is unconfigured (the tool routes require X-MMA-Main-Model; read-only
  // smoke just needs a valid id present).
  const db = getDb();
  const [settings] = await db
    .select({ mmaBaseUrl: teamSettings.mmaBaseUrl, mmaTokenRef: teamSettings.mmaTokenRef })
    .from(teamSettings)
    .limit(1);
  const [mainRow] = await db.select({ model: agentTier.model }).from(agentTier).where(eq(agentTier.tier, 'main')).limit(1);
  const secrets = await PostgresSecretStore.create({ db });
  const cfg = await resolveMmaClientConfig({
    settings: settings ?? null,
    mainModel: mainRow?.model ?? DEFAULT_MAIN_MODEL,
    secrets,
  });
  const client = new MmaClient(cfg);
  console.log(`[smoke] X-MMA-Main-Model=${cfg.mainModel}`);

  const health = await client.health();
  console.log(`[smoke] MMA health: ${health.status}`);
  if (health.status === 'unreachable') {
    console.error('[smoke] MMA is unreachable — aborting (do NOT start the server here).');
    process.exit(1);
  }

  const repoCwd = process.cwd(); // this Forge repo — a real path on the co-located disk
  console.log(`[smoke] investigate cwd=${repoCwd}`);
  try {
    const env = (await client.dispatchAndWait('investigate', {
      cwd: repoCwd,
      body: { question: 'What does the exploration stage do in this codebase?' },
    })) as Record<string, unknown>;
    const state = interpretTerminal(env);
    console.log(`[smoke] investigate → terminal: status=${state.status}`);
    console.log(`[smoke]   headline: ${String((env as { headline?: unknown }).headline ?? '(none)').slice(0, 200)}`);
    console.log(`[smoke]   contextBlockId: ${state.contextBlockId ?? '(none)'}`);
    if (state.error) console.log(`[smoke]   error: ${state.error.code} — ${state.error.message}`);
  } catch (err) {
    console.error(`[smoke] investigate FAILED: ${(err as Error).message}`);
  }

  // journal-recall against the workspace root, only if a journal exists.
  const workspaceRoot = resolveWorkspaceRoot();
  const journalDir = join(workspaceRoot, '.mmagent', 'journal');
  if (!existsSync(workspaceRoot)) {
    console.log(`[smoke] workspace root ${workspaceRoot} missing — skipping journal-recall.`);
    return;
  }
  if (!existsSync(journalDir)) {
    console.log(`[smoke] no journal at ${journalDir} — skipping journal-recall (expected this early in build order).`);
    return;
  }
  console.log(`[smoke] journal-recall cwd=${workspaceRoot}`);
  try {
    const env = (await client.dispatchAndWait('journal-recall', {
      cwd: workspaceRoot,
      body: { query: 'what prior decisions exist about exploration?' },
    })) as Record<string, unknown>;
    const state = interpretTerminal(env);
    console.log(`[smoke] journal-recall → terminal: status=${state.status}`);
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
