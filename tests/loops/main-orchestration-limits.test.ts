// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planPrompt, parsePlan, RECALLS_REQUESTED, RECALLS_ACCEPTED } from '@/loops/main-orchestration';

/**
 * The prompt asks for fewer recalls than the schema accepts, deliberately: asking small
 * keeps the plan focused, while tolerating a few more means a slightly over-eager model
 * does not fail validation and lose the whole plan — including its `verifyCommand` — over
 * one extra query. Both numbers used to be written out separately, so nothing tied the
 * instruction to the limit that enforces it.
 */
describe('the recall limits stay in step', () => {
  it('asks for no more than it accepts', () => {
    expect(RECALLS_REQUESTED).toBeLessThanOrEqual(RECALLS_ACCEPTED);
  });

  it('states the requested number in the prompt itself', () => {
    expect(planPrompt('tidy the repo')).toContain(`0-${RECALLS_REQUESTED} journal queries`);
  });

  it('accepts a plan up to the tolerated count', () => {
    const recalls = Array.from({ length: RECALLS_ACCEPTED }, (_, i) => ({ query: `q${i}`, purpose: 'p' }));
    expect(parsePlan(JSON.stringify({ recalls, verifyCommand: 'pnpm test' }))).not.toBeNull();
  });

  it('rejects a plan beyond it rather than silently truncating', () => {
    const recalls = Array.from({ length: RECALLS_ACCEPTED + 1 }, (_, i) => ({ query: `q${i}`, purpose: 'p' }));
    expect(parsePlan(JSON.stringify({ recalls, verifyCommand: 'pnpm test' }))).toBeNull();
  });
});
