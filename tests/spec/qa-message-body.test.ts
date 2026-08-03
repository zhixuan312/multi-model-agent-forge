// @vitest-environment node
/**
 * The spec-component and plan-task message routes accepted a `bodyMd` of ANY length
 * straight into a `text` column, and then fanned it out over SSE to every connected
 * client of that project. The only check was `if (!bodyMd.trim())`.
 *
 * The brief path already carries this lesson — `briefSchema` declares a 100k ceiling, and
 * `details-actions.ts` records that nothing applied it until a fix went in. Same shape of
 * input, same untrusted origin.
 */
import { parseQaMessageBody, QA_MESSAGE_MAX_CHARS } from '@/spec/qa-message-body';

describe('parseQaMessageBody', () => {
  it('trims and returns a normal message', () => {
    expect(parseQaMessageBody('  hello there  ')).toBe('hello there');
  });

  it('rejects a body that is not a string', () => {
    // `as { bodyMd?: unknown }` was already in place at the call sites, but only a
    // `typeof === 'string'` test stood between the wire and the column.
    for (const bad of [undefined, null, 42, true, {}, ['x'], Buffer.from('x')]) {
      expect(parseQaMessageBody(bad), String(bad)).toBeNull();
    }
  });

  it('rejects empty and whitespace-only bodies', () => {
    for (const bad of ['', '   ', '\n\t ']) expect(parseQaMessageBody(bad)).toBeNull();
  });

  it('accepts a body exactly at the ceiling and rejects one past it', () => {
    const atLimit = 'x'.repeat(QA_MESSAGE_MAX_CHARS);
    expect(parseQaMessageBody(atLimit)).toBe(atLimit);
    expect(parseQaMessageBody('x'.repeat(QA_MESSAGE_MAX_CHARS + 1))).toBeNull();
  });

  it('measures the TRIMMED length, so padding cannot be used to slip past', () => {
    // A body that is over the limit only because of surrounding whitespace is fine…
    const padded = `  ${'x'.repeat(QA_MESSAGE_MAX_CHARS)}  `;
    expect(parseQaMessageBody(padded)).toHaveLength(QA_MESSAGE_MAX_CHARS);
    // …and one that is over the limit after trimming is not.
    expect(parseQaMessageBody(`  ${'x'.repeat(QA_MESSAGE_MAX_CHARS + 1)}  `)).toBeNull();
  });

  it('is a real ceiling, not a placeholder', () => {
    expect(QA_MESSAGE_MAX_CHARS).toBeGreaterThan(1_000);
    expect(QA_MESSAGE_MAX_CHARS).toBeLessThan(1_000_000);
  });
});
