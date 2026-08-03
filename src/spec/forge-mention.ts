/**
 * `@Forge` mention handling — the one implementation.
 *
 * The detection regex was written out inline in two components (`SpecStageClient`,
 * `PlanStageClient`) and a third time inside a test that asserted its own local copy.
 * Three literals for one product rule is how "@Forge" and "@forge" end up behaving
 * differently on two surfaces.
 *
 * The `\b` is load-bearing: without it `@Forgetful` triggers a refine.
 */
const FORGE_MENTION = /@forge\b/i;

/** The same rule, globally — one source for detection AND removal. */
const FORGE_MENTION_ALL = /@forge\b\s*/gi;

/** Whether a composer message is addressed to Forge. */
export function isForgeMention(text: string): boolean {
  return FORGE_MENTION.test(text);
}

/**
 * The instruction to send once the mention itself is removed.
 *
 * A message that is ONLY the mention (`"@Forge"`, or `"@Forge   "`) leaves nothing to act
 * on, so callers pass the instruction to fall back to rather than dispatching an empty
 * prompt. Every occurrence is stripped, not just the first — `"@Forge @forge do it"` is
 * one instruction, not a mention followed by a literal.
 */
export function stripForgeMention(text: string, fallback: string): string {
  // Carries the same `\b` as the detector. Without it these two spellings of one rule
  // disagreed: "@Forgetful" is NOT a mention, yet strip would have eaten the "@Forge"
  // out of it and sent "tful". Harmless only for as long as every caller strips solely
  // after `isForgeMention` says yes.
  return text.replace(FORGE_MENTION_ALL, '').trim() || fallback;
}
