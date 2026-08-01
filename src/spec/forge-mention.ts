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
  return text.replace(/@forge\s*/gi, '').trim() || fallback;
}
