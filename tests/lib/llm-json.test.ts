// @vitest-environment node
import { extractJsonText, parseLlmJson } from '@/lib/llm-json';

/**
 * These cases are the UNION of what the eight previous unwrappers each accepted. Every
 * one of them was handled somewhere before this module existed; the point is that they
 * are now handled EVERYWHERE, so the audit path is no longer stricter than the loops path.
 */
describe('extractJsonText — the shapes a model actually replies with', () => {
  it('plain JSON with no fence', () => {
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it('a ```json fence', () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('a BARE ``` fence — the case that silently emptied audit findings', () => {
    expect(extractJsonText('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('a fence tagged with some other language', () => {
    expect(extractJsonText('```JSON\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('prose before the fence', () => {
    expect(extractJsonText("Here's the report:\n```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it('prose after the closing fence, including trailing whitespace', () => {
    expect(extractJsonText('```json\n{"a":1}\n```   \n\nLet me know!')).toBe('{"a":1}');
  });

  it('prose either side with no fence at all', () => {
    expect(extractJsonText('Sure. {"a":1} — hope that helps.')).toBe('{"a":1}');
  });

  it('a top-level array', () => {
    expect(extractJsonText('```json\n[1,2]\n```')).toBe('[1,2]');
  });

  it('nested objects close at the OUTER brace, not the first one', () => {
    expect(extractJsonText('{"a":{"b":1}}')).toBe('{"a":{"b":1}}');
  });

  it('a brace inside a string value does not end the object early', () => {
    expect(extractJsonText('{"a":"} not the end","b":2}')).toBe('{"a":"} not the end","b":2}');
  });

  it('an escaped quote inside a string does not end the string early', () => {
    expect(extractJsonText('{"a":"say \\"hi\\" }","b":2}')).toBe('{"a":"say \\"hi\\" }","b":2}');
  });

  it('returns null when there is no JSON container at all', () => {
    expect(extractJsonText('no json here')).toBeNull();
    expect(extractJsonText('')).toBeNull();
  });
});

describe('parseLlmJson', () => {
  it('parses each of the fenced and unfenced forms to the same value', () => {
    for (const raw of ['{"a":1}', '```json\n{"a":1}\n```', '```\n{"a":1}\n```', 'text {"a":1} text']) {
      expect(parseLlmJson(raw)).toEqual({ a: 1 });
    }
  });

  it('returns null — not {} — when the payload is unparseable', () => {
    // The distinction is load-bearing: a caller that treats null like an empty result
    // turns a broken response into a passing gate.
    expect(parseLlmJson('```json\n{"a": \n```')).toBeNull();
    expect(parseLlmJson('not json')).toBeNull();
  });

  it('handles a missing or non-string input', () => {
    expect(parseLlmJson(undefined)).toBeNull();
    expect(parseLlmJson(null)).toBeNull();
  });

  it('a truncated object yields null rather than a partial value', () => {
    expect(parseLlmJson('{"findings":[{"weight":"high"')).toBeNull();
  });
});

describe('parseLlmJson — the fence is a hint, not the last word', () => {
  it('falls back to JSON outside the fence when the fenced block is not JSON', () => {
    // A model fencing a snippet and putting the payload after it. Without the fallback
    // this reply parses to nothing.
    const raw = 'Consider:\n```ts\nconst x = 1;\n```\nReport: {"summary":"ok","findings":[]}';
    expect(parseLlmJson(raw)).toEqual({ summary: 'ok', findings: [] });
  });

  it('prefers the fenced block when BOTH places hold JSON', () => {
    const raw = '{"which":"outside"}\n```json\n{"which":"inside"}\n```';
    expect(parseLlmJson(raw)).toEqual({ which: 'inside' });
  });

  it('still returns null when neither candidate parses', () => {
    expect(parseLlmJson('```ts\nconst x = 1;\n```\nno payload here')).toBeNull();
  });
});
