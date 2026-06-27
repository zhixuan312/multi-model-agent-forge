// Live smoke: the main-tier Q&A path authenticating via the server's Claude Code
// subscription OAuth (no provider key configured). Verifies structured outputs
// work end-to-end with the subscription token.
import 'dotenv/config';
import { z } from 'zod';
import { AnthropicClient } from '@/anthropic/client';

const SmokeSchema = z.object({
  aiSatisfied: z.boolean(),
  missingInfo: z.array(z.string()),
  followUpQuestions: z.array(z.string()),
});

async function main() {
  const cfg = await AnthropicClient.resolveMainTier();
  console.log('[resolve] auth mode =', cfg.auth.mode, '| model =', cfg.model);
  if (cfg.auth.mode !== 'oauth') console.log('  (note: not using OAuth — a provider key or env key is set)');

  const client = await AnthropicClient.fromMainTier();
  const out = await client.parse(SmokeSchema, {
    system: 'You assess whether enough information has been gathered to draft a spec section. Be terse.',
    user: 'Section: "Problem statement". The user said only: "We need faster CI." Are you satisfied, or do you need follow-up questions? Return the structured assessment.',
    call: 'assessAnswers',
  });
  console.log('[structured output]', JSON.stringify(out));
  const ok = typeof out.aiSatisfied === 'boolean' && Array.isArray(out.followUpQuestions);
  console.log(ok ? 'SMOKE PASS — structured Q&A works via Claude Code OAuth' : 'SMOKE FAIL — bad shape');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('SMOKE ERROR:', e?.status ?? '', String(e?.message ?? e).slice(0, 200)); process.exit(1); });
