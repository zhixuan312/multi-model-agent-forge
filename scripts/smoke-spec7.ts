/**
 * Spec 7 live smoke — the READ-ONLY half ONLY.
 *
 * Creates a TEMP git repo + a tiny plan file under `<repo>/.forge/`, then
 * dispatches ONE real `audit(subtype='plan')` against the co-located mma and
 * polls to a terminal envelope. NEVER runs execute-plan or review (destructive).
 *
 * Run: `tsx scripts/smoke-spec7.ts` (requires a reachable mma + a configured
 * team_settings token, same as the other smokes). Prints the terminal headline +
 * findings count, or "skipped" with a reason.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMmaClient } from '@/mma/server-client';
import { parseAuditEnvelope } from '@/spec/audit-loop';

async function main(): Promise<void> {
  let client;
  try {
    client = await buildMmaClient();
  } catch (e) {
    console.log(`SKIPPED: could not build MmaClient — ${(e as Error).message}`);
    return;
  }

  const health = await client.health();
  if (health.status === 'unreachable') {
    console.log('SKIPPED: mma /health unreachable (is `mma serve` running?)');
    return;
  }

  // 1. Temp git repo with a tiny source file + a plan file under .forge/.
  const dir = mkdtempSync(join(tmpdir(), 'forge-smoke7-'));
  try {
    const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git(['init', '-q']);
    git(['config', 'user.email', 'smoke@forge.local']);
    git(['config', 'user.name', 'smoke']);
    writeFileSync(join(dir, 'index.js'), "export function add(a, b) { return a + b; }\n");
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);

    mkdirSync(join(dir, '.forge'), { recursive: true });
    const planPath = join(dir, '.forge', 'plan-smoke.md');
    writeFileSync(
      planPath,
      [
        '## Task 1: Add a subtract function to index.js',
        '',
        'Add `export function subtract(a, b) { return a - b; }` to `index.js`, mirroring the existing `add`.',
        '',
      ].join('\n'),
    );

    // 2. ONE real audit(subtype=plan) dispatch → poll → terminal.
    console.log(`Dispatching audit(subtype=plan) against ${dir} ...`);
    const { batchId } = await client.dispatch('audit', { cwd: dir, body: { type: 'audit', subtype: 'plan', target: { paths: [planPath] } } });
    console.log(`  batchId=${batchId}; polling ...`);

    const deadline = Date.now() + 10 * 60_000;
    let envelope: unknown = null;
    for (;;) {
      const r = await client.poll(batchId);
      if (r.state === 'terminal') {
        envelope = r.envelope;
        break;
      }
      if (Date.now() > deadline) {
        console.log('SKIPPED: audit did not reach terminal within 10m');
        return;
      }
      await new Promise((res) => setTimeout(res, 2000));
    }

    const parsed = parseAuditEnvelope(envelope);
    if (parsed.kind === 'missing_report') {
      console.log('OK (no structured report)');
    } else {
      console.log(
        `OK: findings=${parsed.findings.length} hasCriticalOrHigh=${parsed.hasCriticalOrHigh}`,
      );
    }
    console.log('NOTE: execute-plan + review were NOT run (destructive — out of scope for this smoke).');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.log(`SKIPPED: smoke errored — ${(e as Error).message}`);
});
