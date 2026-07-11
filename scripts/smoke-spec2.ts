/**
 * Spec 2 Part B live smoke (READ-ONLY against the user's running mma).
 *
 *   pnpm exec tsx scripts/smoke-spec2.ts
 *
 * Exercises the real `mma` at http://127.0.0.1:7337 through MmaClient:
 *   1. GET /health (unauthenticated liveness).
 *   2. GET /status (Bearer) — confirms the dev token is valid (deep token badge).
 *   3. Read the co-located model-profiles catalog.
 *   4. ONE real `audit` dispatch (tiny inline document) → poll to terminal.
 *
 * It does NOT call any write route and does NOT apply config / restart MMA.
 * The bearer is read from `mma print-token` (or MMA_AUTH_TOKEN /
 * ~/.mma/auth-token). Prints PASS/FAIL per step; exits non-zero on any
 * hard failure.
 */
import { execFileSync } from 'node:child_process';
import { MmaClient } from '../src/mma/client';
import { readModelProfiles } from '../src/mma/model-profiles';

const BASE_URL = process.env.MMA_BASE_URL ?? 'http://127.0.0.1:7337';

function resolveToken(): string {
  if (process.env.MMA_AUTH_TOKEN?.trim()) return process.env.MMA_AUTH_TOKEN.trim();
  try {
    return execFileSync('mma', ['print-token'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Could not resolve an MMA token (mma print-token failed and MMA_AUTH_TOKEN is unset).');
  }
}

let failures = 0;
function report(name: string, ok: boolean, detail: string) {
  const tag = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
   
  console.log(`[${tag}] ${name} — ${detail}`);
}

async function main(): Promise<void> {
  const token = resolveToken();
  // NOTE: the live mma (5.0.3) rejects an unknown X-MMA-Client on TOOL routes
  // with `400 client_required` — its allowlist is claude-code|cursor|codex-cli|
  // gemini-cli and `forge` resolves to `other`. health/status are NOT tool routes
  // and accept `forge`. To exercise the real dispatch→poll path today we send an
  // allowlisted client for the audit step (configurable via MMA_CLIENT). The
  // MmaClient default stays `forge` per the spec; once MMA adds `forge` to its
  // allowlist this override is unnecessary.
  const toolClient = process.env.MMA_CLIENT?.trim() || 'claude-code';
  const client = new MmaClient({ baseUrl: BASE_URL, token, mainModel: 'claude-opus-4-8' }, { client: toolClient });

  // 1. health
  const health = await client.health();
  report('health', health.status === 'ok' || health.status === 'drift', `status=${health.status}`);

  // 2. status (deep token check)
  const status = await client.status();
  report(
    'status (bearer)',
    status.reachable && status.authValid,
    `reachable=${status.reachable} authValid=${status.authValid} version=${status.version ?? '?'} activeBatches=${status.activeBatches ?? '?'}`,
  );

  // 3. model-profiles
  const profiles = readModelProfiles();
  report(
    'model-profiles',
    profiles.available && profiles.profiles.length > 0,
    `available=${profiles.available} count=${profiles.profiles.length}` +
      (profiles.profiles[0] ? ` first=${profiles.profiles[0].provider}:${profiles.profiles[0].prefix}` : ''),
  );

  // 4. ONE real audit dispatch → poll to terminal (read route, tiny inline doc).
  try {
    const cwd = process.cwd();
    const { batchId } = await client.dispatch('audit', {
      cwd,
      body: { document: '# Tiny spec\n\nA requirement: the system SHALL return 200 on /health.', subtype: 'default' },
    });
    report('audit dispatch', !!batchId, `batchId=${batchId}`);

    // Poll to terminal with a generous ceiling (audit is a cheap read route).
    const deadline = Date.now() + 5 * 60_000;
    let terminal: unknown = null;
    let lastHeadline = '';
    for (;;) {
      const r = await client.poll(batchId);
      if (r.state === 'terminal') {
        terminal = r.envelope;
        break;
      }
      if (r.state === 'not_found') {
        break;
      }
      lastHeadline = r.headline;
      if (Date.now() > deadline) break;
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (terminal) {
      const env = terminal as { headline?: string; structuredReport?: { summary?: string } };
      report('audit poll→terminal', true, `headline="${env.headline ?? ''}" summary="${env.structuredReport?.summary ?? ''}"`);
    } else {
      report('audit poll→terminal', false, `timed out; last headline="${lastHeadline}"`);
    }
  } catch (e) {
    report('audit dispatch/poll', false, (e as Error).message);
  }

   
  console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures} step(s) failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
   
  console.error('SMOKE FAIL (uncaught):', (e as Error).message);
  process.exit(1);
});
