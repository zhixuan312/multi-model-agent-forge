// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isForgeMention, stripForgeMention } from '@/spec/forge-mention';

/**
 * `@Forge` mention handling.
 *
 * This file used to be 213 lines that imported NOTHING from the codebase. It declared
 * `const forgeRegex = /@forge\b/i` and `const clean = (t) => t.replace(...)` INSIDE the
 * tests and asserted those local copies, then simulated dedup with local arrays and
 * constructed event literals to assert their own fields. Its docstring claimed it covered
 * "message persistence, SSE event publishing, dedup, @Forge detection, author
 * attribution, and the full message lifecycle" — none of which it could observe, because
 * no production code ever ran.
 *
 * It was also masking a real duplication: the detection regex was written out inline in
 * BOTH `SpecStageClient` and `PlanStageClient`. Three literals for one product rule is how
 * two surfaces end up disagreeing about what "@Forge" means. There is now one
 * implementation, and these test it.
 *
 * (SSE dedup and author attribution are covered where they actually live:
 * `spec-refine-handler.test.ts` for the published event, and the component suites for the
 * client's `seenMsgIds` / skip-own behaviour.)
 */
describe('isForgeMention', () => {
  it('matches the mention anywhere in the message, in any case', () => {
    expect(isForgeMention('@Forge update the spec')).toBe(true);
    expect(isForgeMention('@forge do something')).toBe(true);
    expect(isForgeMention('@FORGE update')).toBe(true);
    expect(isForgeMention('hey @Forge can you update this')).toBe(true);
  });

  it('requires the @ — a bare word is not an instruction', () => {
    expect(isForgeMention('forge is great')).toBe(false);
    expect(isForgeMention('we should forge ahead')).toBe(false);
  });

  it('does not fire on a longer word starting with forge (the word boundary is load-bearing)', () => {
    // Without \b, "@Forgetful" dispatches a refine the member never asked for.
    expect(isForgeMention('@Forgetful person')).toBe(false);
    expect(isForgeMention('@forged the signature')).toBe(false);
  });

  it('is false for an empty or mention-less message', () => {
    expect(isForgeMention('')).toBe(false);
    expect(isForgeMention('just a normal comment')).toBe(false);
  });
});

describe('stripForgeMention', () => {
  const FALLBACK = 'Refine this task based on the discussion.';

  it('removes the mention and returns the remaining instruction', () => {
    expect(stripForgeMention('@Forge update the section', FALLBACK)).toBe('update the section');
    expect(stripForgeMention('hey @forge update this', FALLBACK)).toBe('hey update this');
  });

  it('removes EVERY occurrence, not just the first', () => {
    // "@Forge @forge do it" is one instruction, not a mention followed by a literal.
    expect(stripForgeMention('@Forge @forge do it', FALLBACK)).toBe('do it');
  });

  it('falls back when the message is nothing but the mention', () => {
    // Dispatching the empty string here would send MMA a prompt with no instruction.
    expect(stripForgeMention('@Forge', FALLBACK)).toBe(FALLBACK);
    expect(stripForgeMention('@Forge   ', FALLBACK)).toBe(FALLBACK);
    expect(stripForgeMention('  @forge  ', FALLBACK)).toBe(FALLBACK);
  });

  it('leaves a message with no mention untouched apart from trimming', () => {
    expect(stripForgeMention('  do the thing  ', FALLBACK)).toBe('do the thing');
  });

  it('agrees with isForgeMention — anything it strips, the detector matched', () => {
    for (const text of ['@Forge x', '@forge x', '@FORGE x', 'a @Forge b']) {
      expect(isForgeMention(text)).toBe(true);
      expect(stripForgeMention(text, FALLBACK)).not.toContain('@');
    }
  });
});
