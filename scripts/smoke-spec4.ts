/**
 * Spec 4 Part B live smoke (READ-ONLY against the user's running mma).
 *
 *   pnpm exec tsx scripts/smoke-spec4.ts
 *
 * Exercises the real `mma` at http://127.0.0.1:7337 through MmaClient + the
 * Spec-4b audit-envelope parser:
 *   1. GET /health (unauthenticated liveness).
 *   2. ONE real `audit(subtype='spec')` dispatch (tiny inline spec document) →
 *      poll to terminal → assert `parseAuditEnvelope` yields a parseable result.
 *
 * It does NOT call any write route (NO journal-record — that stays mocked in
 * tests) and does NOT apply config / restart MMA. The bearer is read from
 * `mma print-token` (or MMA_AUTH_TOKEN). Prints PASS/FAIL per step; exits
 * non-zero on any hard failure.
 */
import { execFileSync } from 'node:child_process';
import { MmaClient } from '../src/mma/client';
import { parseAuditEnvelope } from '../src/spec/audit-loop';

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

const SPEC_DOC = `# Tiny spec — health endpoint

## Problem statement & goals

### The problem
The service has no liveness signal, so the deployer cannot tell a hung process from a slow one.

### Success criteria
The system SHALL expose \`GET /health\` returning \`200\` with body \`{"status":"ok"}\` within 50ms.

## Technical design

### Selected option & rationale
Add an unauthenticated \`/health\` route that returns a static JSON body. No DB call.
`;

async function main(): Promise<void> {
  const token = resolveToken();
  // Spec-4 cwd is ALWAYS the workspace root; for the smoke we use the current
  // working dir as a stand-in readable directory. The audit is a read route.
  const toolClient = process.env.MMA_CLIENT?.trim() || 'claude-code';
  const client = new MmaClient({ baseUrl: BASE_URL, token, mainModel: 'claude-opus-4-8' }, { client: toolClient });

  // 1. health
  const health = await client.health();
  report('health', health.status === 'ok' || health.status === 'drift', `status=${health.status}`);

  // 2. ONE real audit(subtype=spec) dispatch → poll → parse.
  try {
    const cwd = process.cwd();
    const { batchId } = await client.dispatch('audit', {
      cwd,
      body: { subtype: 'spec', document: SPEC_DOC },
    });
    report('audit(subtype=spec) dispatch', !!batchId, `batchId=${batchId}`);

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

    if (!terminal) {
      report('audit poll→terminal', false, `timed out; last headline="${lastHeadline}"`);
    } else {
      const parsed = parseAuditEnvelope(terminal);
      if (parsed.kind === 'report') {
        const sev = parsed.findings.map((f) => f.severity).join(',') || '(none)';
        report(
          'parseAuditEnvelope',
          true,
          `kind=report findings=${parsed.findings.length} severities=[${sev}] hasCriticalOrHigh=${parsed.hasCriticalOrHigh}`,
        );
      } else {
        // A real auditor returning no structured report is a soft outcome — note it.
        report('parseAuditEnvelope', false, 'kind=missing_report');
      }
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
