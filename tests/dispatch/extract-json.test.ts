import { describe, it, expect } from 'vitest';
import { extractJsonFromEnvelope } from '@/dispatch/handler-registry';

describe('extractJsonFromEnvelope', () => {
  it('extracts JSON object from markdown fenced summary', () => {
    const envelope = { structuredReport: { summary: '```json\n{"key": "value"}\n```' } };
    expect(JSON.parse(extractJsonFromEnvelope(envelope))).toEqual({ key: 'value' });
  });

  it('extracts JSON array from markdown fenced summary', () => {
    const envelope = { structuredReport: { summary: '```json\n[{"a":1},{"b":2}]\n```' } };
    const result = JSON.parse(extractJsonFromEnvelope(envelope));
    expect(result).toHaveLength(2);
  });

  it('handles trailing commentary after JSON', () => {
    const envelope = { structuredReport: { summary: '```json\n[{"title":"Task 1"}]\n```\n\nNote: this is extra text the model added.' } };
    const result = JSON.parse(extractJsonFromEnvelope(envelope));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Task 1');
  });

  it('handles nested objects with trailing text', () => {
    const envelope = { structuredReport: { summary: '{"sections":[{"key":"a","draftMd":"hello"}]}\n\nSome extra notes here.' } };
    const result = JSON.parse(extractJsonFromEnvelope(envelope));
    expect(result.sections).toHaveLength(1);
  });

  it('throws on empty summary', () => {
    expect(() => extractJsonFromEnvelope({ structuredReport: { summary: '' } })).toThrow();
  });

  it('throws on missing structuredReport', () => {
    expect(() => extractJsonFromEnvelope({})).toThrow();
  });

  it('handles JSON with escaped quotes inside strings', () => {
    const envelope = { structuredReport: { summary: '{"text":"he said \\"hello\\""}' } };
    const result = JSON.parse(extractJsonFromEnvelope(envelope));
    expect(result.text).toBe('he said "hello"');
  });
});
